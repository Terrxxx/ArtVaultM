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

# 作为封面/缩略图/头像上传的图片大小上限
MAX_IMAGE_BYTES = 5 * 1024 * 1024

# 封面：只转格式不做压缩（保持原始尺寸，WebP 高质量）
COVER_QUALITY = 95

# 版本缩略图：最长边 512，压到 10KB 以内
THUMB_MAX_EDGE = 512
THUMB_TARGET_BYTES = 10 * 1024
THUMB_QUALITIES = (82, 74, 66, 58, 50, 42, 34, 26, 20)

# 版本列表等紧凑场景用的小图
SMALL_THUMB_EDGE = 42
SMALL_THUMB_TARGET_BYTES = 3 * 1024
SMALL_QUALITIES = (70, 60, 50, 40, 30)

# 图片展示链接的有效期（头像/缩略图会随页面一起加载）
DISPLAY_URL_TTL = 6 * 3600


def _safe_name(filename: str) -> str:
    """仅保留文件名，去除路径分隔符，避免路径穿越。"""
    return os.path.basename(filename.replace("\\", "/")) or "file"


def safe_name(filename: str) -> str:
    """对外暴露的文件名清洗（分片上传也用）。"""
    return _safe_name(filename)


def new_staged_path() -> Path:
    """在暂存目录里开一个新的空文件路径（分片合并后落到这里，再由 place_upload 搬走）。"""
    return _tmp_dir() / f"{uuid.uuid4().hex}.part"


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


def _encode_webp(
    img, max_edge: Optional[int], target_bytes: Optional[int], qualities
) -> bytes:
    """编码 WebP。

    max_edge 为 None 表示不缩放（封面走这条路：只转格式，不压缩）；
    否则按质量迭代，仍超标就把最长边减半再来一轮。
    """
    from PIL import Image  # noqa: F401

    def encode(candidate):
        best = None
        for quality in qualities:
            buf = io.BytesIO()
            candidate.save(buf, format="WEBP", quality=quality, method=4)
            data = buf.getvalue()
            if best is None or len(data) < len(best):
                best = data
            if target_bytes is not None and len(data) <= target_bytes:
                break
        return best

    if max_edge is None:
        return encode(img)

    edge = max_edge
    best = None
    while edge >= 24:
        candidate = img.copy()
        candidate.thumbnail((edge, edge))
        data = encode(candidate)
        if best is None or (data is not None and len(data) < len(best)):
            best = data
        if target_bytes is not None and data is not None and len(data) <= target_bytes:
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


def read_upload(file: Optional[UploadFile]) -> tuple:
    """把上传文件读成 (bytes, 安全文件名)；无文件返回 (None, None)。

    上传流只能读一次，因此需要多次处理的场景（如封面同时要主图和小图）
    先读一次再把字节传给各个保存函数。
    """
    if file is None or not getattr(file, "filename", None):
        return None, None
    return file.file.read(), _safe_name(file.filename)


def prepare_thumbnails(raw: bytes) -> dict:
    """产出主图与 42×42 小图。

    返回 {"main": bytes|None, "small": bytes|None, "raw": bool}
    raw=True 表示不是可解码的图片，main 里是原始字节、small 为 None。
    """
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


def _store_image(data: Optional[bytes], key_base: str, cos: Optional[dict]) -> dict:
    """把图片字节落库；无数据返回空槽。"""
    if not data:
        return _empty_slot()
    return {
        "path": _put_bytes(data, f"{key_base}.webp", "image/webp", cos),
        "storage": "cos" if cos else "local",
    }


# 可由 PIL 解码、能用来派生封面的格式（其余如 fbx/psd 不必读入内存）
DERIVABLE_FORMATS = {"png", "jpg", "jpeg", "gif", "webp", "bmp", "tiff", "tif"}


def derive_cover_from_file(
    asset_id: int,
    raw: Optional[bytes],
    filename: Optional[str],
    cos: Optional[dict] = None,
) -> Optional[dict]:
    """资产文件本身就是图片时，直接用它派生封面，省去重复上传缩略图。

    不是可解码的图片就返回 None。
    """
    if not raw or not filename or _load_image(raw) is None:
        return None
    return save_asset_cover(asset_id, raw, filename, cos)


