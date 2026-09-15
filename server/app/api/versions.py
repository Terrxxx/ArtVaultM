from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Asset, AssetVersion, Comment, DownloadLog, User
from ..serializers import version_to_dict
from ..services import notify, storage
from .deps import ensure_project_access, get_current_user

router = APIRouter()


def _get_asset_or_404(db: Session, asset_id: int) -> Asset:
    asset = db.get(Asset, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="资产不存在")
    return asset


def _find_reusable_version(
    db: Session, project_id: int, file_hash: str
) -> Optional[AssetVersion]:
    """同一项目内查找相同哈希的已有文件，用于去重（仅当物理文件仍存在）。"""
    candidate = (
        db.query(AssetVersion)
        .join(Asset, Asset.id == AssetVersion.asset_id)
        .filter(Asset.project_id == project_id)
        .filter(AssetVersion.file_hash == file_hash)
        .first()
    )
    if candidate is None or not storage.resolve_path(candidate.file_path).exists():
        return None
    return candidate


@router.get("/assets/{asset_id}/versions")
def list_versions(
    asset_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    asset = _get_asset_or_404(db, asset_id)
    ensure_project_access(db, asset.project_id, user)
    versions = (
        db.query(AssetVersion)
        .filter(AssetVersion.asset_id == asset_id)
        .order_by(AssetVersion.version.desc())
        .all()
    )
    return [version_to_dict(v) for v in versions]


@router.post("/assets/{asset_id}/versions")
def upload_version(
    asset_id: int,
    file: UploadFile = File(...),
    changelog: Optional[str] = Form(None),
    thumbnail: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    asset = _get_asset_or_404(db, asset_id)
    project = ensure_project_access(db, asset.project_id, user, write=True)

    next_version = max((v.version for v in asset.versions), default=0) + 1
    for v in asset.versions:
        v.is_latest = False

    staged = storage.stage_upload(file)
    reuse = _find_reusable_version(db, asset.project_id, staged["file_hash"])
    if reuse is not None:
        storage.discard_staged(staged["tmp_path"])
        file_path = reuse.file_path
        deduped = True
    else:
        file_path = storage.place_upload(
            staged["tmp_path"], asset.project_id, asset.id, next_version, staged["file_name"]
        )
        deduped = False

    # 每个版本独立保存自己的缩略图
    thumb = storage.save_version_thumbnail(asset.id, next_version, thumbnail)

    version = AssetVersion(
        asset_id=asset.id,
        version=next_version,
        is_latest=True,
        changelog=changelog,
        thumbnail=thumb,
        file_path=file_path,
        file_name=staged["file_name"],
        file_size=staged["file_size"],
        file_format=staged["file_format"],
        file_hash=staged["file_hash"],
        uploader_id=user.id,
    )
    db.add(version)

    # 新版本上传了缩略图才替换资产封面，否则保留原封面
    if thumb:
        asset.cover_thumbnail = thumb

    summary = f"资产「{asset.name}」发布新版本 v{next_version}"
    # 同时订阅了项目和该资产的用户只发一条，避免重复
    targets = set(notify.subscriber_ids(db, "asset", asset.id)) | set(
        notify.subscriber_ids(db, "project", project.id)
    )
    for sub_user_id in targets:
        notify.add_notification(
            db,
            sub_user_id,
            "update",
            actor_id=user.id,
            project_id=project.id,
            asset_id=asset.id,
            content=summary,
        )

    db.commit()
    db.refresh(version)
    data = version_to_dict(version)
    data["deduped"] = deduped
    return data


@router.get("/versions/{version_id}/download")
def download_version(
    version_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    version = db.get(AssetVersion, version_id)
    if version is None:
        raise HTTPException(status_code=404, detail="版本不存在")
    ensure_project_access(db, version.asset.project_id, user)

    path = storage.resolve_path(version.file_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="文件不存在")

    db.add(DownloadLog(asset_version_id=version.id, user_id=user.id))
    db.commit()

    return FileResponse(path, filename=version.file_name)


@router.delete("/versions/{version_id}")
def delete_version(
    version_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    version = db.get(AssetVersion, version_id)
    if version is None:
        raise HTTPException(status_code=404, detail="版本不存在")
    ensure_project_access(db, version.asset.project_id, user, write=True)

    if version.is_latest:
        raise HTTPException(status_code=400, detail="不能删除最新版本，请先上传新版本")

    # 注释：该版本下的评论降级为通用评论，避免悬空引用
    db.query(Comment).filter(Comment.version_id == version_id).update(
        {Comment.version_id: None}
    )
    storage.delete_file(version.thumbnail)

    db.delete(version)
    db.commit()
    return {"ok": True}


@router.get("/assets/{asset_id}/download-stats")
def download_stats(
    asset_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    asset = _get_asset_or_404(db, asset_id)
    ensure_project_access(db, asset.project_id, user)

    rows = (
        db.query(AssetVersion.version, AssetVersion.id, func.count(DownloadLog.id))
        .outerjoin(DownloadLog, DownloadLog.asset_version_id == AssetVersion.id)
        .filter(AssetVersion.asset_id == asset_id)
        .group_by(AssetVersion.id)
        .order_by(AssetVersion.version.desc())
        .all()
    )
    by_version = [
        {"version": v, "version_id": vid, "count": count} for v, vid, count in rows
    ]
    total = sum(item["count"] for item in by_version)

    recent_rows = (
        db.query(DownloadLog, User)
        .join(AssetVersion, AssetVersion.id == DownloadLog.asset_version_id)
        .join(User, User.id == DownloadLog.user_id)
        .filter(AssetVersion.asset_id == asset_id)
        .order_by(DownloadLog.created_at.desc())
        .limit(10)
        .all()
    )
    recent = [
        {
            "user": {
                "id": u.id,
                "username": u.username,
                "nickname": u.nickname,
                "avatar": u.avatar,
            },
            "version": dl.asset_version.version if dl.asset_version else None,
            "created_at": dl.created_at.isoformat() if dl.created_at else None,
        }
        for dl, u in recent_rows
    ]

    return {"total": total, "by_version": by_version, "recent": recent}
