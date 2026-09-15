from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, RedirectResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..core.security import (
    STREAM_TOKEN_MINUTES,
    create_stream_token,
    decode_stream_token,
)
from ..database import get_db
from ..models import Asset, AssetVersion, Comment, DownloadLog, User
from ..serializers import version_to_dict
from ..services import notify, storage, storage_config
from .deps import can_edit_asset, ensure_project_access, get_current_user

router = APIRouter()

# COS 临时下载链接有效期（秒）
PRESIGNED_EXPIRES = 600


def _get_asset_or_404(db: Session, asset_id: int) -> Asset:
    asset = db.get(Asset, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="资产不存在")
    return asset


def _target_storage(cos: Optional[dict]) -> str:
    return "cos" if cos else "local"


def _find_reusable_version(
    db: Session,
    project_id: int,
    file_hash: str,
    target_storage: str,
    cos: Optional[dict],
) -> Optional[AssetVersion]:
    """同项目内查找相同哈希、存储位置一致、文件仍在的版本，用于去重。"""
    candidates = (
        db.query(AssetVersion)
        .join(Asset, Asset.id == AssetVersion.asset_id)
        .filter(
            Asset.project_id == project_id,
            AssetVersion.file_hash == file_hash,
            AssetVersion.storage == target_storage,
        )
        .all()
    )
    for candidate in candidates:
        if storage.file_exists(candidate.file_path, candidate.storage, cos):
            return candidate
    return None


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

    cos = storage_config.cos_params(db)
    staged = storage.stage_upload(file)
    reuse = _find_reusable_version(
        db, asset.project_id, staged["file_hash"], _target_storage(cos), cos
    )
    if reuse is not None:
        storage.discard_staged(staged["tmp_path"])
        placed = {"file_path": reuse.file_path, "storage": reuse.storage}
        deduped = True
    else:
        placed = storage.place_upload(
            staged["tmp_path"],
            asset.project_id,
            asset.id,
            next_version,
            staged["file_name"],
            cos,
        )
        deduped = False

    # 每个版本可以有自己的一张预览缩略图
    raw_thumb, thumb_name = storage.read_upload(thumbnail)
    version_thumb = storage.save_version_thumbnail(
        asset.id, next_version, raw_thumb, thumb_name, cos
    )

    version = AssetVersion(
        asset_id=asset.id,
        version=next_version,
        is_latest=True,
        changelog=changelog,
        thumbnail=version_thumb["path"],
        thumbnail_storage=version_thumb["storage"],
        storage=placed["storage"],
        file_path=placed["file_path"],
        file_name=staged["file_name"],
        file_size=staged["file_size"],
        file_format=staged["file_format"],
        file_hash=staged["file_hash"],
        uploader_id=user.id,
    )
    db.add(version)

    # 说明：资产封面是独立字段，只在创建资产或手动编辑时设置，
    # 上传新版本不会覆盖它。

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


@router.get("/versions/{version_id}/download-url")
def get_download_url(
    version_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """返回可直接交给浏览器下载的直链。

    COS 模式下若用 XHR 拉取，浏览器会跨域访问对象存储而被 CORS 拦截，
    因此这里只返回链接，由前端 `<a href>` / 跳转交给浏览器原生下载。
    """
    version = db.get(AssetVersion, version_id)
    if version is None:
        raise HTTPException(status_code=404, detail="版本不存在")
    ensure_project_access(db, version.asset.project_id, user)

    db.add(DownloadLog(asset_version_id=version.id, user_id=user.id))
    db.commit()

    if version.storage == "cos":
        cos = storage_config.cos_params(db)
        if not cos:
            raise HTTPException(status_code=500, detail="对象存储未正确配置")
        try:
            url = storage.presigned_url(
                version.file_path, cos, PRESIGNED_EXPIRES, download_name=version.file_name
            )
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=502, detail=f"生成下载链接失败：{exc}")
        return {"url": url, "external": True}

    token = create_stream_token(version.id, user.id)
    return {
        "url": f"/api/versions/{version.id}/stream?t={token}&dl=1",
        "external": False,
    }


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

    db.add(DownloadLog(asset_version_id=version.id, user_id=user.id))
    db.commit()

    # COS：生成带签名的临时链接，浏览器直接到对象存储取数据（链接到期即失效）
    if version.storage == "cos":
        cos = storage_config.cos_params(db)
        if not cos:
            raise HTTPException(status_code=500, detail="对象存储未正确配置")
        try:
            url = storage.presigned_url(version.file_path, cos, PRESIGNED_EXPIRES)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=502, detail=f"生成下载链接失败：{exc}")
        return RedirectResponse(url=url, status_code=307)

    path = storage.resolve_path(version.file_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="文件不存在")
    return FileResponse(path, filename=version.file_name)


