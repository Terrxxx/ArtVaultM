from typing import List, Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from ..core.security import decode_token
from ..database import get_db
from ..models import Asset, Project, ProjectMember, User

bearer_scheme = HTTPBearer(auto_error=False)

MEMBER = "member"
ADMIN = "admin"
SUPER_ADMIN = "super_admin"


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="未登录")
    try:
        payload = decode_token(credentials.credentials)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="登录已失效，请重新登录"
        )
    user = db.get(User, int(payload.get("sub")))
    if user is None or user.status != "active":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="用户不存在或已被禁用"
        )
    return user


def is_super_admin(user: User) -> bool:
    return user.role == SUPER_ADMIN


def is_admin_like(user: User) -> bool:
    """管理员或高级管理员（可进入管理后台）。"""
    return user.role in (ADMIN, SUPER_ADMIN)


def get_current_admin(user: User = Depends(get_current_user)) -> User:
    """管理后台入口：管理员 / 高级管理员。"""
    if not is_admin_like(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="需要管理员权限"
        )
    return user


def get_current_super_admin(user: User = Depends(get_current_user)) -> User:
    if not is_super_admin(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="需要高级管理员权限"
        )
    return user


def can_manage_target(actor: User, target: User) -> bool:
    """管理员只能管理普通成员；高级管理员可管理所有人。"""
    if is_super_admin(actor):
        return True
    if actor.role == ADMIN:
        return target.role == MEMBER
    return False


def can_edit_project(project: Project, user: User) -> bool:
    """仅项目创建者可编辑；高级管理员例外（通过管理后台入口）。"""
    return is_super_admin(user) or project.owner_id == user.id


def can_edit_asset(asset: Asset, user: User) -> bool:
    """仅资产创建者可编辑；高级管理员例外（通过管理后台入口）。"""
    return is_super_admin(user) or asset.created_by == user.id


def is_project_member(db: Session, project_id: int, user_id: int) -> bool:
    """是否为项目的正式成员（受邀但未同意的 pending 不算）。"""
    return (
        db.query(ProjectMember)
        .filter(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == user_id,
            ProjectMember.status == "accepted",
        )
        .first()
        is not None
    )


def ensure_project_access(
    db: Session, project_id: int, user: User, write: bool = False
) -> Project:
    """校验项目可见性与写入权限，返回项目。

    - 查看：公开项目所有登录用户可见；私有项目仅所有者/成员/管理员可见
      （管理员可见是为了在管理后台审阅，但不等于可编辑）
    - 写入（上传资产等）：所有者/正式成员/高级管理员
    - 编辑项目本身（改名/分类/成员/归档删除）：见 ensure_project_editor
    """
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="项目不存在")

    is_owner = project.owner_id == user.id
    is_member = is_owner or is_project_member(db, project.id, user.id)
    can_review = is_admin_like(user)
    can_write = is_member or is_super_admin(user)

    if project.visibility == "private" and not (is_member or can_review):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="无权限访问该项目"
        )

    if write and not can_write:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="仅项目所有者、成员或高级管理员可操作"
        )

    return project


def ensure_project_editor(db: Session, project_id: int, user: User) -> Project:
    """项目编辑（改名/可见性/分类/成员/归档/删除）：仅创建者或高级管理员。"""
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="项目不存在")
    if not can_edit_project(project, user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="仅项目创建者或高级管理员可编辑该项目",
        )
    return project


def visible_project_ids(db: Session, user: User) -> Optional[List[int]]:
    """「我的项目」可见的项目 id 列表。

    任何人（含高级管理员）都只看自己拥有或受邀加入的项目；
    全部项目（含他人私有项目）只在管理后台的专门接口里提供。
    """
    owned = [p.id for p in db.query(Project).filter(Project.owner_id == user.id).all()]
    joined = [
        m.project_id
        for m in db.query(ProjectMember)
        .filter(
            ProjectMember.user_id == user.id,
            ProjectMember.status == "accepted",
        )
        .all()
    ]
    return list(set(owned) | set(joined))


def viewable_project_ids(db: Session, user: User) -> Optional[List[int]]:
    """按「能否查看该项目」返回 id 列表；None 表示全部可见。

    与 ensure_project_access 的查看规则保持一致：管理员与高级管理员可以查看
    全部项目（进入后台审阅所需），其余人只有自己拥有的或受邀加入的。
    用于个人主页这类「按查看权限过滤内容」的场景，不等同于「我的项目」。
    """
    if is_admin_like(user):
        return None
    return visible_project_ids(db, user)
