from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field


# ---------- 通用 ----------
class UserBrief(BaseModel):
    id: int
    username: str
    nickname: Optional[str] = None
    avatar: Optional[str] = None
    github_url: Optional[str] = None


class UserOut(UserBrief):
    role: str
    status: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ---------- 认证 ----------
class LoginRequest(BaseModel):
    username: str
    password: str


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str = Field(min_length=6)


# ---------- 管理员 ----------
class UserCreate(BaseModel):
    username: str = Field(min_length=3)
    password: str = Field(min_length=6)
    nickname: Optional[str] = None
    role: str = "member"  # member / admin


class UserStatusRequest(BaseModel):
    status: str  # active / disabled


class UserUpdate(BaseModel):
    nickname: Optional[str] = None
    role: Optional[str] = None  # member / admin


# ---------- 项目 ----------
class ProjectCreate(BaseModel):
    name: str = Field(min_length=1)
    description: Optional[str] = None
    github_repo_url: Optional[str] = None
    visibility: str = "public"  # public / private
    category_mode: str = "default"  # default=用系统默认分类 / custom=自定义
    custom_categories: Optional[List[str]] = None


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    github_repo_url: Optional[str] = None
    visibility: Optional[str] = None
    is_archived: Optional[bool] = None


# ---------- 订阅 ----------
class SubscribeRequest(BaseModel):
    target_type: str  # project / asset
    target_id: int


# ---------- 资产关联 ----------
class RelationCreate(BaseModel):
    to_asset_id: int
    relation_type: str = "related"  # related / uses / used_by


# ---------- 分类 ----------
class CategoryCreate(BaseModel):
    name: str = Field(min_length=1)
    sort_order: int = 0


class CategoryUpdate(BaseModel):
    name: Optional[str] = None
    sort_order: Optional[int] = None


# ---------- 评论 ----------
class CommentCreate(BaseModel):
    content: str = Field(min_length=1)
    parent_id: Optional[int] = None
    version_id: Optional[int] = None
