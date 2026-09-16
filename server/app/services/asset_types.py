from sqlalchemy.orm import Session

from ..models import Category

# 新建项目自动带上的资产类型，用户可在项目编辑页的「分类管理」里增删改
DEFAULT_ASSET_TYPES = [
    "模型",
    "贴图与材质",
    "动画",
    "特效",
    "音频",
    "UI与图标",
    "场景",
    "概念设计",
    "其他",
]


def seed_default_categories(db: Session, project_id: int) -> None:
    """给项目补上默认资产类型。由调用方负责 commit。"""
    for i, name in enumerate(DEFAULT_ASSET_TYPES):
        db.add(
            Category(project_id=project_id, name=name, sort_order=i, is_system=True)
        )
