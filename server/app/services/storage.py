import hashlib
import os
import shutil
import uuid
from pathlib import Path
from typing import Optional

from fastapi import UploadFile

from ..config import settings
from . import storage_config

CHUNK = 1024 * 1024

# 说明：缩略图与头像始终保存在本地（前端用 <img> 直读 /uploads，无需每次签名）；
# 仅「资产文件本体」会按配置上传到 COS。


def _safe_name(filename: str) -> str:
    """仅保留文件名，去除路径分隔符，避免路径穿越。"""
    return os.path.basename(filename.replace("\\", "/")) or "file"


def _tmp_dir() -> Path:
    d = Path(settings.upload_dir) / "_tmp"
    d.mkdir(parents=True, exist_ok=True)
    return d


def stage_upload(file: UploadFile) -> dict:
    """把上传流写入临时文件，同时计算 sha256。返回暂存信息。"""
    safe_name = _safe_name(file.filename or "file")
    tmp_path = _tmp_dir() / f"{uuid.uuid4().hex}.part"

    hasher = hashlib.sha256()
    size = 0
    with tmp_path.open("wb") as f:
        while True:
            chunk = file.file.read(CHUNK)
            if not chunk:
                break
            hasher.update(chunk)
            size += len(chunk)
            f.write(chunk)

    return {
        "tmp_path": tmp_path,
        "file_hash": hasher.hexdigest(),
        "file_name": safe_name,
        "file_size": size,
        "file_format": os.path.splitext(safe_name)[1].lstrip(".").lower() or None,
    }


def place_upload(
    tmp_path: Path,
    project_id: int,
    asset_id: int,
    version: int,
    safe_name: str,
    cos: Optional[dict] = None,
) -> dict:
    """把暂存文件放到最终位置（COS 或本地），返回 {file_path, storage}。"""
    rel_dir = Path("projects") / str(project_id) / "assets" / str(asset_id) / f"v{version}"
    stored_name = f"{uuid.uuid4().hex}_{safe_name}"

    if cos:
        object_key = f"{cos['prefix']}/{rel_dir.as_posix()}/{stored_name}"
        client = storage_config.build_client(cos)
        client.upload_file(
            Bucket=cos["bucket"],
            Key=object_key,
            LocalFilePath=str(tmp_path),
            EnableMD5=False,
        )
        tmp_path.unlink(missing_ok=True)
        return {"file_path": object_key, "storage": "cos"}

    out_dir = Path(settings.upload_dir) / rel_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / stored_name
    shutil.move(str(tmp_path), str(out_path))
    return {"file_path": (rel_dir / stored_name).as_posix(), "storage": "local"}


def discard_staged(tmp_path: Path) -> None:
    """丢弃暂存文件（去重命中时使用）。"""
    try:
        tmp_path.unlink(missing_ok=True)
    except OSError:
        pass


def save_version_thumbnail(asset_id: int, version: int, file: UploadFile) -> Optional[str]:
    """保存某个版本的缩略图（始终存本地），返回相对路径。"""
    if file is None or not file.filename:
        return None
    rel_dir = Path("thumbnails")
    out_dir = Path(settings.upload_dir) / rel_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    safe_name = _safe_name(file.filename)
    ext = os.path.splitext(safe_name)[1] or ".png"
    stored_name = f"{asset_id}_v{version}_{uuid.uuid4().hex[:8]}{ext}"
    path = out_dir / stored_name

    with path.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    return (rel_dir / stored_name).as_posix()


def save_avatar(user_id: int, file: UploadFile) -> Optional[str]:
    """保存用户头像（始终存本地），返回相对路径。"""
    if file is None or not file.filename:
        return None
    rel_dir = Path("avatars")
    out_dir = Path(settings.upload_dir) / rel_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    safe_name = _safe_name(file.filename)
    ext = os.path.splitext(safe_name)[1] or ".png"
    stored_name = f"{user_id}_{uuid.uuid4().hex[:8]}{ext}"
    path = out_dir / stored_name

    with path.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    return (rel_dir / stored_name).as_posix()


def resolve_path(rel_path: str) -> Path:
    return Path(settings.upload_dir) / rel_path


def file_exists(rel_path: str, storage: str = "local", cos: Optional[dict] = None) -> bool:
    """判断某个版本的文件是否还在（本地磁盘或 COS）。"""
    if storage == "cos":
        if not cos:
            return False
        try:
            storage_config.build_client(cos).head_object(
                Bucket=cos["bucket"], Key=rel_path
            )
            return True
        except Exception:  # noqa: BLE001 - 不存在或请求失败都按「不可用」处理
            return False
    return resolve_path(rel_path).exists()


def delete_file(rel_path: Optional[str], storage: str = "local", cos: Optional[dict] = None) -> None:
    """删除单个文件，忽略不存在的情况。"""
    if not rel_path:
        return
    if storage == "cos":
        if not cos:
            return
        try:
            storage_config.build_client(cos).delete_object(
                Bucket=cos["bucket"], Key=rel_path
            )
        except Exception:  # noqa: BLE001 - 删除失败不应阻断主流程
            pass
        return
    try:
        resolve_path(rel_path).unlink(missing_ok=True)
    except OSError:
        pass


def delete_asset_dir(project_id: int, asset_id: int) -> None:
    """删除某个资产在本地的全部版本目录。"""
    target = (
        Path(settings.upload_dir)
        / "projects"
        / str(project_id)
        / "assets"
        / str(asset_id)
    )
    shutil.rmtree(target, ignore_errors=True)


def presigned_url(key: str, cos: dict, expires: int = 600) -> str:
    """生成 COS 临时下载链接（有效期默认 10 分钟）。"""
    client = storage_config.build_client(cos)
    return client.get_presigned_url(
        Method="GET",
        Bucket=cos["bucket"],
        Key=key,
        Expired=expires,
    )
