"""把某个文件夹（含子文件夹）下的资产打包成一个 zip。

zip 里保留文件夹层级，每个资产放它的最新版本，文件名用「资产名 + 原扩展名」。
用 ZIP_STORED 不压缩：模型/贴图本身就是压缩过的，再 deflate 一遍只是白烧 CPU。
"""

import uuid
import zipfile
from pathlib import Path
from typing import List, Optional, Tuple

from sqlalchemy.orm import Session

from ..config import settings
from ..models import Asset, Folder
from . import storage, trash


def _clean(name: str) -> str:
    """文件夹/资产名是用户输入，去掉路径分隔符避免 zip 内目录穿越。"""
    return (name or "").replace("/", "_").replace("\\", "_").strip() or "未命名"


def collect(db: Session, project_id: int, folder_id: int) -> List[Tuple[str, Asset]]:
    """返回 [(zip 内相对目录, 资产)]，从指定目录往下递归。

    folder_id 为 0 表示项目根目录，也就是整个项目。
    """
    folders = db.query(Folder).filter(Folder.project_id == project_id).all()
    children: dict = {}
    for f in folders:
        children.setdefault(f.parent_id or 0, []).append(f)

    found: List[Tuple[str, Asset]] = []

    def walk(fid: int, prefix: str) -> None:
        query = db.query(Asset).filter(Asset.project_id == project_id, trash.alive())
        query = query.filter(
            Asset.folder_id.is_(None) if fid == 0 else Asset.folder_id == fid
        )
        for asset in query.order_by(Asset.name).all():
            found.append((prefix, asset))
        for child in children.get(fid, []):
            walk(child.id, f"{prefix}{_clean(child.name)}/")

    walk(folder_id, "")
    return found


def _entry_name(asset: Asset, version, used: set) -> str:
    """zip 内这个资产叫什么：资产名 + 原扩展名；重名时补一个序号。"""
    ext = f".{version.file_format}" if version.file_format else Path(version.file_name).suffix
    base = _clean(asset.name)
    name = f"{base}{ext}"
    n = 2
    while name in used:
        name = f"{base} ({n}){ext}"
        n += 1
    used.add(name)
    return name


def build(
    db: Session, project_id: int, folder_id: int, cos: Optional[dict]
) -> Tuple[Path, int, int]:
    """打包并返回 (zip 临时文件路径, 打进包里的资产数, 跳过的资产数)。"""
    items = collect(db, project_id, folder_id)
    tmp_dir = Path(settings.upload_dir) / "_tmp"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    zip_path = tmp_dir / f"export_{uuid.uuid4().hex}.zip"

    packed = 0
    skipped = 0
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_STORED) as zf:
        used: set = set()
        for prefix, asset in items:
            version = next((v for v in asset.versions if v.is_latest), None)
            if version is None and asset.versions:
                version = asset.versions[0]
            if version is None:
                skipped += 1
                continue

            rel = f"{prefix}{_entry_name(asset, version, used)}"
            staged = tmp_dir / f"{uuid.uuid4().hex}.part"
            try:
                if not storage.fetch_to(
                    version.file_path, version.storage or "local", staged, cos
                ):
                    # 文件不在了（比如对象存储上被手工删过），跳过但继续打包
                    skipped += 1
                    continue
                zf.write(staged, arcname=rel)
                packed += 1
            finally:
                staged.unlink(missing_ok=True)

    return zip_path, packed, skipped
