from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Asset, AssetVersion, Category, Folder, Project, User
from ..schemas import AssetMoveRequest
from ..serializers import asset_to_dict, user_brief
from ..services import badges, chunked_upload, notify, storage, storage_config, trash
from ..services.permissions import can_delete_asset, can_manage_trash, can_move_asset
from .deps import ensure_project_access, get_current_user

router = APIRouter()


def _parse_tags(raw: Optional[str]) -> List[str]:
    if not raw:
        return []
    return [t.strip() for t in raw.split(",") if t.strip()]


def _target_storage(cos: Optional[dict]) -> str:
    return "cos" if cos else "local"


def take_staged(file: Optional[UploadFile], upload_id: Optional[str], user: User) -> dict:
    """两种文件入口：小文件直接 POST，大文件先走分片（upload_id），到这里再合并。

    返回的结构与 storage.stage_upload 一致，后面的去重/落盘/派生逻辑两条路共用。
    """
    if upload_id:
        try:
            return chunked_upload.finish(upload_id, user.id)
        except chunked_upload.UploadSessionError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    if file is None or not file.filename:
        raise HTTPException(status_code=400, detail="缺少文件")
    return storage.stage_upload(file)


def purge_asset(db: Session, asset: Asset, cos: Optional[dict]) -> None:
    """删除资产本体：各版本缩略图与 COS 实体文件。由调用方负责 commit。"""
    for v in asset.versions:
        storage.delete_file(v.thumbnail, v.thumbnail_storage or "local", cos)
        storage.delete_file(v.thumb_small, v.thumb_small_storage or "local", cos)
        if v.storage == "cos":
            storage.delete_file(v.file_path, "cos", cos)
    storage.delete_asset_dir(asset.project_id, asset.id)

    db.delete(asset)


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
    folder_id: Optional[int] = None,
    category_id: Optional[int] = None,
    q: Optional[str] = None,
    tag: Optional[str] = None,
    fmt: Optional[str] = None,
    limit: Optional[int] = None,
    offset: int = 0,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """列项目里的资产。

    limit/offset 在**所有筛选之后**才切（搜索、标签、格式都可能有 Python 侧过滤），
    同时序列化也只做切出来的那一段——资产多的时候这一步才是主要开销。
    limit 不传就是全部，兼容老调用方。
    """
    ensure_project_access(db, project_id, user)
    base = db.query(Asset).filter(Asset.project_id == project_id, trash.alive())

    # 0 表示根目录（folder_id 为 NULL），与前端「0 = 根」哨兵保持一致
    if folder_id == 0:
        base = base.filter(Asset.folder_id.is_(None))
    elif folder_id:
        base = base.filter(Asset.folder_id == folder_id)

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

    if tag:
        assets = [a for a in assets if tag in (a.tags or [])]

    # 版本关系已按 version desc 排序，取第一个即最新版本
    if fmt:
        fmt_low = fmt.lower()
        assets = [a for a in assets if a.versions and a.versions[0].file_format == fmt_low]

    if limit is not None:
        assets = assets[offset : offset + max(0, limit)]

    return [asset_to_dict(a, viewer=user) for a in assets]


