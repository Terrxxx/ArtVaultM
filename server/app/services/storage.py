import hashlib
import io
import os
import shutil
import uuid
from pathlib import Path
from typing import Optional

from fastapi import UploadFile

from ..config import settings
from . import storage_config

CHUNK = 1024 * 1024

# 主缩略图：最长边 512，压到 10KB 以内
THUMB_MAX_EDGE = 512
THUMB_TARGET_BYTES = 10 * 1024
THUMB_QUALITIES = (82, 74, 66, 58, 50, 42, 34, 26, 20)

# 版本列表用的小图：固定 56x56 正方形，尽量压小
SMALL_THUMB_EDGE = 56
SMALL_THUMB_TARGET_BYTES = 4 * 1024
SMALL_QUALITIES = (70, 60, 50, 40, 30)

# 图片展示链接的有效期（头像/缩略图会随页面一起加载）
DISPLAY_URL_TTL = 6 * 3600


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


# ---------- 图片处理 ----------


def _load_image(raw: bytes):
    """解码成 RGB/RGBA，失败返回 None（非图片）。"""
    try:
        from PIL import Image, ImageOps

        img = Image.open(io.BytesIO(raw))
        img = ImageOps.exif_transpose(img)
        return img.convert("RGBA" if img.mode in ("RGBA", "LA", "P") else "RGB")
    except Exception:  # noqa: BLE001
        return None


def _encode_webp(img, max_edge: int, target_bytes: int, qualities) -> bytes:
    """按质量迭代编码；仍超标就把最长边减半再来一轮。"""
    from PIL import Image  # noqa: F401

    edge = max_edge
    best = None
    while edge >= 24:
        candidate = img.copy()
        candidate.thumbnail((edge, edge))
        for quality in qualities:
            buf = io.BytesIO()
            candidate.save(buf, format="WEBP", quality=quality, method=4)
            data = buf.getvalue()
            if best is None or len(data) < len(best):
                best = data
            if len(data) <= target_bytes:
                return data
        edge //= 2
    return best


def _square(img, size: int):
    """居中裁成正方形再缩放到 size×size（版本列表按 1:1 展示）。"""
    from PIL import Image

    w, h = img.size
    side = min(w, h)
    left = (w - side) // 2
    top = (h - side) // 2
    cropped = img.crop((left, top, left + side, top + side)) if side else img
    return cropped.resize((size, size), Image.LANCZOS)


def prepare_thumbnails(file: UploadFile) -> dict:
    """只读一次上传流，产出主图与 56×56 小图。

    返回 {"main": bytes|None, "small": bytes|None, "raw": bool}
    raw=True 表示不是可解码的图片，main 里是原始字节、small 为 None。
    """
    raw = file.file.read()
    if not raw:
        return {"main": None, "small": None, "raw": False}

    img = _load_image(raw)
    if img is None:
        return {"main": raw, "small": None, "raw": True}

    return {
        "main": _encode_webp(img, THUMB_MAX_EDGE, THUMB_TARGET_BYTES, THUMB_QUALITIES),
        "small": _encode_webp(
            _square(img, SMALL_THUMB_EDGE),
            SMALL_THUMB_EDGE,
            SMALL_THUMB_TARGET_BYTES,
            SMALL_QUALITIES,
        ),
        "raw": False,
    }


def _put_bytes(data: bytes, key: str, content_type: str, cos: Optional[dict]) -> str:
    """把内存中的字节写入 COS 或本地，返回存储路径。"""
    if cos:
        object_key = f"{cos['prefix']}/{key}"
        storage_config.build_client(cos).put_object(
            Bucket=cos["bucket"], Body=data, Key=object_key, ContentType=content_type
        )
        return object_key

    path = Path(settings.upload_dir) / key
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return key


def _empty_slot() -> dict:
    return {"path": None, "storage": "local"}


def _store_image(
    data: Optional[bytes], key_base: str, file: UploadFile, cos: Optional[dict]
) -> dict:
    """把图片字节落库；无数据返回空槽。"""
    if not data:
        return _empty_slot()
    return {
        "path": _put_bytes(data, f"{key_base}.webp", "image/webp", cos),
        "storage": "cos" if cos else "local",
    }


def save_version_thumbnails(
    asset_id: int, version: int, file: Optional[UploadFile], cos: Optional[dict] = None
) -> dict:
    """保存某个版本的主缩略图与 56×56 小图。

    返回 {"main": {path, storage}, "small": {path, storage}}
    """
    if file is None or not file.filename:
        return {"main": _empty_slot(), "small": _empty_slot()}

    prepared = prepare_thumbnails(file)
    stem = f"thumbnails/{asset_id}_v{version}_{uuid.uuid4().hex[:8]}"

    if prepared["raw"]:
        # 非图片：主图原样存（保留原扩展名），不生成 1:1 小图
        ext = os.path.splitext(_safe_name(file.filename))[1] or ".bin"
        stored = _put_bytes(
            prepared["main"], f"{stem}{ext}", "application/octet-stream", cos
        )
        return {
            "main": {"path": stored, "storage": "cos" if cos else "local"},
            "small": _empty_slot(),
        }

    return {
        "main": _store_image(prepared["main"], stem, file, cos),
        "small": _store_image(prepared["small"], f"{stem}_s56", file, cos),
    }


def save_avatar(
    user_id: int, file: Optional[UploadFile], cos: Optional[dict] = None
) -> dict:
    """保存用户头像（压缩为 webp），返回 {path, storage}。"""
    if file is None or not file.filename:
        return _empty_slot()

    prepared = prepare_thumbnails(file)
    stem = f"avatars/{user_id}_{uuid.uuid4().hex[:8]}"

    if prepared["raw"] or not prepared["main"]:
        if not prepared["main"]:
            return _empty_slot()
        ext = os.path.splitext(_safe_name(file.filename))[1] or ".bin"
        stored = _put_bytes(
            prepared["main"], f"{stem}{ext}", "application/octet-stream", cos
        )
        return {"path": stored, "storage": "cos" if cos else "local"}

    return _store_image(prepared["main"], stem, file, cos)


# ---------- 资产文件 ----------


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


def resolve_path(rel_path: str) -> Path:
    return Path(settings.upload_dir) / rel_path


def file_exists(rel_path: str, storage: str = "local", cos: Optional[dict] = None) -> bool:
    """判断文件是否还在（本地磁盘或 COS）。"""
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


def delete_file(
    rel_path: Optional[str], storage: str = "local", cos: Optional[dict] = None
) -> None:
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


def presigned_url(
    key: str, cos: dict, expires: int = 600, download_name: Optional[str] = None
) -> str:
    """生成 COS 临时访问链接；给了 download_name 则让对象以附件形式下载。"""
    params = None
    if download_name:
        from urllib.parse import quote

        params = {
            "response-content-disposition": (
                f"attachment; filename*=UTF-8''{quote(download_name)}"
            )
        }
    client = storage_config.build_client(cos)
    return client.get_presigned_url(
        Method="GET",
        Bucket=cos["bucket"],
        Key=key,
        Expired=expires,
        Params=params,
    )


def display_url(rel_path: Optional[str], storage: str = "local") -> Optional[str]:
    """把存储路径转成前端可直接使用的 URL（本地走 /uploads，COS 走临时签名）。"""
    if not rel_path:
        return None
    if storage == "cos":
        cos = storage_config.cached_params()
        if not cos:
            return None
        try:
            return presigned_url(rel_path, cos, DISPLAY_URL_TTL)
        except Exception:  # noqa: BLE001
            return None
    return f"/uploads/{rel_path}"
