"""热度与活跃度统计。

热度值用于「广场」排序：综合内容体量、结构丰富度、下载量与近期更新频率。
权重集中在这里，便于按口味调整。
"""

import math
from datetime import date, datetime, timedelta
from typing import List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models import (
    Asset,
    AssetVersion,
    Folder,
    DownloadLog,
    Project,
    ProjectMember,
    User,
)
from ..serializers import user_brief
from . import clock, storage

# 热度权重
W_ASSETS = 2.0  # 每个资产
W_FOLDERS = 1.0  # 每个文件夹（分类是每个项目都有的默认列表，衡量不出活跃度）
W_DOWNLOADS = 4.0  # log2(1+下载数)，避免大户刷榜
W_RECENT = 10.0  # 近 RECENT_DAYS 天内的每个新版本
RECENT_DAYS = 30


def heat_scores(db: Session, project_ids: List[int]) -> dict:
    """批量计算项目热度，避免逐个查询（N+1）。"""
    if not project_ids:
        return {}

    # 内容体量
    asset_counts = dict(
        db.query(Asset.project_id, func.count(Asset.id))
        .filter(Asset.project_id.in_(project_ids), Asset.deleted_at.is_(None))
        .group_by(Asset.project_id)
        .all()
    )
    folder_counts = dict(
        db.query(Folder.project_id, func.count(Folder.id))
        .filter(Folder.project_id.in_(project_ids))
        .group_by(Folder.project_id)
        .all()
    )
    # 下载量：项目下所有版本的下载记录之和
    download_counts = dict(
        db.query(Asset.project_id, func.count(DownloadLog.id))
        .join(AssetVersion, AssetVersion.asset_id == Asset.id)
        .join(DownloadLog, DownloadLog.asset_version_id == AssetVersion.id)
        .filter(Asset.project_id.in_(project_ids))
        .group_by(Asset.project_id)
        .all()
    )
    # 近期更新：近 RECENT_DAYS 天内新增的版本数
    since = clock.now_utc() - timedelta(days=RECENT_DAYS)
    recent_counts = dict(
        db.query(Asset.project_id, func.count(AssetVersion.id))
        .join(AssetVersion, AssetVersion.asset_id == Asset.id)
        .filter(
            Asset.project_id.in_(project_ids),
            Asset.deleted_at.is_(None),
            AssetVersion.created_at >= since,
        )
        .group_by(Asset.project_id)
        .all()
    )

    scores = {}
    for pid in project_ids:
        assets = asset_counts.get(pid, 0)
        folders = folder_counts.get(pid, 0)
        downloads = download_counts.get(pid, 0)
        recent = recent_counts.get(pid, 0)
        scores[pid] = round(
            W_ASSETS * assets
            + W_FOLDERS * folders
            + W_DOWNLOADS * math.log2(1 + downloads)
            + W_RECENT * recent,
            2,
        )
    return scores


def parse_date(value: Optional[str]) -> Optional[date]:
    """把 YYYY-MM-DD 解析成 date；非法或为空返回 None。"""
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        return None


def _base_version_query(
    db: Session, project_id: Optional[int], user_id: Optional[int]
):
    """按项目或用户圈定版本记录。"""
    # 回收站里的资产不算活跃度；统一 join 上 Asset 才能过滤
    query = db.query(AssetVersion).join(Asset, AssetVersion.asset_id == Asset.id)
    query = query.filter(Asset.deleted_at.is_(None))
    if project_id is not None:
        query = query.filter(Asset.project_id == project_id)
    if user_id is not None:
        query = query.filter(AssetVersion.uploader_id == user_id)
    return query


def activity_years(
    db: Session, project_id: Optional[int] = None, user_id: Optional[int] = None
) -> List[int]:
    """有更新记录的年份列表（注册/建项目那年至今）。"""
    query = _base_version_query(db, project_id, user_id)
    earliest = query.with_entities(func.min(AssetVersion.created_at)).scalar()
    current = clock.today().year
    if earliest is None:
        return [current]
    start = earliest.year if isinstance(earliest, datetime) else int(str(earliest)[:4])
    return list(range(start, current + 1))


def normalize_year(selector, years: List[int]) -> str:
    """把请求的年份规整为 "recent" 或合法的年份字符串。"""
    if selector in (None, "", "recent"):
        return "recent"
    text = str(selector)
    if text.isdigit() and int(text) in years:
        return text
    return "recent"


def year_range(selector) -> tuple:
    """把年份选择器转成查询用的 UTC 区间。

    边界按**服务器本地日期**切，再换算回 UTC 去和库里存的 UTC 值比较；
    热力图的分格与更新日志的「看某一天」都用这套边界，两边才对得上。

    "recent" / None → 滚动最近 12 个月（GitHub 默认视图）
    具体年份        → 该自然年
    """
    if selector in (None, "", "recent"):
        today = clock.today()
        return (
            clock.local_midnight(today - timedelta(days=364)),
            clock.local_midnight(today + timedelta(days=1)),
        )
    year = int(selector)
    return (
        clock.local_midnight(date(year, 1, 1)),
        clock.local_midnight(date(year + 1, 1, 1)),
    )


