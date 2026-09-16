from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from ..core.security import create_access_token, hash_password, verify_password
from ..database import get_db
from ..models import User
from ..schemas import ChangePasswordRequest, LoginRequest, Token
from ..serializers import user_out
from ..services import badges, storage, storage_config
from .deps import get_current_user

router = APIRouter()


@router.post("/login", response_model=Token)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == payload.username).first()
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    if user.deleted_at is not None:
        raise HTTPException(status_code=403, detail="该账号已被删除")
    if user.status != "active":
        raise HTTPException(status_code=403, detail="账号已被禁用")
    token = create_access_token(user.id, user.role)
    # 登录是成就的「补录」入口：把按历史数据已满足、但还没提醒过的成就一次发出来
    badges.sync(db, user.id)
    db.commit()
    return {"access_token": token, "token_type": "bearer"}


@router.get("/me")
def me(user: User = Depends(get_current_user)):
    return user_out(user)


@router.patch("/profile")
def update_profile(
    nickname: Optional[str] = Form(None),
    github_url: Optional[str] = Form(None),
    avatar: Optional[UploadFile] = File(None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if nickname is not None:
        user.nickname = nickname
    if github_url is not None:
        user.github_url = github_url or None
    if avatar is not None and avatar.filename:
        cos = storage_config.cos_params(db)
        raw, name = storage.read_upload(avatar)
        try:
            storage.ensure_image_size(raw)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        saved = storage.save_avatar(user.id, raw, name, cos)
        if saved["path"]:
            # 换头像时清掉旧的，避免堆积
            storage.delete_file(user.avatar, user.avatar_storage or "local", cos)
            user.avatar = saved["path"]
            user.avatar_storage = saved["storage"]
    # 填昵称 / 头像 / GitHub 可能凑齐「门面齐整」
    new_badges = badges.sync(db, user.id)
    db.commit()
    db.refresh(user)
    data = user_out(user)
    data["new_badges"] = new_badges
    return data


@router.post("/change-password")
def change_password(
    payload: ChangePasswordRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not verify_password(payload.old_password, user.password_hash):
        raise HTTPException(status_code=400, detail="原密码错误")
    user.password_hash = hash_password(payload.new_password)
    db.commit()
    return {"ok": True}
