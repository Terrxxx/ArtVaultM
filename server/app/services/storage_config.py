"""对象存储配置：读取/写入/连通性测试。

密钥不会以明文回传给前端；前端提交掩码或空值时表示「不修改」。
"""

from typing import Optional

from sqlalchemy.orm import Session

from ..models import StorageConfig

MASK = "********"
CONFIG_ID = 1
REQUIRED_COS_FIELDS = ("cos_secret_id", "cos_secret_key", "cos_region", "cos_bucket")


def get_config(db: Session) -> StorageConfig:
    cfg = db.get(StorageConfig, CONFIG_ID)
    if cfg is None:
        cfg = StorageConfig(id=CONFIG_ID, provider="local", cos_prefix="artvaultm")
        db.add(cfg)
        db.commit()
        db.refresh(cfg)
    return cfg


def read_config(db: Session) -> dict:
    c = get_config(db)
    return {
        "provider": c.provider,
        "cos_secret_id": c.cos_secret_id,
        "cos_secret_key_set": bool(c.cos_secret_key),
        "cos_region": c.cos_region,
        "cos_bucket": c.cos_bucket,
        "cos_app_id": c.cos_app_id,
        "cos_prefix": c.cos_prefix,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
    }


def write_config(db: Session, payload) -> dict:
    c = get_config(db)

    if payload.provider is not None:
        if payload.provider not in ("local", "cos"):
            raise ValueError("provider 只能是 local 或 cos")
        c.provider = payload.provider

    if payload.cos_secret_id is not None:
        c.cos_secret_id = payload.cos_secret_id or None
    # 掩码或空值 = 保持原密钥不变
    if payload.cos_secret_key not in (None, "", MASK):
        c.cos_secret_key = payload.cos_secret_key
    if payload.cos_region is not None:
        c.cos_region = payload.cos_region or None
    if payload.cos_bucket is not None:
        c.cos_bucket = payload.cos_bucket or None
    if payload.cos_app_id is not None:
        c.cos_app_id = payload.cos_app_id or None
    if payload.cos_prefix is not None:
        c.cos_prefix = (payload.cos_prefix or "artvaultm").strip("/") or "artvaultm"

    db.commit()
    db.refresh(c)
    refresh_cache(db)
    return read_config(db)


# ---------- 进程内缓存 ----------
# 序列化器需要在没有 db 会话的情况下把存储路径转成可访问 URL（例如头像/缩略图），
# 因此把 COS 参数缓存一份。配置写入和启动时会刷新。

_cached_params: Optional[dict] = None


def refresh_cache(db: Session) -> None:
    global _cached_params
    _cached_params = cos_params(db)


def cached_params() -> Optional[dict]:
    return _cached_params


def cos_params(db: Session) -> Optional[dict]:
    """COS 配置齐全时返回连接参数，否则 None（表示走本地磁盘）。"""
    c = get_config(db)
    if c.provider != "cos":
        return None
    if not all(getattr(c, f) for f in REQUIRED_COS_FIELDS):
        return None
    return {
        "secret_id": c.cos_secret_id,
        "secret_key": c.cos_secret_key,
        "region": c.cos_region,
        "bucket": c.cos_bucket,
        "app_id": c.cos_app_id,
        "prefix": c.cos_prefix or "artvaultm",
    }


def build_client(params: dict):
    """按需导入 COS SDK，避免未启用时强依赖。"""
    from qcloud_cos import CosConfig, CosS3Client

    config = CosConfig(
        Region=params["region"],
        SecretId=params["secret_id"],
        SecretKey=params["secret_key"],
        Scheme="https",
    )
    return CosS3Client(config)


def test_connection(db: Session) -> dict:
    params = cos_params(db)
    if params is None:
        return {"ok": False, "message": "COS 未启用或配置不完整"}
    try:
        client = build_client(params)
        client.list_objects(Bucket=params["bucket"], Prefix=params["prefix"] + "/", MaxKeys=1)
        return {"ok": True, "message": "连接成功，桶可访问"}
    except Exception as exc:  # noqa: BLE001 - 需要把 SDK 的报错原文回给管理员
        return {"ok": False, "message": f"连接失败：{exc}"}