@router.post("/assets")
def create_asset(
    project_id: int = Form(...),
    folder_id: Optional[int] = Form(None),
    category_id: Optional[int] = Form(None),
    name: str = Form(...),
    description: Optional[str] = Form(None),
    tags: Optional[str] = Form(None),
    changelog: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
    upload_id: Optional[str] = Form(None),
    thumbnail: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = ensure_project_access(db, project_id, user, write=True)
    # 0/None 表示放到项目根目录
    asset_folder_id: Optional[int] = None
    if folder_id:
        folder = db.get(Folder, folder_id)
        if folder is None or folder.project_id != project_id:
            raise HTTPException(status_code=400, detail="文件夹不存在或不属于该项目")
        asset_folder_id = folder_id

    # 资产类型是选填的声明，可以为空
    asset_category_id: Optional[int] = None
    if category_id:
        category = db.get(Category, category_id)
        if category is None or category.project_id != project_id:
            raise HTTPException(status_code=400, detail="资产类型不存在或不属于该项目")
        asset_category_id = category_id

    asset = Asset(
        project_id=project_id,
        folder_id=asset_folder_id,
        category_id=asset_category_id,
        name=name,
        description=description,
        tags=_parse_tags(tags),
        created_by=user.id,
    )
    db.add(asset)
    db.flush()

    cos = storage_config.cos_params(db)
    staged = take_staged(file, upload_id, user)
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

    new_badges = badges.sync(db, user.id)

    db.commit()
    db.refresh(asset)
    data = asset_to_dict(asset, include_versions=True, viewer=user)
    data["deduped"] = deduped
    data["new_badges"] = new_badges
    return data


@router.get("/assets/{asset_id}")
def get_asset(
    asset_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    asset = db.get(Asset, asset_id)
    if asset is None or trash.is_deleted(asset):
        raise HTTPException(status_code=404, detail="资产不存在")
    ensure_project_access(db, asset.project_id, user)
    return asset_to_dict(asset, include_versions=True, viewer=user)


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
    # 项目内的资产由项目成员共同维护：成员/所有者/高级管理员都能改
    ensure_project_access(db, asset.project_id, user, write=True)

    if name is not None:
        asset.name = name
    if description is not None:
        asset.description = description
    if tags is not None:
        asset.tags = _parse_tags(tags)
    if category_id is not None:
        # 0 表示清空资产类型
        if category_id == 0:
            asset.category_id = None
        else:
            category = db.get(Category, category_id)
            if category is None or category.project_id != asset.project_id:
                raise HTTPException(status_code=400, detail="资产类型不存在或不属于该项目")
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

    # 描述 / 标签 / 封面都能推进成就，给编辑者记一次
    new_badges = badges.sync(db, user.id)

    db.commit()
    db.refresh(asset)
    data = asset_to_dict(asset, include_versions=True, viewer=user)
    data["new_badges"] = new_badges
    return data


@router.patch("/assets/{asset_id}/folder")
def move_asset(
    asset_id: int,
    payload: AssetMoveRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """把资产移动到指定文件夹。

    项目所有者/高级管理员可移动项目内任意资产，成员仅可移动自己创建的。
    """
    asset = db.get(Asset, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="资产不存在")

    if not can_move_asset(asset, user):
        raise HTTPException(
            status_code=403, detail="仅资产创建者或项目所有者可移动该资产"
        )

    if payload.folder_id:
        folder = db.get(Folder, payload.folder_id)
        if folder is None or folder.project_id != asset.project_id:
            raise HTTPException(status_code=400, detail="文件夹不存在或不属于该项目")
        asset.folder_id = payload.folder_id
    else:
        # 0 表示移到项目根目录
        asset.folder_id = None
    db.commit()
    db.refresh(asset)
    return asset_to_dict(asset, viewer=user)


@router.delete("/assets/{asset_id}")
def delete_asset(
    asset_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    asset = db.get(Asset, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="资产不存在")

    if not can_delete_asset(asset, user):
        raise HTTPException(
            status_code=403, detail="仅资产创建者或高级管理员可删除该资产"
        )

    # 进回收站：文件留着，满 TRASH_TTL_DAYS 天才会被彻底删除
    trash.soft_delete(asset)
    db.commit()
    return {"ok": True, "trashed": True}


def purge_expired_trash(db: Session) -> int:
    """回收站里超过保留期的资产彻底删除（含实体文件）。"""
    rows = trash.expired(db)
    if not rows:
        return 0
    cos = storage_config.cos_params(db)
    for asset in rows:
        purge_asset(db, asset, cos)
    db.commit()
    return len(rows)


def _trash_item(asset: Asset, viewer: User) -> dict:
    latest = next((v for v in asset.versions if v.is_latest), None) or (
        asset.versions[0] if asset.versions else None
    )
    cover_path = asset.cover_thumbnail or (latest.thumbnail if latest else None)
    cover_storage = asset.cover_thumbnail_storage or (
        latest.thumbnail_storage if latest and not asset.cover_thumbnail else "local"
    )
    return {
        "id": asset.id,
        "name": asset.name,
        "project_id": asset.project_id,
        "creator": user_brief(asset.creator),
        "version_count": len(asset.versions),
        "cover_thumbnail_url": storage.display_url(cover_path, cover_storage),
        "deleted_at": asset.deleted_at.isoformat() if asset.deleted_at else None,
        "deleted_from_folder_id": asset.deleted_from_folder_id,
        "can_manage": can_manage_trash(asset, viewer),
    }


@router.get("/projects/{project_id}/trash")
def list_trash(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """项目回收站。打开时顺手清掉过期的，省得再挂定时任务。"""
    ensure_project_access(db, project_id, user)
    purge_expired_trash(db)
    rows = (
        db.query(Asset)
        .filter(Asset.project_id == project_id, Asset.deleted_at.isnot(None))
        .order_by(Asset.deleted_at.desc())
        .all()
    )
    return [_trash_item(a, user) for a in rows]


@router.post("/assets/{asset_id}/restore")
def restore_asset(
    asset_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    asset = db.get(Asset, asset_id)
    if asset is None or not trash.is_deleted(asset):
        raise HTTPException(status_code=404, detail="回收站里没有这个资产")
    if not can_manage_trash(asset, user):
        raise HTTPException(status_code=403, detail="没有权限恢复该资产")
    trash.restore(db, asset)
    db.commit()
    return {"ok": True, "folder_id": asset.folder_id}


@router.delete("/assets/{asset_id}/purge")
def purge_trashed_asset(
    asset_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """彻底删除：连文件一起抹掉。"""
    asset = db.get(Asset, asset_id)
    if asset is None or not trash.is_deleted(asset):
        raise HTTPException(status_code=404, detail="回收站里没有这个资产")
    if not can_manage_trash(asset, user):
        raise HTTPException(status_code=403, detail="没有权限彻底删除该资产")
    purge_asset(db, asset, storage_config.cos_params(db))
    db.commit()
    return {"ok": True}
