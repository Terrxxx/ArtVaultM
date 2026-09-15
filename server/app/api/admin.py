import re
from datetime import datetime

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

# 个人主页是 /{用户名}，这些是同级的前端静态路由，占用后该用户将无法访问
RESERVED_USERNAMES = {"login", "settings", "notifications", "console"}
USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9_-]{3,32}$")


def _validate_username(username: str) -> None:
    if not USERNAME_PATTERN.match(username):
        raise HTTPException(
            status_code=400,
            detail="用户名只能包含字母、数字、下划线和短横线，长度 3-32 位",
        )
    if username.lower() in RESERVED_USERNAMES:
        raise HTTPException(
            status_code=400, detail=f"“{username}” 是系统保留名，请换一个"
        )


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

    _validate_username(payload.username)

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


@router.delete("/users/{user_id}")
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    """删除用户——只打软删除标记，不在数据库真删。

    资产、评论等仍引用该用户，真删会破坏历史数据；
    标记后该账号无法登录、不出现在搜索与成员候选中，个人主页也视为不存在。
    """
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    if user.id == admin.id:
        raise HTTPException(status_code=400, detail="不能删除自己")
    if not can_manage_target(admin, user):
        raise HTTPException(status_code=403, detail="无权删除该用户（管理员只能管理普通成员）")
    if user.deleted_at is not None:
        raise HTTPException(status_code=400, detail="该用户已被删除")

    user.deleted_at = datetime.utcnow()
    user.status = "disabled"
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
