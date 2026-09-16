from datetime import datetime
from typing import Optional

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


# ---------- 对象存储配置 ----------
class StorageConfigIn(BaseModel):
    provider: Optional[str] = None  # local / cos
    cos_secret_id: Optional[str] = None
    # 提交掩码或空串表示不修改已保存的密钥
    cos_secret_key: Optional[str] = None
    cos_region: Optional[str] = None
    cos_bucket: Optional[str] = None
    cos_app_id: Optional[str] = None
    cos_prefix: Optional[str] = None


# ---------- 资产移动（文件夹） ----------
class AssetMoveRequest(BaseModel):
    folder_id: int = 0  # 0 表示根目录


# ---------- 资产类型（分类） ----------
class CategoryCreate(BaseModel):
    name: str = Field(min_length=1)
    sort_order: int = 0


class CategoryUpdate(BaseModel):
    name: Optional[str] = None
    sort_order: Optional[int] = None


# ---------- 文件夹 ----------
class FolderCreate(BaseModel):
    name: str = Field(min_length=1)
    sort_order: int = 0
    parent_id: Optional[int] = None


class FolderUpdate(BaseModel):
    name: Optional[str] = None
    sort_order: Optional[int] = None
    parent_id: Optional[int] = None  # 0 = 根目录；None = 不修改


# ---------- 评论 ----------
class CommentCreate(BaseModel):
    content: str = Field(min_length=1)
    parent_id: Optional[int] = None


class VersionChangelogUpdate(BaseModel):
    changelog: Optional[str] = None
