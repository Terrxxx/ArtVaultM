"""分片上传的会话管理。

按「同一页面内可续传」设计：会话状态写在磁盘上（不是数据库），
客户端持有 upload_id；某一片失败后重试时先查已上传的分片，跳过重传。

合并后的完整文件落在 storage 的暂存目录里，形态与 stage_upload 的返回一致，
后续的去重、落盘（本地/COS）、派生封面的逻辑完全复用，两种存储都不需要单独处理。
"""

import hashlib
import json
import shutil
import time
import uuid
from pathlib import Path
from typing import List, Optional

from ..config import settings
from . import storage

# 分片大小；客户端按它切片，服务端不强制
CHUNK_SIZE = 8 * 1024 * 1024
# 没传完的会话多久后清理
SESSION_TTL_SECONDS = 24 * 3600


class UploadSessionError(Exception):
    """会话不存在、不属于当前用户，或分片不完整。"""


def _root() -> Path:
    d = Path(settings.upload_dir) / "_uploads"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _meta_path(upload_id: str) -> Path:
    return _root() / upload_id / "meta.json"


def _read_meta(upload_id: str) -> Optional[dict]:
    p = _meta_path(upload_id)
    if not p.is_file():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _write_meta(upload_id: str, meta: dict) -> None:
    p = _meta_path(upload_id)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")


def _chunks_dir(upload_id: str) -> Path:
    return _root() / upload_id / "chunks"


def uploaded_indexes(upload_id: str) -> List[int]:
    """已经收到哪些分片——续传时客户端拿它对账。"""
    d = _chunks_dir(upload_id)
    if not d.is_dir():
        return []
    return sorted(int(f.name) for f in d.iterdir() if f.name.isdigit())


def total_chunks(file_size: int, chunk_size: int = CHUNK_SIZE) -> int:
    if file_size <= 0:
        return 1
    return (file_size + chunk_size - 1) // chunk_size


def new_session(user_id: int, file_name: str, file_size: int) -> dict:
    upload_id = uuid.uuid4().hex
    meta = {
        "upload_id": upload_id,
        "user_id": user_id,
        "file_name": storage.safe_name(file_name),
        "file_size": file_size,
        "chunk_size": CHUNK_SIZE,
        "total_chunks": total_chunks(file_size),
        "created_at": time.time(),
    }
    _write_meta(upload_id, meta)
    _chunks_dir(upload_id).mkdir(parents=True, exist_ok=True)
    return meta


def get_session(upload_id: str, user_id: int) -> dict:
    """取会话并校验归属，避免拿到别人的 upload_id 就能续传。"""
    meta = _read_meta(upload_id)
    if meta is None or meta.get("user_id") != user_id:
        raise UploadSessionError("上传会话不存在或已过期")
    return meta


def save_chunk(upload_id: str, index: int, data: bytes) -> None:
    d = _chunks_dir(upload_id)
    d.mkdir(parents=True, exist_ok=True)
    (d / str(index)).write_bytes(data)


def finish(upload_id: str, user_id: int) -> dict:
    """校验分片齐全后合并成一个暂存文件，返回与 storage.stage_upload 同构的 dict。"""
    meta = get_session(upload_id, user_id)
    have = set(uploaded_indexes(upload_id))
    need = set(range(meta["total_chunks"]))
    if have != need:
        missing = sorted(need - have)
        raise UploadSessionError("还有 %d 个分片没传完" % len(missing))

    tmp_path = storage.new_staged_path()
    hasher = hashlib.sha256()
    size = 0
    try:
        with tmp_path.open("wb") as out:
            for i in sorted(need):
                data = (_chunks_dir(upload_id) / str(i)).read_bytes()
                out.write(data)
                hasher.update(data)
                size += len(data)
    except OSError as exc:
        tmp_path.unlink(missing_ok=True)
        raise UploadSessionError("合并分片失败：%s" % exc) from exc

    # 分片本身没用了，及时清掉
    shutil.rmtree(_root() / upload_id, ignore_errors=True)

    name = meta["file_name"]
    return {
        "tmp_path": tmp_path,
        "file_hash": hasher.hexdigest(),
        "file_name": name,
        "file_size": size,
        "file_format": name.rsplit(".", 1)[-1].lower() if "." in name else None,
    }


def drop_session(upload_id: str) -> None:
    shutil.rmtree(_root() / upload_id, ignore_errors=True)


def purge_stale(max_age_seconds: int = SESSION_TTL_SECONDS) -> int:
    """清掉长时间没传完的会话，返回清理数量。"""
    if not _root().is_dir():
        return 0
    deadline = time.time() - max_age_seconds
    removed = 0
    for entry in _root().iterdir():
        if not entry.is_dir():
            continue
        meta = _read_meta(entry.name)
        created = (meta or {}).get("created_at", 0)
        if created and created > deadline:
            continue
        shutil.rmtree(entry, ignore_errors=True)
        removed += 1
    return removed
