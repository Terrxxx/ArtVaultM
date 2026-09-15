import hashlib
import os
import shutil
import uuid
from pathlib import Path
from typing import Optional

from fastapi import UploadFile

from ..config import settings

CHUNK = 1024 * 1024


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
    tmp_path: Path, project_id: int, asset_id: int, version: int, safe_name: str
) -> str:
    """把暂存文件移动到资产版本目录，返回相对路径（正斜杠）。"""
    rel_dir = Path("projects") / str(project_id) / "assets" / str(asset_id) / f"v{version}"
    out_dir = Path(settings.upload_dir) / rel_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    stored_name = f"{uuid.uuid4().hex}_{safe_name}"
    out_path = out_dir / stored_name
    shutil.move(str(tmp_path), str(out_path))
    return (rel_dir / stored_name).as_posix()


def discard_staged(tmp_path: Path) -> None:
    """丢弃暂存文件（去重命中时使用）。"""
    try:
        tmp_path.unlink(missing_ok=True)
    except OSError:
        pass


def save_version_thumbnail(asset_id: int, version: int, file: UploadFile) -> Optional[str]:
    """保存某个版本的缩略图，返回相对路径。"""
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
    """保存用户头像，返回相对路径。"""
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


def delete_file(rel_path: Optional[str]) -> None:
    """删除单个相对路径对应的文件，忽略不存在的情况。"""
    if not rel_path:
        return
    try:
        resolve_path(rel_path).unlink(missing_ok=True)
    except OSError:
        pass


def delete_asset_dir(project_id: int, asset_id: int) -> None:
    """删除某个资产的全部版本文件目录。"""
    target = (
        Path(settings.upload_dir)
        / "projects"
        / str(project_id)
        / "assets"
        / str(asset_id)
    )
    shutil.rmtree(target, ignore_errors=True)
