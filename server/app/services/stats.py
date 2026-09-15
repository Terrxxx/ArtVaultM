"""热度与活跃度统计。

热度值用于「广场」排序：综合内容体量、结构丰富度、下载量与近期更新频率。
权重集中在这里，便于按口味调整。
"""

import math
from datetime import datetime, timedelta
from typing import List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models import Asset, AssetVersion, Category, DownloadLog, Project

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


def daily_version_counts(
    db: Session,
    days: int = 180,
    project_id: Optional[int] = None,
    user_id: Optional[int] = None,
) -> List[dict]:
    """按天统计资产版本上传次数，用于热力图。

    返回 [{"date": "2026-09-15", "count": 3}, ...]，只含有点击记录的日子。
    """
    since = datetime.utcnow() - timedelta(days=days)
    day = func.date(AssetVersion.created_at)

    query = db.query(day.label("day"), func.count(AssetVersion.id))
    if project_id is not None:
        query = query.join(Asset, AssetVersion.asset_id == Asset.id).filter(
            Asset.project_id == project_id
        )
    if user_id is not None:
        query = query.filter(AssetVersion.uploader_id == user_id)

    rows = (
        query.filter(AssetVersion.created_at >= since)
        .group_by(day)
        .order_by(day)
        .all()
    )
    return [{"date": str(d), "count": int(c)} for d, c in rows]
