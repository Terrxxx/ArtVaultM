"""热度与活跃度统计。

热度值用于「广场」排序：综合内容体量、结构丰富度、下载量与近期更新频率。
权重集中在这里，便于按口味调整。
"""

import math
from datetime import date, datetime, timedelta
from typing import List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models import Asset, AssetVersion, Category, DownloadLog
from . import storage

# 热度权重
W_ASSETS = 2.0  # 每个资产
W_CATEGORIES = 1.0  # 每个分类
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
        .filter(Asset.project_id.in_(project_ids))
        .group_by(Asset.project_id)
        .all()
    )
    category_counts = dict(
        db.query(Category.project_id, func.count(Category.id))
        .filter(Category.project_id.in_(project_ids))
        .group_by(Category.project_id)
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
    since = datetime.utcnow() - timedelta(days=RECENT_DAYS)
    recent_counts = dict(
        db.query(Asset.project_id, func.count(AssetVersion.id))
        .join(AssetVersion, AssetVersion.asset_id == Asset.id)
        .filter(
            Asset.project_id.in_(project_ids),
            AssetVersion.created_at >= since,
        )
        .group_by(Asset.project_id)
        .all()
    )

    scores = {}
    for pid in project_ids:
        assets = asset_counts.get(pid, 0)
        categories = category_counts.get(pid, 0)
        downloads = download_counts.get(pid, 0)
        recent = recent_counts.get(pid, 0)
        scores[pid] = round(
            W_ASSETS * assets
            + W_CATEGORIES * categories
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
    query = db.query(AssetVersion)
    if project_id is not None:
        query = query.join(Asset, AssetVersion.asset_id == Asset.id).filter(
            Asset.project_id == project_id
        )
    if user_id is not None:
        query = query.filter(AssetVersion.uploader_id == user_id)
    return query


def activity_years(
    db: Session, project_id: Optional[int] = None, user_id: Optional[int] = None
) -> List[int]:
    """有更新记录的年份列表（注册/建项目那年至今）。"""
    query = _base_version_query(db, project_id, user_id)
    earliest = query.with_entities(func.min(AssetVersion.created_at)).scalar()
    current = datetime.utcnow().year
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
    """把年份选择器转成时间区间。

    "recent" / None → 滚动最近 12 个月（GitHub 默认视图）
    具体年份        → 该自然年
    """
    if selector in (None, "", "recent"):
        today = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        return today - timedelta(days=364), today + timedelta(days=1)
    year = int(selector)
    return datetime(year, 1, 1), datetime(year + 1, 1, 1)


def daily_counts(
    db: Session,
    year,
    project_id: Optional[int] = None,
    user_id: Optional[int] = None,
) -> List[dict]:
    """某个时间区间内按天的更新次数（热力图数据）。"""
    start, end = year_range(year)

    day = func.date(AssetVersion.created_at)
    rows = (
        _base_version_query(db, project_id, user_id)
        .filter(AssetVersion.created_at >= start, AssetVersion.created_at < end)
        .with_entities(day.label("day"), func.count(AssetVersion.id))
        .group_by(day)
        .order_by(day)
        .all()
    )
    return [{"date": str(d), "count": int(c)} for d, c in rows]


def _iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat() if dt else None


def update_log(
    db: Session,
    limit: int = 20,
    on_date: Optional[date] = None,
    project_id: Optional[int] = None,
    user_id: Optional[int] = None,
) -> List[dict]:
    """更新记录列表：某一天全部更新，或最近若干条。"""
    query = _base_version_query(db, project_id, user_id)

    if on_date is not None:
        start = datetime(on_date.year, on_date.month, on_date.day)
        query = query.filter(
            AssetVersion.created_at >= start,
            AssetVersion.created_at < start + timedelta(days=1),
        )

    rows = (
        query.order_by(AssetVersion.created_at.desc()).limit(max(1, min(limit, 200))).all()
    )

    result = []
    for v in rows:
        asset = v.asset
        project = asset.project if asset else None
        result.append(
            {
                "version_id": v.id,
                "version": v.version,
                "changelog": v.changelog,
                "file_name": v.file_name,
                "created_at": _iso(v.created_at),
                "asset_id": v.asset_id,
                "asset_name": asset.name if asset else None,
                "project_id": asset.project_id if asset else None,
                "project_name": project.name if project else None,
                "uploader": {
                    "id": v.uploader.id,
                    "username": v.uploader.username,
                    "nickname": v.uploader.nickname,
                    "avatar_url": storage.display_url(
                        v.uploader.avatar, v.uploader.avatar_storage or "local"
                    ),
                }
                if v.uploader
                else None,
            }
        )
    return result
