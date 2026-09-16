from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Folder, User
from ..schemas import FolderCreate, FolderUpdate
from ..serializers import folder_to_dict
from ..services import trash
from ..services.folders import collect_subtree, subtree_counts
from ..services.permissions import can_delete_folder
from .deps import ensure_project_access, get_current_user

router = APIRouter()


@router.get("/projects/{project_id}/folders")
def list_folders(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ensure_project_access(db, project_id, user)
    folders = (
        db.query(Folder)
        .filter(Folder.project_id == project_id)
        .order_by(Folder.sort_order)
        .all()
    )
    return [folder_to_dict(f, user) for f in folders]


@router.post("/projects/{project_id}/folders")
def create_folder(
    project_id: int,
    payload: FolderCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ensure_project_access(db, project_id, user, write=True)
    if payload.parent_id is not None:
        parent = db.get(Folder, payload.parent_id)
        if parent is None or parent.project_id != project_id:
            raise HTTPException(status_code=400, detail="父文件夹不存在或不属于该项目")
    folder = Folder(
        project_id=project_id,
        parent_id=payload.parent_id,
        name=payload.name,
        sort_order=payload.sort_order,
    )
    db.add(folder)
    db.commit()
    db.refresh(folder)
    return folder_to_dict(folder, user)


@router.patch("/folders/{folder_id}")
def update_folder(
    folder_id: int,
    payload: FolderUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    folder = db.get(Folder, folder_id)
    if folder is None:
        raise HTTPException(status_code=404, detail="文件夹不存在")
    ensure_project_access(db, folder.project_id, user, write=True)
    if payload.name is not None:
        folder.name = payload.name
    if payload.sort_order is not None:
        folder.sort_order = payload.sort_order
    if payload.parent_id is not None:
        if payload.parent_id == 0:
            folder.parent_id = None
        else:
            if payload.parent_id == folder_id:
                raise HTTPException(status_code=400, detail="不能把文件夹移动到自身")
            parent = db.get(Folder, payload.parent_id)
            if parent is None or parent.project_id != folder.project_id:
                raise HTTPException(status_code=400, detail="目标文件夹不存在或不属于该项目")
            # 防止把文件夹移动到自己的子文件夹里（形成环）
            cur = parent
            while cur is not None:
                if cur.id == folder_id:
                    raise HTTPException(status_code=400, detail="不能把文件夹移动到其子文件夹内")
                cur = cur.parent
            folder.parent_id = payload.parent_id
    db.commit()
    db.refresh(folder)
    return folder_to_dict(folder, user)


@router.delete("/folders/{folder_id}")
def delete_folder(
    folder_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    folder = db.get(Folder, folder_id)
    if folder is None:
        raise HTTPException(status_code=404, detail="文件夹不存在")
    ensure_project_access(db, folder.project_id, user, write=True)

    # 普通成员可以整理文件夹，但不能借删文件夹把项目里的资产一并删掉（规则见 services/permissions）
    if not can_delete_folder(folder, user):
        raise HTTPException(
            status_code=403,
            detail="该文件夹内有资产，只有项目创建者或高级管理员可以删除",
        )

    subtree = collect_subtree(folder)

    # 资产进回收站（记住原文件夹，恢复时尽量放回去），文件夹本身直接删
    for node in subtree:
        for asset in list(node.assets):
            trash.soft_delete(asset)
    for node in reversed(subtree):
        db.delete(node)

    db.commit()
    return {"ok": True}
