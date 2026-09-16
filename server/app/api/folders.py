from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Folder, User
from ..schemas import FolderCreate, FolderUpdate
from ..serializers import folder_to_dict, subtree_counts
from ..services import storage_config
from .assets import purge_asset
from .deps import can_edit_project, ensure_project_access, get_current_user

router = APIRouter()


def collect_subtree(folder: Folder) -> list:
    """该文件夹及其所有子孙文件夹（父在前），删除时按倒序处理。"""
    nodes = []
    stack = [folder]
    while stack:
        node = stack.pop()
        nodes.append(node)
        stack.extend(node.children)
    return nodes


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
    return [folder_to_dict(f) for f in folders]


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
    return folder_to_dict(folder)


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
    return folder_to_dict(folder)


@router.delete("/folders/{folder_id}")
def delete_folder(
    folder_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    folder = db.get(Folder, folder_id)
    if folder is None:
        raise HTTPException(status_code=404, detail="文件夹不存在")
    project = ensure_project_access(db, folder.project_id, user, write=True)

    subtree = collect_subtree(folder)
    asset_total, _ = subtree_counts(folder)
    # 普通成员可以整理文件夹，但不能借删文件夹把项目里的资产一并删掉
    if asset_total and not can_edit_project(project, user):
        raise HTTPException(
            status_code=403,
            detail="该文件夹内有资产，只有项目创建者或高级管理员可以删除",
        )

    # 连同所有子孙文件夹及其中的资产一起删除，子级先删避免留下悬挂引用
    cos = storage_config.cos_params(db)
    for node in reversed(subtree):
        for asset in list(node.assets):
            purge_asset(db, asset, cos)
        db.delete(node)

    db.commit()
    return {"ok": True}
