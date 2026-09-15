import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from .api import (
    admin,
    assets,
    auth,
    categories,
    comments,
    likes,
    members,
    notifications,
    projects,
    relations,
    subscriptions,
    users,
    versions,
)
from .config import settings
from .core.security import hash_password
from .database import Base, SessionLocal, engine
from .models import Project, User
from .services import storage_config
from .services.slug import slugify

# 已存在的表需要补的新列（无 Alembic，用幂等 ALTER 兜底）
WANTED_COLUMNS = {
    "users": {
        "github_url": "VARCHAR",
        "avatar_storage": "VARCHAR DEFAULT 'local'",
        "deleted_at": "DATETIME",
    },
    "projects": {
        "is_archived": "BOOLEAN DEFAULT 0",
        "slug": "VARCHAR",
    },
    "project_members": {
        "status": "VARCHAR DEFAULT 'pending'",
    },
    "assets": {
        "cover_thumbnail_storage": "VARCHAR DEFAULT 'local'",
        "small_thumbnail": "VARCHAR",
        "small_thumbnail_storage": "VARCHAR DEFAULT 'local'",
    },
    "asset_versions": {
        "file_hash": "VARCHAR",
        "thumbnail": "VARCHAR",
        "thumbnail_storage": "VARCHAR DEFAULT 'local'",
        "thumb_small": "VARCHAR",
        "thumb_small_storage": "VARCHAR DEFAULT 'local'",
        "storage": "VARCHAR DEFAULT 'local'",
    },
    "comments": {
        "version_id": "INTEGER REFERENCES asset_versions(id)",
    },
}


def ensure_columns() -> None:
    """为已有表补上新增列；新表由 create_all 负责。"""
    inspector = inspect(engine)
    for table, columns in WANTED_COLUMNS.items():
        if not inspector.has_table(table):
            continue
        existing = {c["name"] for c in inspector.get_columns(table)}
        missing = {name: ddl for name, ddl in columns.items() if name not in existing}
        if not missing:
            continue
        with engine.begin() as conn:
            for name, ddl in missing.items():
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))


def backfill_slugs() -> None:
    """给历史项目补 slug，并把历史成员记录视为已接受。"""
    db: Session = SessionLocal()
    try:
        changed = False
        for project in db.query(Project).filter(Project.slug.is_(None)).all():
            base = slugify(project.name)
            slug = base
            n = 2
            while (
                db.query(Project)
                .filter(
                    Project.owner_id == project.owner_id,
                    Project.slug == slug,
                    Project.id != project.id,
                )
                .first()
                is not None
            ):
                slug = f"{base}-{n}"
                n += 1
            project.slug = slug
            changed = True
        if changed:
            db.commit()

        # 早期成员记录没有 status 字段，默认视为已接受
        with engine.begin() as conn:
            conn.execute(
                text(
                    "UPDATE project_members SET status = 'accepted' "
                    "WHERE status IS NULL"
                )
            )
    finally:
        db.close()


def seed_admin() -> None:
    """默认 admin 账号即为高级管理员。"""
    db: Session = SessionLocal()
    try:
        admin = db.query(User).filter(User.username == "admin").first()
        if admin is None:
            if db.query(User).filter(User.role == "super_admin").first() is None:
                db.add(
                    User(
                        username="admin",
                        password_hash=hash_password("admin123"),
                        nickname="管理员",
                        role="super_admin",
                    )
                )
                db.commit()
        elif admin.role == "admin":
            # 早期版本的 admin 是普通管理员，迁移为高级管理员
            admin.role = "super_admin"
            db.commit()
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs(settings.upload_dir, exist_ok=True)
    Base.metadata.create_all(bind=engine)
    ensure_columns()
    backfill_slugs()
    seed_admin()
    # 把对象存储配置载入进程内缓存，供序列化器生成图片 URL
    with SessionLocal() as db:
        storage_config.refresh_cache(db)
    yield


app = FastAPI(title="ArtVault API", version="0.3.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 静态文件：缩略图/预览图，路径形如 /uploads/thumbnails/xxx.png
os.makedirs(settings.upload_dir, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=settings.upload_dir), name="uploads")

app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(admin.router, prefix="/api/admin", tags=["admin"])
app.include_router(users.router, prefix="/api", tags=["users"])
app.include_router(projects.router, prefix="/api", tags=["projects"])
app.include_router(members.router, prefix="/api", tags=["members"])
app.include_router(categories.router, prefix="/api", tags=["categories"])
app.include_router(assets.router, prefix="/api", tags=["assets"])
app.include_router(versions.router, prefix="/api", tags=["versions"])
app.include_router(comments.router, prefix="/api", tags=["comments"])
app.include_router(likes.router, prefix="/api", tags=["likes"])
app.include_router(relations.router, prefix="/api", tags=["relations"])
app.include_router(subscriptions.router, prefix="/api", tags=["subscriptions"])
app.include_router(notifications.router, prefix="/api", tags=["notifications"])


@app.get("/")
def root():
    return {"app": settings.app_name, "status": "ok"}


@app.get("/api/health")
def health():
    return {"status": "ok"}
