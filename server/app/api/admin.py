from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..core.security import hash_password
from ..database import get_db
from ..models import Project, User
from ..schemas import StorageConfigIn, UserCreate, UserStatusRequest, UserUpdate
from ..serializers import project_to_dict, user_out
from ..services import storage_config
from .deps import (
    ADMIN,
    MEMBER,
    SUPER_ADMIN,
    can_manage_target,
    get_current_admin,
    get_current_super_admin,
    is_super_admin,
)

router = APIRouter()

VALID_ROLES = (MEMBER, ADMIN, SUPER_ADMIN)


@router.post("/users")
def create_user(
    payload: UserCreate,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    role = payload.role or MEMBER
    if role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail="角色不合法")
    # 只有高级管理员能创建管理员
    if role != MEMBER and not is_super_admin(admin):
        raise HTTPException(status_code=403, detail="只有高级管理员可以创建管理员账号")

    if db.query(User).filter(User.username == payload.username).first():
        raise HTTPException(status_code=400, detail="用户名已存在")

    user = User(
        username=payload.username,
        password_hash=hash_password(payload.password),
        nickname=payload.nickname,
        role=role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user_out(user)


@router.get("/users")
def list_users(
    db: Session = Depends(get_db), admin: User = Depends(get_current_admin)
):
    return [user_out(u) for u in db.query(User).order_by(User.id).all()]


@router.patch("/users/{user_id}")
def update_user(
    user_id: int,
    payload: UserUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    if not can_manage_target(admin, user):
        raise HTTPException(status_code=403, detail="无权修改该用户（管理员只能管理普通成员）")

    if payload.nickname is not None:
        user.nickname = payload.nickname

    if payload.role is not None:
        if payload.role not in VALID_ROLES:
            raise HTTPException(status_code=400, detail="角色不合法")
        if not is_super_admin(admin):
            raise HTTPException(status_code=403, detail="只有高级管理员可以调整角色")
        if user.id == admin.id and payload.role != SUPER_ADMIN:
            raise HTTPException(status_code=400, detail="不能降级自己的高级管理员身份")
        user.role = payload.role

    db.commit()
    db.refresh(user)
    return user_out(user)


@router.patch("/users/{user_id}/status")
def set_user_status(
    user_id: int,
    payload: UserStatusRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    if user.id == admin.id:
        raise HTTPException(status_code=400, detail="不能禁用自己")
    if not can_manage_target(admin, user):
        raise HTTPException(status_code=403, detail="无权修改该用户（管理员只能管理普通成员）")
    user.status = payload.status
    db.commit()
    db.refresh(user)
    return user_out(user)


@router.get("/projects")
def list_all_projects(
    archived: bool = False,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    """管理后台视角：全部项目（含他人私有项目）。

    管理员只能查看；高级管理员可编辑（can_edit=true）。
    """
    projects = (
        db.query(Project)
        .filter(Project.is_archived.is_(bool(archived)))
        .order_by(Project.created_at.desc())
        .all()
    )
    editable = is_super_admin(admin)
    return [
        {**project_to_dict(p), "can_edit": editable or p.owner_id == admin.id}
        for p in projects
    ]


# ---------- 腾讯 COS 配置（仅高级管理员） ----------


@router.get("/storage-config")
def get_storage_config(
    db: Session = Depends(get_db), admin: User = Depends(get_current_super_admin)
):
    return storage_config.read_config(db)


@router.put("/storage-config")
def update_storage_config(
    payload: StorageConfigIn,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_super_admin),
):
    return storage_config.write_config(db, payload)


@router.post("/storage-config/test")
def test_storage_config(
    db: Session = Depends(get_db), admin: User = Depends(get_current_super_admin)
):
    return storage_config.test_connection(db)
