from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Asset, AssetRelation, AssetVersion, Category, Project, User
from ..schemas import AssetMoveRequest
from ..serializers import asset_to_dict
from ..services import notify, storage, storage_config
from .deps import can_edit_asset, ensure_project_access, get_current_user, is_super_admin

router = APIRouter()


def _parse_tags(raw: Optional[str]) -> List[str]:
    if not raw:
        return []
    return [t.strip() for t in raw.split(",") if t.strip()]


def _target_storage(cos: Optional[dict]) -> str:
    return "cos" if cos else "local"


def _find_reusable_version(
    db: Session,
    project_id: int,
    file_hash: str,
    target_storage: str,
    cos: Optional[dict],
) -> Optional[AssetVersion]:
    """同项目内查找相同哈希、且存储位置一致、文件仍在的版本，用于去重。"""
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

    # 0 表示根目录（category_id 为 NULL），与前端「0 = 根」哨兵保持一致
    if category_id == 0:
        base = base.filter(Asset.category_id.is_(None))
    elif category_id:
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
    category_id: Optional[int] = Form(None),
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
    # 0/None 表示放到项目根目录
    asset_category_id: Optional[int] = None
    if category_id:
        category = db.get(Category, category_id)
        if category is None or category.project_id != project_id:
            raise HTTPException(status_code=400, detail="分类不存在或不属于该项目")
        asset_category_id = category_id

    asset = Asset(
        project_id=project_id,
        category_id=asset_category_id,
        name=name,
        description=description,
        tags=_parse_tags(tags),
        created_by=user.id,
    )
    db.add(asset)
    db.flush()

    cos = storage_config.cos_params(db)
    staged = storage.stage_upload(file)
    # 图片资产可能要用文件本身派生封面，且临时文件稍后会被移走，这里先读出来。
    # 只对图片格式读入内存，避免大模型文件占用。
    file_bytes = (
        staged["tmp_path"].read_bytes()
        if staged["file_format"] in storage.DERIVABLE_FORMATS
        else None
    )
    reuse = _find_reusable_version(
        db, project_id, staged["file_hash"], _target_storage(cos), cos
    )
    if reuse is not None:
        storage.discard_staged(staged["tmp_path"])
        placed = {"file_path": reuse.file_path, "storage": reuse.storage}
        deduped = True
    else:
        placed = storage.place_upload(
            staged["tmp_path"], project_id, asset.id, 1, staged["file_name"], cos
        )
        deduped = False

    raw_thumb, thumb_name = storage.read_upload(thumbnail)
    try:
        storage.ensure_image_size(raw_thumb)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    cover = storage.save_asset_cover(asset.id, raw_thumb, thumb_name, cos)
    version_thumb = storage.save_version_thumbnail(asset.id, 1, raw_thumb, thumb_name, cos)
    # 版本自己的 42×42 小图：文件本身就是图片时直接从文件派生（不用重复上传）
    version_small = storage.store_version_small(
        asset.id, 1, storage.derive_small(file_bytes), cos
    )

    # 没单独传封面时，若资产文件本身就是图片，直接拿它派生封面（不必重复上传）
    if not cover["main"]["path"] and file_bytes:
        derived = storage.derive_cover_from_file(
            asset.id, file_bytes, staged["file_name"], cos
        )
        if derived:
            cover = derived

    db.add(
        AssetVersion(
            asset_id=asset.id,
            version=1,
            is_latest=True,
            changelog=changelog,
            thumbnail=version_thumb["path"],
            thumbnail_storage=version_thumb["storage"],
            thumb_small=version_small["path"],
            thumb_small_storage=version_small["storage"],
            storage=placed["storage"],
            file_path=placed["file_path"],
            file_name=staged["file_name"],
            file_size=staged["file_size"],
            file_format=staged["file_format"],
            file_hash=staged["file_hash"],
            uploader_id=user.id,
        )
    )
    asset.cover_thumbnail = cover["main"]["path"]
    asset.cover_thumbnail_storage = cover["main"]["storage"]
    asset.small_thumbnail = cover["small"]["path"]
    asset.small_thumbnail_storage = cover["small"]["storage"]

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
    if not can_edit_asset(asset, user):
        raise HTTPException(
            status_code=403, detail="仅资产创建者或高级管理员可编辑该资产"
        )

    if name is not None:
        asset.name = name
    if description is not None:
        asset.description = description
    if tags is not None:
        asset.tags = _parse_tags(tags)
    if category_id is not None:
        # 0 表示移到根目录（category_id = NULL）
        if category_id == 0:
            asset.category_id = None
        else:
            category = db.get(Category, category_id)
            if category is None or category.project_id != asset.project_id:
                raise HTTPException(status_code=400, detail="分类不存在或不属于该项目")
            asset.category_id = category_id

    # 换封面：只改资产级封面（含 42×42 小图），不动任何版本的缩略图
    if thumbnail is not None and thumbnail.filename:
        cos = storage_config.cos_params(db)
        raw, name = storage.read_upload(thumbnail)
        cover = storage.save_asset_cover(asset.id, raw, name, cos)
        if cover["main"]["path"]:
            storage.delete_file(
                asset.cover_thumbnail, asset.cover_thumbnail_storage or "local", cos
            )
            storage.delete_file(
                asset.small_thumbnail, asset.small_thumbnail_storage or "local", cos
            )
            asset.cover_thumbnail = cover["main"]["path"]
            asset.cover_thumbnail_storage = cover["main"]["storage"]
            asset.small_thumbnail = cover["small"]["path"]
            asset.small_thumbnail_storage = cover["small"]["storage"]

    db.commit()
    db.refresh(asset)
    return asset_to_dict(asset, include_versions=True, current_user_id=user.id)


