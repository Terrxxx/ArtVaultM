from typing import Optional

from .models import Asset, AssetVersion, Category, Project, ProjectMember, User
from .services import storage


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
        "created_at": u.created_at.isoformat() if u.created_at else None,
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
        "thumb_small": v.thumb_small,
        "thumb_small_url": storage.display_url(
            v.thumb_small, v.thumb_small_storage or "local"
        ),
        "changelog": v.changelog,
        "is_latest": v.is_latest,
        "download_count": len(v.downloads),
        "uploader": user_brief(v.uploader),
        "created_at": v.created_at.isoformat() if v.created_at else None,
    }


def asset_to_dict(
    a: Asset, include_versions: bool = False, current_user_id: Optional[int] = None
) -> dict:
    latest = None
    for v in a.versions:
        if v.is_latest:
            latest = v
    if latest is None and a.versions:
        latest = a.versions[0]

    # 封面来自某个版本的缩略图，反查它的存储位置（本地 / COS）
    cover_storage = "local"
    if a.cover_thumbnail:
        for v in a.versions:
            if v.thumbnail == a.cover_thumbnail:
                cover_storage = v.thumbnail_storage or "local"
                break

    data = {
        "id": a.id,
        "project_id": a.project_id,
        "category_id": a.category_id,
        "name": a.name,
        "description": a.description,
        "tags": a.tags or [],
        "cover_thumbnail": a.cover_thumbnail,
        "cover_thumbnail_url": storage.display_url(a.cover_thumbnail, cover_storage),
        "status": a.status,
        "created_by": a.created_by,
        "creator": user_brief(a.creator),
        "category_name": a.category.name if a.category else None,
        "project_name": a.project.name if a.project else None,
        "project_slug": a.project.slug if a.project else None,
        "project_owner": user_brief(a.project.owner) if a.project else None,
        "created_at": a.created_at.isoformat() if a.created_at else None,
        "version_count": len(a.versions),
        "latest_version": version_to_dict(latest) if latest else None,
        "like_count": len(a.likes),
        "liked_by_me": (
            any(l.user_id == current_user_id for l in a.likes)
            if current_user_id is not None
            else False
        ),
    }
    if include_versions:
        data["versions"] = [version_to_dict(v) for v in a.versions]
    return data


def category_to_dict(c: Category) -> dict:
    return {
        "id": c.id,
        "project_id": c.project_id,
        "name": c.name,
        "sort_order": c.sort_order,
        "is_system": c.is_system,
        "asset_count": len(c.assets),
    }


def member_to_dict(m: ProjectMember) -> dict:
    return {
        "id": m.id,
        "user": user_brief(m.user),
        "status": m.status,
        "created_at": m.created_at.isoformat() if m.created_at else None,
    }


def project_to_dict(
    p: Project, include_categories: bool = False, include_members: bool = False
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
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "asset_count": len(p.assets),
        "category_count": len(p.categories),
        "member_count": len(accepted),
        "pending_count": len(pending),
    }
    if include_categories:
        data["categories"] = [category_to_dict(c) for c in p.categories]
    if include_members:
        data["members"] = [member_to_dict(m) for m in accepted]
        data["pending_members"] = [member_to_dict(m) for m in pending]
    return data
