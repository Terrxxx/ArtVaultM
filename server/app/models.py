from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
)
from sqlalchemy.orm import relationship

from .database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    nickname = Column(String, nullable=True)
    avatar = Column(String, nullable=True)
    avatar_storage = Column(String, default="local")  # local / cos
    github_url = Column(String, nullable=True)
    role = Column(String, default="member")  # admin / member
    status = Column(String, default="active")  # active / disabled
    # 软删除：只打时间标记，不真的删库（资产/评论等仍引用该用户）
    deleted_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class Project(Base):
    __tablename__ = "projects"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    slug = Column(String, index=True, nullable=True)  # URL 片段，由名称生成
    description = Column(String, nullable=True)
    github_repo_url = Column(String, nullable=True)
    cover_url = Column(String, nullable=True)
    visibility = Column(String, default="public")  # public / private
    is_archived = Column(Boolean, default=False)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    owner = relationship("User")
    categories = relationship(
        "Category",
        back_populates="project",
        cascade="all, delete-orphan",
        order_by="Category.sort_order",
    )
    assets = relationship(
        "Asset", back_populates="project", cascade="all, delete-orphan"
    )
    members = relationship(
        "ProjectMember", back_populates="project", cascade="all, delete-orphan"
    )


class ProjectMember(Base):
    """项目成员。邀请后需被邀请人同意（status=accepted）才算正式成员。"""

    __tablename__ = "project_members"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    status = Column(String, default="pending")  # pending / accepted
    created_at = Column(DateTime, default=datetime.utcnow)

    project = relationship("Project", back_populates="members")
    user = relationship("User")


class Category(Base):
    __tablename__ = "categories"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    name = Column(String, nullable=False)
    sort_order = Column(Integer, default=0)
    is_system = Column(Boolean, default=False)

    project = relationship("Project", back_populates="categories")
    assets = relationship("Asset", back_populates="category")


class Asset(Base):
    __tablename__ = "assets"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    category_id = Column(Integer, ForeignKey("categories.id"), nullable=False)
    name = Column(String, nullable=False)
    description = Column(String, nullable=True)
    tags = Column(JSON, default=list)
    cover_thumbnail = Column(String, nullable=True)
    cover_thumbnail_storage = Column(String, default="local")  # local / cos
    # 资产级 42x42 小图（webp），由封面自动派生，用于版本列表等紧凑场景
    small_thumbnail = Column(String, nullable=True)
    small_thumbnail_storage = Column(String, default="local")
    status = Column(String, default="published")
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    project = relationship("Project", back_populates="assets")
    category = relationship("Category", back_populates="assets")
    creator = relationship("User")
    versions = relationship(
        "AssetVersion",
        back_populates="asset",
        cascade="all, delete-orphan",
        order_by="AssetVersion.version.desc()",
    )
    comments = relationship(
        "Comment", back_populates="asset", cascade="all, delete-orphan"
    )
    likes = relationship("Like", cascade="all, delete-orphan")


class AssetVersion(Base):
    __tablename__ = "asset_versions"

    id = Column(Integer, primary_key=True, index=True)
    asset_id = Column(Integer, ForeignKey("assets.id"), nullable=False)
    version = Column(Integer, nullable=False)
    file_path = Column(String, nullable=False)
    file_name = Column(String, nullable=False)
    file_size = Column(Integer, default=0)
    file_format = Column(String, nullable=True)
    file_hash = Column(String, nullable=True, index=True)
    thumbnail = Column(String, nullable=True)
    thumbnail_storage = Column(String, default="local")  # local / cos
    # 版本列表用的 56x56 小图（单独存，避免列表页加载大图）
    thumb_small = Column(String, nullable=True)
    thumb_small_storage = Column(String, default="local")
    storage = Column(String, default="local")  # local=本地磁盘 / cos=腾讯云COS
    changelog = Column(String, nullable=True)
    uploader_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    is_latest = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    asset = relationship("Asset", back_populates="versions")
    uploader = relationship("User")
    downloads = relationship(
        "DownloadLog", back_populates="asset_version", cascade="all, delete-orphan"
    )


class Comment(Base):
    __tablename__ = "comments"

    id = Column(Integer, primary_key=True, index=True)
    asset_id = Column(Integer, ForeignKey("assets.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    parent_id = Column(Integer, ForeignKey("comments.id"), nullable=True)
    version_id = Column(Integer, ForeignKey("asset_versions.id"), nullable=True)
    content = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    asset = relationship("Asset", back_populates="comments")
    user = relationship("User")
    version = relationship("AssetVersion")


class Favorite(Base):
    __tablename__ = "favorites"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    asset_id = Column(Integer, ForeignKey("assets.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class Like(Base):
    __tablename__ = "likes"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    asset_id = Column(Integer, ForeignKey("assets.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class DownloadLog(Base):
    __tablename__ = "download_logs"

    id = Column(Integer, primary_key=True, index=True)
    asset_version_id = Column(Integer, ForeignKey("asset_versions.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    asset_version = relationship("AssetVersion", back_populates="downloads")
    user = relationship("User")


class AssetRelation(Base):
    """资产之间的关联，如模型关联到动画。"""

    __tablename__ = "asset_relations"

    id = Column(Integer, primary_key=True, index=True)
    from_asset_id = Column(Integer, ForeignKey("assets.id"), nullable=False)
    to_asset_id = Column(Integer, ForeignKey("assets.id"), nullable=False)
    relation_type = Column(String, default="related")  # related / uses / used_by
    created_at = Column(DateTime, default=datetime.utcnow)

    from_asset = relationship("Asset", foreign_keys=[from_asset_id])
    to_asset = relationship("Asset", foreign_keys=[to_asset_id])


class Subscription(Base):
    """订阅：关注项目或某个资产的更新。"""

    __tablename__ = "subscriptions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    target_type = Column(String, nullable=False)  # project / asset
    target_id = Column(Integer, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User")


class Notification(Base):
    """站内消息：评论、@提及、邀请、订阅更新。"""

    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)  # 接收者
    type = Column(String, nullable=False)  # comment / mention / invite / update
    actor_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=True)
    asset_id = Column(Integer, ForeignKey("assets.id"), nullable=True)
    comment_id = Column(Integer, ForeignKey("comments.id"), nullable=True)
    content = Column(String, nullable=True)
    is_read = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    actor = relationship("User", foreign_keys=[actor_id])


class StorageConfig(Base):
    """对象存储配置（全局单行）。由高级管理员在管理后台维护。"""

    __tablename__ = "storage_config"

    id = Column(Integer, primary_key=True)
    provider = Column(String, default="local")  # local / cos
    cos_secret_id = Column(String, nullable=True)
    cos_secret_key = Column(String, nullable=True)
    cos_region = Column(String, nullable=True)
    cos_bucket = Column(String, nullable=True)
    cos_app_id = Column(String, nullable=True)
    cos_prefix = Column(String, default="artvaultm")
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
