from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Category, User
from ..schemas import CategoryCreate, CategoryUpdate
from ..serializers import categories_in_display_order, category_to_dict
from .deps import ensure_project_access, ensure_project_editor, get_current_user

router = APIRouter()


@router.get("/projects/{project_id}/categories")
def list_categories(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ensure_project_access(db, project_id, user)
    categories = db.query(Category).filter(Category.project_id == project_id).all()
    return [category_to_dict(c) for c in categories_in_display_order(categories)]


@router.post("/projects/{project_id}/categories")
def create_category(
    project_id: int,
    payload: CategoryCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ensure_project_editor(db, project_id, user)
    category = Category(
        project_id=project_id,
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
        raise HTTPException(status_code=400, detail="该分类下仍有资产，无法删除")
    db.delete(category)
    db.commit()
    return {"ok": True}
