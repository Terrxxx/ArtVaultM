from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Category, Project, ProjectMember, User
from ..schemas import ProjectCreate, ProjectUpdate
from ..serializers import project_to_dict
from ..services import stats
from ..services.slug import slugify
from .deps import (
    ensure_project_access,
    ensure_project_editor,
    get_current_user,
    visible_project_ids,
)

router = APIRouter()

SYSTEM_CATEGORIES = [
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


def unique_slug(db: Session, owner_id: int, name: str) -> str:
    """同一所有者的项目 slug 不重复。"""
    base = slugify(name)
    slug = base
    n = 2
    while (
        db.query(Project)
        .filter(Project.owner_id == owner_id, Project.slug == slug)
        .first()
        is not None
    ):
        slug = f"{base}-{n}"
        n += 1
    return slug


@router.post("/projects")
def create_project(
    payload: ProjectCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = Project(
        name=payload.name,
        slug=unique_slug(db, user.id, payload.name),
        description=payload.description,
        github_repo_url=payload.github_repo_url,
        visibility=payload.visibility or "public",
        owner_id=user.id,
    )
    db.add(project)
    db.flush()

    # 归类方式：默认用系统分类，或使用自定义分类
    if payload.category_mode == "custom" and payload.custom_categories:
        names = [n.strip() for n in payload.custom_categories if n and n.strip()]
    else:
        names = list(SYSTEM_CATEGORIES)

    for i, name in enumerate(names):
        db.add(
            Category(
                project_id=project.id,
                name=name,
                sort_order=i,
                is_system=(payload.category_mode != "custom"),
            )
        )

    db.commit()
    db.refresh(project)
    return project_to_dict(project, include_categories=True)


@router.get("/projects")
def list_projects(
    archived: bool = False,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """「我的项目」：只包含自己创建或受邀加入的项目（所有角色都一样）。

    全量项目（含他人私有项目）只在管理后台的 /admin/projects 提供。
    """
    allowed = visible_project_ids(db, user) or []
    projects = (
        db.query(Project)
        .filter(
            Project.is_archived.is_(bool(archived)),
            Project.id.in_(allowed or [0]),
        )
        .order_by(Project.created_at.desc())
        .all()
    )
    return [project_to_dict(p) for p in projects]


@router.get("/projects/by-slug/{username}/{slug}")
def get_project_by_slug(
    username: str,
    slug: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    owner = db.query(User).filter(User.username == username).first()
    if owner is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    project = (
        db.query(Project)
        .filter(Project.owner_id == owner.id, Project.slug == slug)
        .first()
    )
    if project is None:
        raise HTTPException(status_code=404, detail="项目不存在")
    ensure_project_access(db, project.id, user)
    return project_to_dict(project, include_categories=True, include_members=True)


@router.get("/projects/plaza")
def plaza(
    limit: int = 6,
    exclude_own: bool = True,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """广场：按热度值排序的公开项目。

    热度值综合资产数、分类数、下载数与近 30 天更新频率，算法见 services/stats.py。
    默认排除自己拥有的项目，避免和上方「我的项目」重复。
    """
    query = db.query(Project).filter(
        Project.visibility == "public", Project.is_archived.is_(False)
    )
    if exclude_own:
        query = query.filter(Project.owner_id != user.id)
    projects = query.all()
    scores = stats.heat_scores(db, [p.id for p in projects])
    projects.sort(key=lambda p: scores.get(p.id, 0.0), reverse=True)
    return [
        {**project_to_dict(p), "heat": scores.get(p.id, 0.0)}
        for p in projects[: max(1, min(limit, 50))]
    ]


@router.get("/projects/{project_id}/activity")
def project_activity(
    project_id: int,
    year: Optional[str] = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """项目更新热力图：year=recent 或某一年，默认最近 12 个月。"""
    ensure_project_access(db, project_id, user)
    years = stats.activity_years(db, project_id=project_id)
    chosen = stats.normalize_year(year, years)
    return {
        "years": years,
        "year": chosen,
        "days": stats.daily_counts(db, chosen, project_id=project_id),
    }


@router.get("/projects/{project_id}/leaderboard")
def project_leaderboard(
    project_id: int,
    days: int = 30,
    limit: int = 10,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """项目内贡献榜：7/30/365 天内为该项目上传版本最多的成员。"""
    ensure_project_access(db, project_id, user)
    window = days if days in (7, 30, 365) else 30
    return {
        "days": window,
        "items": stats.uploader_ranking(
            db, days=window, project_id=project_id, limit=limit
        ),
    }


@router.get("/projects/{project_id}")
def get_project(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = ensure_project_access(db, project_id, user)
    return project_to_dict(project, include_categories=True, include_members=True)


@router.patch("/projects/{project_id}")
def update_project(
    project_id: int,
    payload: ProjectUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = ensure_project_editor(db, project_id, user)

    for field in ("name", "description", "github_repo_url", "visibility"):
        value = getattr(payload, field)
        if value is not None:
            setattr(project, field, value)

    if payload.is_archived is not None:
        project.is_archived = payload.is_archived

    # slug 不随改名变化，避免已分享的链接失效
    db.commit()
    db.refresh(project)
    return project_to_dict(project, include_categories=True, include_members=True)


@router.delete("/projects/{project_id}")
def delete_project(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = ensure_project_editor(db, project_id, user)
    db.delete(project)
    db.commit()
    return {"ok": True}