@router.get("/versions/{version_id}/stream-token")
def get_stream_token(
    version_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """为在线预览签发短期令牌（图片/视频/模型标签无法带 Authorization 头）。"""
    version = db.get(AssetVersion, version_id)
    if version is None:
        raise HTTPException(status_code=404, detail="版本不存在")
    ensure_project_access(db, version.asset.project_id, user)
    token = create_stream_token(version.id, user.id)
    return {
        "token": token,
        "url": f"/api/versions/{version.id}/stream?t={token}",
        "expires_in": STREAM_TOKEN_MINUTES * 60,
    }


@router.get("/versions/{version_id}/stream")
def stream_version(
    version_id: int,
    t: str,
    dl: bool = False,
    db: Session = Depends(get_db),
):
    """按短期令牌返回文件内容：在线预览用（dl=false），下载用（dl=true，附件形式）。"""
    version = db.get(AssetVersion, version_id)
    if version is None:
        raise HTTPException(status_code=404, detail="版本不存在")

    try:
        user_id = decode_stream_token(t, version_id)
    except Exception:
        raise HTTPException(status_code=401, detail="预览令牌无效或已过期")

    viewer = db.get(User, user_id)
    if viewer is None or viewer.status != "active":
        raise HTTPException(status_code=401, detail="用户不可用")
    ensure_project_access(db, version.asset.project_id, viewer)

    if version.storage == "cos":
        cos = storage_config.cos_params(db)
        if not cos:
            raise HTTPException(status_code=500, detail="对象存储未正确配置")
        try:
            return RedirectResponse(
                url=storage.presigned_url(version.file_path, cos, PRESIGNED_EXPIRES),
                status_code=307,
            )
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=502, detail=f"生成预览链接失败：{exc}")

    path = storage.resolve_path(version.file_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="文件不存在")
    if dl:
        return FileResponse(path, filename=version.file_name)
    # 不带 filename，浏览器按 inline 处理，便于 <img>/<video> 直接渲染
    return FileResponse(path)


@router.delete("/versions/{version_id}")
def delete_version(
    version_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    version = db.get(AssetVersion, version_id)
    if version is None:
        raise HTTPException(status_code=404, detail="版本不存在")
    if not can_edit_asset(version.asset, user):
        raise HTTPException(
            status_code=403, detail="仅资产创建者或高级管理员可删除版本"
        )

    if version.is_latest:
        raise HTTPException(status_code=400, detail="不能删除最新版本，请先上传新版本")

    # 该版本下的评论降级为通用评论，避免悬空引用
    db.query(Comment).filter(Comment.version_id == version_id).update(
        {Comment.version_id: None}
    )
    cos = storage_config.cos_params(db)
    storage.delete_file(version.thumbnail, version.thumbnail_storage or "local", cos)
    storage.delete_file(version.thumb_small, version.thumb_small_storage or "local", cos)
    if version.storage == "cos":
        storage.delete_file(version.file_path, "cos", cos)

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
