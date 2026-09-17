from typing import Optional

from .models import Asset, AssetVersion, Category, Folder, Project, ProjectMember, User
from .services import clock, storage
from .services.folders import subtree_counts
from .services.permissions import (
    can_contribute,
    can_delete_asset,
    can_delete_folder,
    can_edit_asset,
    can_edit_project,
    can_move_asset,
)


def user_brief(u: Optional[User]) -> Optional[dict]:
    if u is None:
        return None
    return {
        "id": u.id,
        "username": u.username,
        "nickname": u.nickname,
        "avatar": u.avatar,
        "avatar_url": storage.display_url(u.avatar, u.avatar_storage or "local"),
        "github_url": u.github_url,
    }


def user_out(u: User) -> dict:
    """带头像直链的完整用户信息（供 /auth/me、管理后台使用）。"""
    return {
        **user_brief(u),
        "role": u.role,
        "status": u.status,
        "deleted_at": clock.fmt_dt(u.deleted_at),
        "created_at": clock.fmt_dt(u.created_at),
    }


def version_to_dict(v: AssetVersion) -> dict:
    return {
        "id": v.id,
        "asset_id": v.asset_id,
        "version": v.version,
        "file_name": v.file_name,
        "file_size": v.file_size,
        "file_format": v.file_format,
        "file_hash": v.file_hash,
        "thumbnail": v.thumbnail,
        "thumbnail_url": storage.display_url(v.thumbnail, v.thumbnail_storage or "local"),
        # 版本自己的 42×42 小图（图片版本才有，由该版本的文件派生）
        "thumb_small_url": storage.display_url(
            v.thumb_small, v.thumb_small_storage or "local"
        ),
        "changelog": v.changelog,
        "is_latest": v.is_latest,
        "download_count": len(v.downloads),
        "uploader": user_brief(v.uploader),
        "created_at": clock.fmt_dt(v.created_at),
    }


def asset_to_dict(
    a: Asset, include_versions: bool = False, viewer: Optional[User] = None
) -> dict:
    """viewer 传当前登录用户：既用于 liked_by_me，也用于算 can_edit / can_delete。"""
    current_user_id = viewer.id if viewer else None
    latest = None
    for v in a.versions:
        if v.is_latest:
            latest = v
    if latest is None and a.versions:
        latest = a.versions[0]

    # 封面是资产级字段，始终展示它；没有设置时回落到最新版本的缩略图
    cover_path = a.cover_thumbnail
    cover_storage = a.cover_thumbnail_storage or "local"
    if not cover_path and latest is not None and latest.thumbnail:
        cover_path = latest.thumbnail
        cover_storage = latest.thumbnail_storage or "local"

    data = {
        "id": a.id,
        "project_id": a.project_id,
        "category_id": a.category_id,
        "folder_id": a.folder_id,
        "name": a.name,
        "description": a.description,
        "tags": a.tags or [],
        "cover_thumbnail": a.cover_thumbnail,
        "cover_thumbnail_url": storage.display_url(cover_path, cover_storage),
        # 42×42 资产小图（由封面派生，仅图片资产有）
        "small_thumbnail_url": storage.display_url(
            a.small_thumbnail, a.small_thumbnail_storage or "local"
        ),
        "status": a.status,
        "created_by": a.created_by,
        "creator": user_brief(a.creator),
        "category_name": a.category.name if a.category else None,
        "folder_name": a.folder.name if a.folder else None,
        "project_name": a.project.name if a.project else None,
        "project_slug": a.project.slug if a.project else None,
        "project_owner": user_brief(a.project.owner) if a.project else None,
        "created_at": clock.fmt_dt(a.created_at),
        "version_count": len(a.versions),
        "latest_version": version_to_dict(latest) if latest else None,
        "like_count": len(a.likes),
        "liked_by_me": (
            any(l.user_id == current_user_id for l in a.likes)
            if current_user_id is not None
            else False
        ),
        # 能力字段：前端据此显示按钮，不再自己推算权限
        "can_edit": can_edit_asset(a, viewer),
        "can_delete": can_delete_asset(a, viewer),
        "can_move": can_move_asset(a, viewer),
    }
    if include_versions:
        data["versions"] = [version_to_dict(v) for v in a.versions]
    return data


def categories_in_display_order(categories) -> list:
    """资产类型的展示顺序：自己新建的置顶（越新越靠前，id 递增即创建顺序），
    系统预置的按原有顺序跟在后面。"""
    custom = sorted(
        (c for c in categories if not c.is_system), key=lambda c: c.id, reverse=True
    )
    system = sorted((c for c in categories if c.is_system), key=lambda c: c.sort_order)
    return custom + system


def category_to_dict(c: Category) -> dict:
    """资产类型：平铺的一份声明。"""
    return {
        "id": c.id,
        "project_id": c.project_id,
        "name": c.name,
        "sort_order": c.sort_order,
        "is_system": c.is_system,
        "asset_count": len(c.assets),
    }


def folder_to_dict(f: Folder, viewer: Optional[User] = None) -> dict:
    subtree_assets, subtree_folders = subtree_counts(f)
    return {
        "id": f.id,
        "project_id": f.project_id,
        "parent_id": f.parent_id,
        "name": f.name,
        "sort_order": f.sort_order,
        "asset_count": sum(1 for a in f.assets if a.deleted_at is None),
        "subtree_asset_count": subtree_assets,
        "subtree_folder_count": subtree_folders,
        # 能力字段：成员也能整理文件夹，但子树里有资产时只有创建者/高级管理员能删
        "can_manage": can_contribute(f.project, viewer),
        "can_delete": can_delete_folder(f, viewer),
    }


def member_to_dict(m: ProjectMember) -> dict:
    return {
        "id": m.id,
        "user": user_brief(m.user),
        "status": m.status,
        "created_at": clock.fmt_dt(m.created_at),
    }


def project_to_dict(
    p: Project,
    include_categories: bool = False,
    include_members: bool = False,
    include_folders: bool = False,
    viewer: Optional[User] = None,
) -> dict:
    accepted = [m for m in p.members if m.status == "accepted"]
    pending = [m for m in p.members if m.status != "accepted"]
    data = {
        "id": p.id,
        "name": p.name,
        "slug": p.slug,
        "description": p.description,
        "github_repo_url": p.github_repo_url,
        "cover_url": p.cover_url,
        "visibility": p.visibility,
        "is_archived": bool(p.is_archived),
        "owner_id": p.owner_id,
        "owner": user_brief(p.owner),
        "created_at": clock.fmt_dt(p.created_at),
        "asset_count": sum(1 for a in p.assets if a.deleted_at is None),
        "category_count": len(p.categories),
        "folder_count": len(p.folders),
        "member_count": len(accepted),
        "pending_count": len(pending),
        # 能力字段：can_edit 管项目设置，can_contribute 管上传/整理文件夹
        "can_edit": can_edit_project(p, viewer),
        "can_contribute": can_contribute(p, viewer),
    }
    if include_categories:
        data["categories"] = [
            category_to_dict(c) for c in categories_in_display_order(p.categories)
        ]
    if include_folders:
        data["folders"] = [folder_to_dict(f, viewer) for f in p.folders]
    if include_members:
        data["members"] = [member_to_dict(m) for m in accepted]
        data["pending_members"] = [member_to_dict(m) for m in pending]
    return data
