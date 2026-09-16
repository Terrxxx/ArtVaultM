from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask
from sqlalchemy.orm import Session

from ..core.security import create_zip_token, decode_zip_token
from ..database import get_db
from ..models import Folder, User
from ..services import storage_config, zip_export
from .deps import ensure_project_access, get_current_user

router = APIRouter()


def _folder_or_none(db: Session, project_id: int, folder_id: int):
    if not folder_id:
        return None
    folder = db.get(Folder, folder_id)
    if folder is None or folder.project_id != project_id:
        raise HTTPException(status_code=404, detail="文件夹不存在或不属于该项目")
    return folder


@router.get("/projects/{project_id}/zip-token")
def zip_token(
    project_id: int,
    folder_id: int = 0,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """签一个短期令牌给打包下载用。

    打包结果要交给浏览器原生下载（大 zip 用 XHR 拉进内存会炸），
    而原生下载带不了 Authorization 头，所以照预览的做法把令牌放进 URL。
    """
    ensure_project_access(db, project_id, user)
    _folder_or_none(db, project_id, folder_id)
    return {
        "token": create_zip_token(project_id, folder_id, user.id),
        "url": f"/api/projects/{project_id}/download-zip?folder_id={folder_id}",
    }


@router.get("/projects/{project_id}/download-zip")
def download_zip(
    project_id: int,
    folder_id: int = 0,
    t: str = "",
    db: Session = Depends(get_db),
):
    """把该目录（含子文件夹）下所有资产的最新版本打包成 zip。"""
    try:
        user_id = decode_zip_token(t, project_id, folder_id)
    except Exception:  # noqa: BLE001 - 过期、篡改、缺参数都算无效
        raise HTTPException(status_code=401, detail="下载链接无效或已过期")

    user = db.get(User, user_id)
    if user is None or user.status != "active" or user.deleted_at is not None:
        raise HTTPException(status_code=401, detail="用户不存在或已被禁用")

    project = ensure_project_access(db, project_id, user)
    folder = _folder_or_none(db, project_id, folder_id)

    cos = storage_config.cos_params(db)
    zip_path, packed, skipped = zip_export.build(db, project_id, folder_id, cos)
    if packed == 0:
        zip_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="这个目录下没有可下载的资产")

    name = f"{project.name} - {folder.name if folder else '全部'}.zip"
    return FileResponse(
        zip_path,
        media_type="application/zip",
        filename=name,
        background=BackgroundTask(_remove, zip_path),
    )


def _remove(path: Path) -> None:
    path.unlink(missing_ok=True)
