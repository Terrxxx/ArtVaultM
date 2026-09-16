from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Asset, User
from ..serializers import asset_to_dict, user_brief
from ..services import badges, stats
from .deps import get_current_user

router = APIRouter()

# 排行榜可选的时间窗口
RANK_WINDOWS = (7, 30, 365)


def _parse_days(days: int) -> int:
    return days if days in RANK_WINDOWS else 30


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


@router.get("/leaderboard")
def uploader_leaderboard(
    days: int = 30,
    limit: int = 10,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """全局活跃榜：7/30/365 天内上传版本最多的用户。

    只统计当前访问者有权看到的项目，避免把别人私有项目里的活跃度暴露出来。
    """
    window = _parse_days(days)
    return {
        "days": window,
        "items": stats.uploader_ranking(
            db,
            days=window,
            visible_project_ids=stats.project_ids_visible_to(db, user),
            limit=limit,
        ),
    }


def _get_active_user(db: Session, **filters) -> User:
    """按条件取用户；已软删除的视为不存在。"""
    target = db.query(User).filter_by(**filters).first()
    if target is None or target.deleted_at is not None:
        raise HTTPException(status_code=404, detail="用户不存在")
    return target


def _profile_payload(db: Session, target: User, viewer: User) -> dict:
    """该用户在哪些项目里上传了哪些资产。

    统计数字是**完整**的（不因访问者权限而缩水）；
    展示部分按访问者权限过滤，无权查看的私有项目只给占位。
    """
    all_assets = (
        db.query(Asset)
        .filter(Asset.created_by == target.id, Asset.deleted_at.is_(None))
        .order_by(Asset.created_at.desc())
        .all()
    )

    complete_stats = {
        "asset_count": len(all_assets),
        "project_count": len({a.project_id for a in all_assets}),
        "version_count": sum(len(a.versions) for a in all_assets),
    }

    visible = stats.project_ids_visible_to(db, viewer)  # None = 不受限

    grouped: dict = {}
    restricted_ids = set()
    for a in all_assets:
        if visible is not None and a.project_id not in visible:
            restricted_ids.add(a.project_id)
            continue
        bucket = grouped.setdefault(a.project_id, {"project": a.project, "assets": []})
        bucket["assets"].append(asset_to_dict(a, viewer=viewer))

    projects = [
        {
            "project_id": pid,
            "project_name": b["project"].name if b["project"] else "",
            "github_repo_url": b["project"].github_repo_url if b["project"] else None,
            "assets": b["assets"],
            "restricted": False,
        }
        for pid, b in grouped.items()
    ]

    # 无权查看的私有项目：不暴露名称，只给占位
    for _pid in sorted(restricted_ids):
        projects.append(
            {
                "project_id": None,
                "project_name": None,
                "github_repo_url": None,
                "assets": [],
                "restricted": True,
            }
        )

    return {
        "user": user_brief(target),
        "stats": complete_stats,
        "projects": projects,
        "badges": badges.compute(db, target.id),
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
    payload = stats.daily_counts(db, chosen, user_id=target.id)
    return {"years": years, "year": chosen, "days": payload}


@router.get("/users/by-username/{username}/updates")
def user_updates_by_username(
    username: str,
    date_str: Optional[str] = Query(None, alias="date"),
    limit: int = 20,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """个人更新日志：给了 date 就返回当天全部更新，否则返回最近若干条。

    落在访问者无权查看的私有项目里的更新，只回「私有仓库」占位。
    """
    target = _get_active_user(db, username=username)
    on_date = stats.parse_date(date_str)
    return {
        "date": date_str if on_date else None,
        "items": stats.update_log(
            db,
            limit=limit,
            on_date=on_date,
            user_id=target.id,
            visible_project_ids=stats.project_ids_visible_to(db, user),
        ),
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
