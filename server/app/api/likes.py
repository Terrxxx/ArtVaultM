from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Asset, Like, User
from .deps import ensure_project_access, get_current_user

router = APIRouter()


@router.post("/assets/{asset_id}/like")
def toggle_like(
    asset_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    asset = db.get(Asset, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="资产不存在")
    ensure_project_access(db, asset.project_id, user)

    like = (
        db.query(Like)
        .filter(Like.user_id == user.id, Like.asset_id == asset_id)
        .first()
    )
    if like is not None:
        db.delete(like)
        db.commit()
        liked = False
    else:
        db.add(Like(user_id=user.id, asset_id=asset_id))
        db.commit()
        liked = True

    count = db.query(Like).filter(Like.asset_id == asset_id).count()
    return {"liked": liked, "like_count": count}
