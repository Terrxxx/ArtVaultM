"""按文件指纹找库里已有的相同文件。

上传时给个提示（「库里已有一份完全相同的文件，在 X 项目 / Y 资产」），
只在上传者有权看到的项目里找，避免把别人私有项目里的东西暴露出来。
"""

from typing import List, Optional

from sqlalchemy.orm import Session

from ..models import Asset, AssetVersion, Project, User
from . import stats


def find_duplicates(
    db: Session,
    user: User,
    file_hash: Optional[str],
    limit: int = 3,
) -> List[dict]:
    """同指纹、且未进回收站的其它版本。历史行可能没有指纹，直接跳过。

    注意不要把「刚去重复用的那一版」排除掉——它正是要提示的那份文件
    （同项目内复用是默认行为，排掉它就等于最常见的情况下什么都不提示）。
    """
    if not file_hash:
        return []

    visible = stats.project_ids_visible_to(db, user)  # None = 不受限（管理员）
    query = (
        db.query(AssetVersion, Asset, Project)
        .join(Asset, Asset.id == AssetVersion.asset_id)
        .join(Project, Project.id == Asset.project_id)
        .filter(AssetVersion.file_hash == file_hash, Asset.deleted_at.is_(None))
    )
    if visible is not None:
        query = query.filter(Asset.project_id.in_(visible or [-1]))

    rows = query.order_by(AssetVersion.created_at.desc()).limit(limit).all()
    return [
        {
            "project_id": project.id,
            "project_name": project.name,
            "asset_id": asset.id,
            "asset_name": asset.name,
            "version": version.version,
        }
        for version, asset, project in rows
    ]
