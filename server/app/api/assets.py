from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Asset, AssetRelation, AssetVersion, Category, User
from ..serializers import asset_to_dict
from ..services import notify, storage
from .deps import ensure_project_access, get_current_user

router = APIRouter()


def _parse_tags(raw: Optional[str]) -> List[str]:
    if not raw:
        return []
    return [t.strip() for t in raw.split(",") if t.strip()]


def _find_reusable_version(db: Session, project_id: int, file_hash: str) -> Optional[AssetVersion]:
    """同一项目内查找相同哈希的已有文件，用于去重（仅当物理文件仍存在）。"""
    candidate = (
        db.query(AssetVersion)
        .join(Asset, Asset.project_id == project_id)
        .filter(AssetVersion.file_hash == file_hash)
        .filter(Asset.project_id == project_id)
        .first()
    )
    if candidate is None:
        return None
    if not storage.resolve_path(candidate.file_path).exists():
        return None
    return candidate


@router.get("/projects/{project_id}/assets")
def list_assets(
    project_id: int,
    category_id: Optional[int] = None,
    q: Optional[str] = None,
    tag: Optional[str] = None,
    fmt: Optional[str] = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ensure_project_access(db, project_id, user)
    base = db.query(Asset).filter(Asset.project_id == project_id)

    if category_id:
        base = base.filter(Asset.category_id == category_id)

    # 项目内全局搜索：资产名 / 描述 / 标签 / 版本文件名 / 上传者昵称或用户名
    keyword = (q or "").strip()
    if keyword:
        like = f"%{keyword}%"
        matched = base.filter(
            Asset.name.ilike(like)
            | Asset.description.ilike(like)
            | Asset.creator.has(User.nickname.ilike(like))
            | Asset.creator.has(User.username.ilike(like))
            | Asset.versions.any(AssetVersion.file_name.ilike(like))
        ).all()
        by_id = {a.id: a for a in matched}
        # 标签存在 JSON 列里（非 ASCII 会被转义），无法用 SQL LIKE 可靠匹配，改在 Python 侧比对
        low = keyword.lower()
        for a in base.all():
            if a.id not in by_id and any(
                low in (t or "").lower() for t in (a.tags or [])
            ):
                by_id[a.id] = a
        assets = sorted(by_id.values(), key=lambda x: x.created_at, reverse=True)
    else:
        assets = base.order_by(Asset.created_at.desc()).all()

    # 版本关系已按 version desc 排序，取第一个即最新版本
    if fmt:
        fmt_low = fmt.lower()
        assets = [a for a in assets if a.versions and a.versions[0].file_format == fmt_low]

    result = [asset_to_dict(a, current_user_id=user.id) for a in assets]

    if tag:
        result = [a for a in result if tag in (a.get("tags") or [])]

    return result


@router.post("/assets")
def create_asset(
    project_id: int = Form(...),
    category_id: int = Form(...),
    name: str = Form(...),
    description: Optional[str] = Form(None),
    tags: Optional[str] = Form(None),
    changelog: Optional[str] = Form(None),
    file: UploadFile = File(...),
    thumbnail: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = ensure_project_access(db, project_id, user, write=True)
    category = db.get(Category, category_id)
    if category is None or category.project_id != project_id:
        raise HTTPException(status_code=400, detail="分类不存在或不属于该项目")

    asset = Asset(
        project_id=project_id,
        category_id=category_id,
        name=name,
        description=description,
        tags=_parse_tags(tags),
        created_by=user.id,
    )
    db.add(asset)
    db.flush()

    # 暂存上传内容并计算哈希，命中已有文件则复用（去重）
    staged = storage.stage_upload(file)
    reuse = _find_reusable_version(db, project_id, staged["file_hash"])
    if reuse is not None:
        storage.discard_staged(staged["tmp_path"])
        file_path = reuse.file_path
        deduped = True
    else:
        file_path = storage.place_upload(
            staged["tmp_path"], project_id, asset.id, 1, staged["file_name"]
        )
        deduped = False

    thumb = storage.save_version_thumbnail(asset.id, 1, thumbnail)

    db.add(
        AssetVersion(
            asset_id=asset.id,
            version=1,
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
    )
    asset.cover_thumbnail = thumb

    # 通知订阅了该项目的用户
    notify.notify_subscribers(
        db,
        "project",
        project_id,
        actor_id=user.id,
        content=f"项目「{project.name}」新增资产「{name}」",
        project_id=project_id,
        asset_id=asset.id,
    )

    db.commit()
    db.refresh(asset)
    data = asset_to_dict(asset, include_versions=True, current_user_id=user.id)
    data["deduped"] = deduped
    return data


@router.get("/assets/{asset_id}")
def get_asset(
    asset_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    asset = db.get(Asset, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="资产不存在")
    ensure_project_access(db, asset.project_id, user)
    return asset_to_dict(asset, include_versions=True, current_user_id=user.id)


@router.patch("/assets/{asset_id}")
def update_asset(
    asset_id: int,
    name: Optional[str] = Form(None),
    description: Optional[str] = Form(None),
    tags: Optional[str] = Form(None),
    category_id: Optional[int] = Form(None),
    thumbnail: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    asset = db.get(Asset, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="资产不存在")
    ensure_project_access(db, asset.project_id, user, write=True)

    if name is not None:
        asset.name = name
    if description is not None:
        asset.description = description
    if tags is not None:
        asset.tags = _parse_tags(tags)
    if category_id is not None:
        category = db.get(Category, category_id)
        if category is None or category.project_id != asset.project_id:
            raise HTTPException(status_code=400, detail="分类不存在或不属于该项目")
        asset.category_id = category_id

    # 换封面图：同时更新最新版本的缩略图，保证版本历史显示一致
    if thumbnail is not None and thumbnail.filename:
        new_thumb = storage.save_version_thumbnail(
            asset.id, asset.versions[0].version if asset.versions else 1, thumbnail
        )
        asset.cover_thumbnail = new_thumb
        if asset.versions:
            storage.delete_file(asset.versions[0].thumbnail)
            asset.versions[0].thumbnail = new_thumb

    db.commit()
    db.refresh(asset)
    return asset_to_dict(asset, include_versions=True, current_user_id=user.id)


@router.delete("/assets/{asset_id}")
def delete_asset(
    asset_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    asset = db.get(Asset, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="资产不存在")

    is_owner_or_admin = user.role == "admin" or asset.created_by == user.id
    if not is_owner_or_admin:
        # 其余情况需项目写权限（所有者/管理员/成员）
        ensure_project_access(db, asset.project_id, user, write=True)

    project_id = asset.project_id

    # 清理关联关系、缩略图与实体文件
    db.query(AssetRelation).filter(
        (AssetRelation.from_asset_id == asset_id)
        | (AssetRelation.to_asset_id == asset_id)
    ).delete(synchronize_session=False)

    for v in asset.versions:
        storage.delete_file(v.thumbnail)
    storage.delete_file(asset.cover_thumbnail)
    storage.delete_asset_dir(project_id, asset_id)

    db.delete(asset)
    db.commit()
    return {"ok": True}
