from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from ..config import settings


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except ValueError:
        return False


def create_access_token(user_id: int, role: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=settings.access_token_expire_minutes
    )
    payload = {"sub": str(user_id), "role": role, "exp": expire}
    return jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)


def decode_token(token: str) -> dict:
    return jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])


# ---------- 预览用的短期令牌 ----------
# <img>/<video>/<audio> 无法携带 Authorization 头，因此为预览单独签发一个
# 只对某个版本有效、且很快过期的令牌，避免把登录 JWT 暴露在 URL 里。

STREAM_SCOPE = "stream"
STREAM_TOKEN_MINUTES = 10


def create_stream_token(version_id: int, user_id: int) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=STREAM_TOKEN_MINUTES)
    payload = {
        "sub": str(user_id),
        "ver": version_id,
        "scope": STREAM_SCOPE,
        "exp": expire,
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)


def decode_stream_token(token: str, version_id: int) -> int:
    """校验预览令牌并返回用户 id；不合法直接抛异常。"""
    payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
    if payload.get("scope") != STREAM_SCOPE or payload.get("ver") != version_id:
        raise ValueError("预览令牌不匹配")
    return int(payload["sub"])
