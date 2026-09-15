from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Asset, Project, ProjectMember, User
from ..serializers import asset_to_dict, user_brief
from .deps import get_current_user, visible_project_ids

router = APIRouter()


@router.get("/users/search")
def search_users(
    q: str = "",
    limit: int = 20,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """按昵称或用户名模糊查询用户，用于项目邀请。"""
    query = db.query(User).filter(User.status == "active")
    keyword = q.strip()
    if keyword:
        like = f"%{keyword}%"
        query = query.filter(User.nickname.ilike(like) | User.username.ilike(like))
    users = query.order_by(User.id).limit(min(limit, 50)).all()
    return [user_brief(u) for u in users]


@router.get("/users/{user_id}")
def get_user_profile(
    user_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """个人资料页：该用户在哪些项目里上传了哪些资产。"""
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="用户不存在")

    assets = (
        db.query(Asset)
        .filter(Asset.created_by == user_id)
        .order_by(Asset.created_at.desc())
        .all()
    )

    # 只展示当前访问者有权看到的项目
    allowed = visible_project_ids(db, user)
    if allowed is not None:
        assets = [a for a in assets if a.project_id in allowed]

    grouped: dict = {}
    for a in assets:
        bucket = grouped.setdefault(a.project_id, {"project": a.project, "assets": []})
        bucket["assets"].append(asset_to_dict(a))

    projects = [
        {
            "project_id": pid,
            "project_name": b["project"].name if b["project"] else "",
            "github_repo_url": b["project"].github_repo_url if b["project"] else None,
            "assets": b["assets"],
        }
        for pid, b in grouped.items()
    ]

    return {
        "user": user_brief(target),
        "stats": {
            "asset_count": len(assets),
            "project_count": len(projects),
            "version_count": sum(len(a.versions) for a in assets),
        },
        "projects": projects,
    }
