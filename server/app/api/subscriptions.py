from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Asset, Subscription, User
from ..schemas import SubscribeRequest
from .deps import ensure_project_access, get_current_user

router = APIRouter()


def _validate_target(db: Session, user: User, target_type: str, target_id: int) -> None:
    if target_type == "project":
        ensure_project_access(db, target_id, user)
    elif target_type == "asset":
        asset = db.get(Asset, target_id)
        if asset is None:
            raise HTTPException(status_code=404, detail="资产不存在")
        ensure_project_access(db, asset.project_id, user)
    else:
        raise HTTPException(status_code=400, detail="订阅类型只能是 project 或 asset")


@router.get("/subscriptions")
def my_subscriptions(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    subs = db.query(Subscription).filter(Subscription.user_id == user.id).all()
    return [
        {"id": s.id, "target_type": s.target_type, "target_id": s.target_id} for s in subs
    ]


@router.post("/subscriptions/toggle")
def toggle_subscription(
    payload: SubscribeRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _validate_target(db, user, payload.target_type, payload.target_id)

    sub = (
        db.query(Subscription)
        .filter(
            Subscription.user_id == user.id,
            Subscription.target_type == payload.target_type,
            Subscription.target_id == payload.target_id,
        )
        .first()
    )
    if sub is not None:
        db.delete(sub)
        db.commit()
        return {"subscribed": False}

    db.add(
        Subscription(
            user_id=user.id,
            target_type=payload.target_type,
            target_id=payload.target_id,
        )
    )
    db.commit()
    return {"subscribed": True}