def daily_counts(
    db: Session,
    year,
    project_id: Optional[int] = None,
    user_id: Optional[int] = None,
) -> List[dict]:
    """某个时间区间内按天的更新次数（热力图数据）。

    分格按服务器本地日期（前端热力图的格子也是本地日期），所以这里把 UTC
    时间戳按本地偏移挪一天再取日期。
    """
    start, end = year_range(year)

    day = func.date(AssetVersion.created_at, *clock.sqlite_day_mods())
    rows = (
        _base_version_query(db, project_id, user_id)
        .filter(AssetVersion.created_at >= start, AssetVersion.created_at < end)
        .with_entities(day.label("day"), func.count(AssetVersion.id))
        .group_by(day)
        .order_by(day)
        .all()
    )
    return [{"date": str(d), "count": int(c)} for d, c in rows]


def uploader_ranking(
    db: Session,
    days: int,
    project_id: Optional[int] = None,
    visible_project_ids: Optional[List[int]] = None,
    limit: int = 10,
) -> List[dict]:
    """按上传版本数给用户排名。

    - project_id 指定时只统计该项目（项目内贡献榜）
    - visible_project_ids 为 None 表示不限；否则只统计这些项目（避免泄露私有项目活跃度）
    """
    since = clock.now_utc() - timedelta(days=days)

    query = (
        db.query(AssetVersion.uploader_id, func.count(AssetVersion.id).label("n"))
        .join(Asset, Asset.id == AssetVersion.asset_id)
        .filter(AssetVersion.created_at >= since)
    )
    if project_id is not None:
        query = query.filter(Asset.project_id == project_id)
    elif visible_project_ids is not None:
        query = query.filter(Asset.project_id.in_(visible_project_ids or [-1]))

    rows = (
        query.group_by(AssetVersion.uploader_id)
        .order_by(func.count(AssetVersion.id).desc())
        .limit(max(1, min(limit, 50)))
        .all()
    )

    result = []
    for uploader_id, count in rows:
        user = db.get(User, uploader_id)
        if user is None or user.deleted_at is not None:
            continue
        result.append({"user": user_brief(user), "count": int(count)})
    return result


def project_ids_visible_to(db: Session, viewer: User) -> Optional[List[int]]:
    """访问者能看到的项目 id 列表；None 表示不受限（管理员）。

    「能看到」= 公开项目，或自己拥有/受邀加入的，或管理员。
    """
    if viewer.role in ("admin", "super_admin"):
        return None

    member_ids = {
        m.project_id
        for m in db.query(ProjectMember)
        .filter(ProjectMember.user_id == viewer.id, ProjectMember.status == "accepted")
        .all()
    }
    owned_ids = {p.id for p in db.query(Project).filter(Project.owner_id == viewer.id).all()}
    public_ids = {
        p.id for p in db.query(Project).filter(Project.visibility == "public").all()
    }
    return list(member_ids | owned_ids | public_ids)


def _iso(dt: Optional[datetime]) -> Optional[str]:
    return clock.fmt_dt(dt)


def update_log(
    db: Session,
    limit: int = 20,
    on_date: Optional[date] = None,
    project_id: Optional[int] = None,
    user_id: Optional[int] = None,
    visible_project_ids: Optional[List[int]] = None,
) -> List[dict]:
    """更新记录列表：某一天全部更新，或最近若干条。

    visible_project_ids 非 None 时，落在其外的记录只回一个「私有仓库」占位，
    不暴露资产名与项目名。
    """
    query = _base_version_query(db, project_id, user_id)

    if on_date is not None:
        start = clock.local_midnight(on_date)
        end = clock.local_midnight(on_date + timedelta(days=1))
        query = query.filter(
            AssetVersion.created_at >= start,
            AssetVersion.created_at < end,
        )

    rows = (
        query.order_by(AssetVersion.created_at.desc()).limit(max(1, min(limit, 200))).all()
    )

    visible = None if visible_project_ids is None else set(visible_project_ids)

    result = []
    for v in rows:
        asset = v.asset
        project = asset.project if asset else None
        uploader = (
            {
                "id": v.uploader.id,
                "username": v.uploader.username,
                "nickname": v.uploader.nickname,
                "avatar_url": storage.display_url(
                    v.uploader.avatar, v.uploader.avatar_storage or "local"
                ),
            }
            if v.uploader
            else None
        )

        if visible is not None and (asset is None or asset.project_id not in visible):
            # 私有项目：只提示，不暴露细节
            result.append(
                {
                    "restricted": True,
                    "version_id": v.id,
                    "created_at": _iso(v.created_at),
                    "uploader": uploader,
                }
            )
            continue

        result.append(
            {
                "restricted": False,
                "version_id": v.id,
                "version": v.version,
                "changelog": v.changelog,
                "file_name": v.file_name,
                "created_at": _iso(v.created_at),
                "asset_id": v.asset_id,
                "asset_name": asset.name if asset else None,
                "project_id": asset.project_id if asset else None,
                "project_name": project.name if project else None,
                "uploader": uploader,
            }
        )
    return result
