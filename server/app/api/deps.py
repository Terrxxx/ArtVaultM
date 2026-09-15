from typing import List, Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from ..core.security import decode_token
from ..database import get_db
from ..models import Project, ProjectMember, User

bearer_scheme = HTTPBearer(auto_error=False)


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


def get_current_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="需要管理员权限"
        )
    return user


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


def project_role(db: Session, project: Project, user: User) -> str:
    """返回用户在项目中的角色：admin / owner / member / guest。"""
    if user.role == "admin":
        return "admin"
    if project.owner_id == user.id:
        return "owner"
    if is_project_member(db, project.id, user.id):
        return "member"
    return "guest"


def ensure_project_access(
    db: Session, project_id: int, user: User, write: bool = False
) -> Project:
    """校验项目可见性与写入权限，返回项目。

    - 查看：公开项目所有登录用户可见；私有项目仅所有者/管理员/成员可见
    - 写入（上传资产、改资产）：所有者/管理员/成员
    - 项目设置与删除：仅所有者/管理员（用 ensure_project_owner）
    """
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="项目不存在")

    role = project_role(db, project, user)
    privileged = role in ("admin", "owner", "member")

    if project.visibility == "private" and not privileged:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="无权限访问该项目"
        )

    if write and not privileged:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="仅项目所有者、管理员或成员可操作"
        )

    return project


def ensure_project_owner(db: Session, project_id: int, user: User) -> Project:
    """项目设置级操作：仅所有者或站点管理员。"""
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="项目不存在")
    if user.role != "admin" and project.owner_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="仅项目所有者或管理员可操作"
        )
    return project


def visible_project_ids(db: Session, user: User) -> Optional[List[int]]:
    """当前用户可见的项目 id 列表；None 表示全部可见（管理员）。"""
    if user.role == "admin":
        return None
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