@router.patch("/assets/{asset_id}/category")
def move_asset(
    asset_id: int,
    payload: AssetMoveRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """把资产移动到指定文件夹（分类）。

    项目所有者/高级管理员可移动项目内任意资产，成员仅可移动自己创建的。
    """
    asset = db.get(Asset, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="资产不存在")

    project = db.get(Project, asset.project_id)
    if not (
        is_super_admin(user)
        or (project is not None and project.owner_id == user.id)
        or asset.created_by == user.id
    ):
        raise HTTPException(
            status_code=403, detail="仅资产创建者或项目所有者可移动该资产"
        )

    if payload.category_id:
        category = db.get(Category, payload.category_id)
        if category is None or category.project_id != asset.project_id:
            raise HTTPException(status_code=400, detail="文件夹不存在或不属于该项目")
        asset.category_id = payload.category_id
    else:
        # 0 表示移到项目根目录
        asset.category_id = None
    db.commit()
    db.refresh(asset)
    return asset_to_dict(asset, current_user_id=user.id)


@router.delete("/assets/{asset_id}")
def delete_asset(
    asset_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    asset = db.get(Asset, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="资产不存在")

    if not can_edit_asset(asset, user):
        raise HTTPException(
            status_code=403, detail="仅资产创建者或高级管理员可删除该资产"
        )

    project_id = asset.project_id
    cos = storage_config.cos_params(db)

    # 清理关联关系、缩略图与实体文件
    db.query(AssetRelation).filter(
        (AssetRelation.from_asset_id == asset_id)
        | (AssetRelation.to_asset_id == asset_id)
    ).delete(synchronize_session=False)

    for v in asset.versions:
        storage.delete_file(v.thumbnail, v.thumbnail_storage or "local", cos)
        storage.delete_file(v.thumb_small, v.thumb_small_storage or "local", cos)
        if v.storage == "cos":
            storage.delete_file(v.file_path, "cos", cos)
    storage.delete_asset_dir(project_id, asset_id)

    db.delete(asset)
    db.commit()
    return {"ok": True}
