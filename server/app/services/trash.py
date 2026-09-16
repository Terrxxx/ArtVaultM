"""资产回收站：软删除、恢复、到期清理。

进回收站只打时间标记，文件与版本都留着；恢复时尽量放回原来的文件夹，
文件夹已经不在了（比如删文件夹时级联进来的）就落到项目根目录。
"""

from datetime import datetime, timedelta
from typing import List

from sqlalchemy.orm import Session

from ..models import Asset, Folder

# 保留期，过期后由 purge_expired_trash 彻底删除
TRASH_TTL_DAYS = 30


def alive():
    """「未进回收站」的过滤条件，各处的资产查询都应挂上它。"""
    return Asset.deleted_at.is_(None)


def is_deleted(asset: Asset) -> bool:
    return asset is not None and asset.deleted_at is not None


def soft_delete(asset: Asset) -> None:
    """进回收站：记住原文件夹后把 folder_id 让出来，避免删文件夹时挂着空引用。"""
    asset.deleted_at = datetime.utcnow()
    asset.deleted_from_folder_id = asset.folder_id
    asset.folder_id = None


def restore(db: Session, asset: Asset) -> None:
    """恢复：原文件夹还在就回去，不在了就落在根目录。"""
    folder_id = asset.deleted_from_folder_id
    if folder_id and db.get(Folder, folder_id) is None:
        folder_id = None
    asset.folder_id = folder_id
    asset.deleted_at = None
    asset.deleted_from_folder_id = None


def expired(db: Session) -> List[Asset]:
    deadline = datetime.utcnow() - timedelta(days=TRASH_TTL_DAYS)
    return (
        db.query(Asset)
        .filter(Asset.deleted_at.isnot(None), Asset.deleted_at < deadline)
        .all()
    )