def prepare_cover(raw: bytes) -> dict:
    """封面：保持原始尺寸转成 WebP（不做压缩），另派生 42×42 小图。"""
    if not raw:
        return {"main": None, "small": None, "raw": False}

    img = _load_image(raw)
    if img is None:
        return {"main": raw, "small": None, "raw": True}

    return {
        "main": _encode_webp(img, None, None, (COVER_QUALITY,)),
        "small": _encode_webp(
            _square(img, SMALL_THUMB_EDGE),
            SMALL_THUMB_EDGE,
            SMALL_THUMB_TARGET_BYTES,
            SMALL_QUALITIES,
        ),
        "raw": False,
    }


def derive_small(raw: Optional[bytes]) -> Optional[bytes]:
    """从图片派生出 42×42 小图；不是可解码的图片就返回 None。"""
    if not raw:
        return None
    img = _load_image(raw)
    if img is None:
        return None
    return _encode_webp(
        _square(img, SMALL_THUMB_EDGE),
        SMALL_THUMB_EDGE,
        SMALL_THUMB_TARGET_BYTES,
        SMALL_QUALITIES,
    )


def store_version_small(
    asset_id: int, version: int, data: Optional[bytes], cos: Optional[dict] = None
) -> dict:
    """保存某个版本的 42×42 小图（由该版本的文件派生），返回 {path, storage}。"""
    if not data:
        return _empty_slot()
    key = f"thumbnails/{asset_id}_v{version}_{uuid.uuid4().hex[:8]}_s42"
    return _store_image(data, key, cos)


def ensure_image_size(raw: Optional[bytes]) -> None:
    """上传的图片超过上限时抛 ValueError（由接口层转成 400）。"""
    if raw and len(raw) > MAX_IMAGE_BYTES:
        raise ValueError(f"图片不能超过 {MAX_IMAGE_BYTES // (1024 * 1024)}MB")


def save_asset_cover(
    asset_id: int,
    raw: Optional[bytes],
    filename: Optional[str],
    cos: Optional[dict] = None,
) -> dict:
    """保存资产封面：主图（最长边 512、<10KB WebP）+ 42×42 小图。

    小图由封面自动派生，用户不需要额外上传。
    返回 {"main": {path, storage}, "small": {path, storage}}
    """
    if not raw or not filename:
        return {"main": _empty_slot(), "small": _empty_slot()}

    prepared = prepare_cover(raw)
    stem = f"thumbnails/asset{asset_id}_{uuid.uuid4().hex[:8]}"

    if prepared["raw"]:
        # 非图片：封面原样存，不派生小图
        ext = os.path.splitext(filename)[1] or ".bin"
        stored = _put_bytes(
            prepared["main"], f"{stem}{ext}", "application/octet-stream", cos
        )
        return {
            "main": {"path": stored, "storage": "cos" if cos else "local"},
            "small": _empty_slot(),
        }

    return {
        "main": _store_image(prepared["main"], stem, cos),
        "small": _store_image(prepared["small"], f"{stem}_s42", cos),
    }


def save_version_thumbnail(
    asset_id: int,
    version: int,
    raw: Optional[bytes],
    filename: Optional[str],
    cos: Optional[dict] = None,
) -> dict:
    """保存某个版本的缩略图（仅主图，用于版本预览），返回 {path, storage}。"""
    if not raw or not filename:
        return _empty_slot()

    prepared = prepare_thumbnails(raw)
    stem = f"thumbnails/{asset_id}_v{version}_{uuid.uuid4().hex[:8]}"

    if prepared["raw"]:
        if not prepared["main"]:
            return _empty_slot()
        ext = os.path.splitext(filename)[1] or ".bin"
        stored = _put_bytes(
            prepared["main"], f"{stem}{ext}", "application/octet-stream", cos
        )
        return {"path": stored, "storage": "cos" if cos else "local"}

    return _store_image(prepared["main"], stem, cos)


def save_avatar(
    user_id: int,
    raw: Optional[bytes],
    filename: Optional[str],
    cos: Optional[dict] = None,
) -> dict:
    """保存用户头像（压缩为 webp），返回 {path, storage}。"""
    if not raw or not filename:
        return _empty_slot()

    prepared = prepare_thumbnails(raw)
    stem = f"avatars/{user_id}_{uuid.uuid4().hex[:8]}"

    if prepared["raw"] or not prepared["main"]:
        if not prepared["main"]:
            return _empty_slot()
        ext = os.path.splitext(filename)[1] or ".bin"
        stored = _put_bytes(
            prepared["main"], f"{stem}{ext}", "application/octet-stream", cos
        )
        return {"path": stored, "storage": "cos" if cos else "local"}

    return _store_image(prepared["main"], stem, cos)


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
