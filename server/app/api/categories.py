from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Category, User
from ..schemas import CategoryCreate, CategoryUpdate
from ..serializers import category_to_dict
from .deps import ensure_project_access, ensure_project_editor, get_current_user

router = APIRouter()


@router.get("/projects/{project_id}/categories")
def list_categories(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ensure_project_access(db, project_id, user)
    categories = (
        db.query(Category)
        .filter(Category.project_id == project_id)
        .order_by(Category.sort_order)
        .all()
    )
    return [category_to_dict(c) for c in categories]


@router.post("/projects/{project_id}/categories")
def create_category(
    project_id: int,
    payload: CategoryCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ensure_project_editor(db, project_id, user)
    if payload.parent_id is not None:
        parent = db.get(Category, payload.parent_id)
        if parent is None or parent.project_id != project_id:
            raise HTTPException(status_code=400, detail="父文件夹不存在或不属于该项目")
    category = Category(
        project_id=project_id,
        parent_id=payload.parent_id,
        name=payload.name,
        sort_order=payload.sort_order,
        is_system=False,
    )
    db.add(category)
    db.commit()
    db.refresh(category)
    return category_to_dict(category)


@router.patch("/categories/{category_id}")
def update_category(
    category_id: int,
    payload: CategoryUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    category = db.get(Category, category_id)
    if category is None:
        raise HTTPException(status_code=404, detail="分类不存在")
    ensure_project_editor(db, category.project_id, user)
    if payload.name is not None:
        category.name = payload.name
    if payload.sort_order is not None:
        category.sort_order = payload.sort_order
    if payload.parent_id is not None:
        if payload.parent_id == 0:
            category.parent_id = None
        else:
            if payload.parent_id == category_id:
                raise HTTPException(status_code=400, detail="不能把文件夹移动到自身")
            parent = db.get(Category, payload.parent_id)
            if parent is None or parent.project_id != category.project_id:
                raise HTTPException(status_code=400, detail="目标文件夹不存在或不属于该项目")
            # 防止把文件夹移动到自己的子文件夹里（形成环）
            cur = parent
            while cur is not None:
                if cur.id == category_id:
                    raise HTTPException(status_code=400, detail="不能把文件夹移动到其子文件夹内")
                cur = cur.parent
            category.parent_id = payload.parent_id
    db.commit()
    db.refresh(category)
    return category_to_dict(category)


@router.delete("/categories/{category_id}")
def delete_category(
    category_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    category = db.get(Category, category_id)
    if category is None:
        raise HTTPException(status_code=404, detail="分类不存在")
    ensure_project_editor(db, category.project_id, user)
    if category.assets:
        raise HTTPException(status_code=400, detail="该文件夹下仍有资产，无法删除")
    has_children = (
        db.query(Category).filter(Category.parent_id == category_id).first() is not None
    )
    if has_children:
        raise HTTPException(status_code=400, detail="该文件夹下仍有子文件夹，无法删除")
    db.delete(category)
    db.commit()
    return {"ok": True}
