from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Asset, User
from ..serializers import asset_to_dict, user_brief
from ..services import stats
from .deps import get_current_user, viewable_project_ids

router = APIRouter()


@router.get("/users/search")
def search_users(
    q: str = "",
    limit: int = 20,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """按昵称或用户名模糊查询用户，用于项目邀请。已删除的账号不出现。"""
    query = db.query(User).filter(
        User.status == "active", User.deleted_at.is_(None)
    )
    keyword = q.strip()
    if keyword:
        like = f"%{keyword}%"
        query = query.filter(User.nickname.ilike(like) | User.username.ilike(like))
    users = query.order_by(User.id).limit(min(limit, 50)).all()
    return [user_brief(u) for u in users]


def _get_active_user(db: Session, **filters) -> User:
    """按条件取用户；已软删除的视为不存在。"""
    target = db.query(User).filter_by(**filters).first()
    if target is None or target.deleted_at is not None:
        raise HTTPException(status_code=404, detail="用户不存在")
    return target


def _profile_payload(db: Session, target: User, viewer: User) -> dict:
    """该用户在哪些项目里上传了哪些资产。"""
    assets = (
        db.query(Asset)
        .filter(Asset.created_by == target.id)
        .order_by(Asset.created_at.desc())
        .all()
    )

    # 只展示当前访问者有权看到的项目
    allowed = viewable_project_ids(db, viewer)
    if allowed is not None:
        assets = [a for a in assets if a.project_id in allowed]

    grouped: dict = {}
    for a in assets:
        bucket = grouped.setdefault(a.project_id, {"project": a.project, "assets": []})
        bucket["assets"].append(asset_to_dict(a, current_user_id=viewer.id))

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


@router.get("/users/by-username/{username}/activity")
def user_activity_by_username(
    username: str,
    year: Optional[str] = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """个人更新热力图：year=recent 或某一年，默认最近 12 个月。"""
    target = _get_active_user(db, username=username)
    years = stats.activity_years(db, user_id=target.id)
    chosen = stats.normalize_year(year, years)
    return {
        "years": years,
        "year": chosen,
        "days": stats.daily_counts(db, chosen, user_id=target.id),
    }


@router.get("/users/by-username/{username}/updates")
def user_updates_by_username(
    username: str,
    date_str: Optional[str] = Query(None, alias="date"),
    limit: int = 20,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """个人更新日志：给了 date 就返回当天全部更新，否则返回最近若干条。"""
    target = _get_active_user(db, username=username)
    on_date = stats.parse_date(date_str)
    return {
        "date": date_str if on_date else None,
        "items": stats.update_log(db, limit=limit, on_date=on_date, user_id=target.id),
    }


@router.get("/users/by-username/{username}")
def get_user_profile_by_username(
    username: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """个人主页按用户名访问（前端路由 /{用户名}）。"""
    target = _get_active_user(db, username=username)
    return _profile_payload(db, target, user)


@router.get("/users/{user_id}")
def get_user_profile(
    user_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    target = db.get(User, user_id)
    if target is None or target.deleted_at is not None:
        raise HTTPException(status_code=404, detail="用户不存在")
    return _profile_payload(db, target, user)
