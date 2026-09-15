from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..models import Notification, User
from ..services.notify import notification_to_dict
from .deps import get_current_user

router = APIRouter()


@router.get("/notifications")
def list_notifications(
    unread_only: bool = False,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    query = (
        db.query(Notification)
        .options(joinedload(Notification.actor))
        .filter(Notification.user_id == user.id)
    )
    if unread_only:
        query = query.filter(Notification.is_read.is_(False))
    items = query.order_by(Notification.created_at.desc()).limit(100).all()
    return [notification_to_dict(n) for n in items]


@router.get("/notifications/unread-count")
def unread_count(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    count = (
        db.query(Notification)
        .filter(Notification.user_id == user.id, Notification.is_read.is_(False))
        .count()
    )
    return {"count": count}


@router.patch("/notifications/{notification_id}/read")
def mark_read(
    notification_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    n = db.get(Notification, notification_id)
    if n is None or n.user_id != user.id:
        raise HTTPException(status_code=404, detail="消息不存在")
    n.is_read = True
    db.commit()
    return {"ok": True}


@router.post("/notifications/read-all")
def mark_all_read(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    db.query(Notification).filter(
        Notification.user_id == user.id, Notification.is_read.is_(False)
    ).update({Notification.is_read: True})
    db.commit()
    return {"ok": True}
