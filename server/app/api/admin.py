from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..core.security import hash_password
from ..database import get_db
from ..models import Project, User
from ..schemas import UserCreate, UserOut, UserStatusRequest, UserUpdate
from ..serializers import project_to_dict
from .deps import get_current_admin

router = APIRouter()


@router.post("/users", response_model=UserOut)
def create_user(
    payload: UserCreate,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    if db.query(User).filter(User.username == payload.username).first():
        raise HTTPException(status_code=400, detail="用户名已存在")
    user = User(
        username=payload.username,
        password_hash=hash_password(payload.password),
        nickname=payload.nickname,
        role=payload.role or "member",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.get("/users", response_model=List[UserOut])
def list_users(
    db: Session = Depends(get_db), admin: User = Depends(get_current_admin)
):
    return db.query(User).order_by(User.id).all()


@router.patch("/users/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    payload: UserUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="用户不存在")

    if payload.nickname is not None:
        user.nickname = payload.nickname

    if payload.role is not None:
        if payload.role not in ("member", "admin"):
            raise HTTPException(status_code=400, detail="角色只能是 member 或 admin")
        if user.id == admin.id and payload.role != "admin":
            raise HTTPException(status_code=400, detail="不能取消自己的管理员权限")
        user.role = payload.role

    db.commit()
    db.refresh(user)
    return user


@router.get("/projects")
def list_all_projects(
    archived: bool = False,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    """管理员视角：全部项目（含私有、含他人项目）。"""
    projects = (
        db.query(Project)
        .filter(Project.is_archived.is_(bool(archived)))
        .order_by(Project.created_at.desc())
        .all()
    )
    return [project_to_dict(p) for p in projects]


@router.patch("/users/{user_id}/status", response_model=UserOut)
def set_user_status(
    user_id: int,
    payload: UserStatusRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    if user.id == admin.id and payload.status == "disabled":
        raise HTTPException(status_code=400, detail="不能禁用自己")
    user.status = payload.status
    db.commit()
    db.refresh(user)
    return user
