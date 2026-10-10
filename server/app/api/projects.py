from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import AuditLog, Project, ProjectMember, User
from ..schemas import ProjectCreate, ProjectUpdate
from ..serializers import project_to_dict, user_brief
from ..services import audit, badges, clock, stats
from ..services.asset_types import seed_default_categories
from ..services.permissions import can_edit_project
from ..services.slug import slugify
from .deps import (
    ensure_project_access,
    ensure_project_editor,
    get_current_user,
    visible_project_ids,
)

router = APIRouter()


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

    # 默认资产类型；文件夹不预建，由用户在项目页按需创建
    seed_default_categories(db, project.id)

    new_badges = badges.sync(db, user.id)
    audit.record(db, project.id, user, audit.PROJECT_CREATE, "创建项目")

    db.commit()
    db.refresh(project)
    data = project_to_dict(
        project, include_categories=True, include_folders=True, viewer=user
    )
    data["new_badges"] = new_badges
    return data


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
    return [project_to_dict(p, viewer=user) for p in projects]


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
    data = project_to_dict(
        project,
        include_categories=True,
        include_members=True,
        include_folders=True,
        viewer=user,
    )
    # 占用量只在单个项目里算（项目列表逐个项目聚合会变成 N+1）
    data["storage_bytes"] = stats.project_storage_bytes(db, project.id)
    return data


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
        {**project_to_dict(p, viewer=user), "heat": scores.get(p.id, 0.0)}
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
        # 同个人页：热力图最后一列按服务器日期对齐
        "today": clock.today().isoformat(),
    }


@router.get("/projects/{project_id}/updates")
def project_updates(
    project_id: int,
    date_str: Optional[str] = Query(None, alias="date"),
    limit: int = 20,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """项目更新日志：给了 date 就返回当天全部更新，否则返回最近若干条。

    热力图点某天就传哪天，和个人主页的同名接口走同一套 stats.update_log。
    """
    ensure_project_access(db, project_id, user)
    on_date = stats.parse_date(date_str)
    return {
        "date": date_str if on_date else None,
        "items": stats.update_log(db, limit=limit, on_date=on_date, project_id=project_id),
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
    data = project_to_dict(
        project,
        include_categories=True,
        include_members=True,
        include_folders=True,
        viewer=user,
    )
    data["storage_bytes"] = stats.project_storage_bytes(db, project.id)
    return data


@router.get("/projects/{project_id}/logs")
def project_logs(
    project_id: int,
    offset: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """项目操作日志：只有项目所有者与高级管理员能看。"""
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="项目不存在")
    if not can_edit_project(project, user):
        raise HTTPException(status_code=403, detail="只有项目所有者或高级管理员可以查看操作日志")

    page = max(1, min(limit, 200))
    query = db.query(AuditLog).filter(AuditLog.project_id == project_id)
    total = query.count()
    rows = (
        query.order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .offset(max(0, offset))
        .limit(page)
        .all()
    )
    # 用户名/头像一次查好，别逐条查
    author_ids = {r.user_id for r in rows}
    authors = (
        {u.id: u for u in db.query(User).filter(User.id.in_(author_ids)).all()}
        if author_ids
        else {}
    )
    return {
        "total": total,
        "items": [
            {
                "id": r.id,
                "action": r.action,
                "detail": r.detail,
                "created_at": clock.fmt_dt(r.created_at),
                "user": user_brief(authors.get(r.user_id)),
            }
            for r in rows
        ],
    }


@router.delete("/projects/{project_id}/logs")
def clear_project_logs(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """清空项目操作日志：跟查看同权限，仅项目所有者与高级管理员。"""
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="项目不存在")
    if not can_edit_project(project, user):
        raise HTTPException(status_code=403, detail="只有项目所有者或高级管理员可以清除操作日志")

    # 不记日志：刚清完又冒出来一条会很怪
    removed = (
        db.query(AuditLog)
        .filter(AuditLog.project_id == project_id)
        .delete(synchronize_session=False)
    )
    db.commit()
    return {"ok": True, "removed": removed}


@router.patch("/projects/{project_id}")
def update_project(
    project_id: int,
    payload: ProjectUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = ensure_project_editor(db, project_id, user)
    old_name, old_archived = project.name, project.is_archived

    for field in ("name", "description", "github_repo_url", "visibility"):
        value = getattr(payload, field)
        if value is not None:
            setattr(project, field, value)

    if payload.is_archived is not None:
        project.is_archived = payload.is_archived

    # slug 不随改名变化，避免已分享的链接失效
    changed = []
    if project.name != old_name:
        changed.append(f"改名为「{project.name}」")
    if bool(project.is_archived) != bool(old_archived):
        changed.append("归档" if project.is_archived else "取消归档")
    audit.record(
        db,
        project_id,
        user,
        audit.PROJECT_UPDATE,
        "更新项目" + ("：" + "、".join(changed) if changed else ""),
    )
    db.commit()
    db.refresh(project)
    return project_to_dict(
        project,
        include_categories=True,
        include_members=True,
        include_folders=True,
        viewer=user,
    )


@router.delete("/projects/{project_id}")
def delete_project(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = ensure_project_editor(db, project_id, user)
    db.delete(project)
    # 项目没了，这条日志留着（project_id 不是外键，不会跟着级联删除）
    audit.record(db, project_id, user, audit.PROJECT_DELETE, "删除项目")
    db.commit()
    return {"ok": True}
