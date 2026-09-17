from typing import List, Optional

from sqlalchemy.orm import Session

from ..models import Notification, Subscription, User
from . import clock


def add_notification(
    db: Session,
    user_id: int,
    type: str,
    actor_id: Optional[int] = None,
    project_id: Optional[int] = None,
    asset_id: Optional[int] = None,
    comment_id: Optional[int] = None,
    content: Optional[str] = None,
) -> Optional[Notification]:
    """给某个用户创建一条站内消息。自己触发的不通知自己。"""
    if actor_id is not None and actor_id == user_id:
        return None
    n = Notification(
        user_id=user_id,
        type=type,
        actor_id=actor_id,
        project_id=project_id,
        asset_id=asset_id,
        comment_id=comment_id,
        content=content,
    )
    db.add(n)
    return n


def notify_subscribers(
    db: Session,
    target_type: str,
    target_id: int,
    actor_id: Optional[int],
    type: str = "update",
    content: Optional[str] = None,
    project_id: Optional[int] = None,
    asset_id: Optional[int] = None,
) -> int:
    """给订阅了该目标的所有用户发通知，返回通知条数。"""
    subs = (
        db.query(Subscription)
        .filter(
            Subscription.target_type == target_type,
            Subscription.target_id == target_id,
        )
        .all()
    )
    count = 0
    for s in subs:
        if add_notification(
            db,
            s.user_id,
            type,
            actor_id=actor_id,
            project_id=project_id,
            asset_id=asset_id,
            content=content,
        ):
            count += 1
    return count


def subscriber_ids(db: Session, target_type: str, target_id: int) -> List[int]:
    """返回订阅了该目标的所有用户 id。"""
    return [
        s.user_id
        for s in db.query(Subscription)
        .filter(
            Subscription.target_type == target_type,
            Subscription.target_id == target_id,
        )
        .all()
    ]


def extract_mentions(db: Session, content: str, exclude_user_id: Optional[int] = None) -> List[User]:
    """从评论内容里解析被 @ 的用户（按昵称或用户名匹配）。"""
    if "@" not in content:
        return []
    users = db.query(User).filter(User.status == "active").all()
    mentioned: List[User] = []
    for u in users:
        if exclude_user_id is not None and u.id == exclude_user_id:
            continue
        for token in {u.nickname, u.username}:
            if token and f"@{token}" in content:
                mentioned.append(u)
                break
    return mentioned


def notification_to_dict(n: Notification) -> dict:
    return {
        "id": n.id,
        "type": n.type,
        "is_read": n.is_read,
        "content": n.content,
        "project_id": n.project_id,
        "asset_id": n.asset_id,
        "comment_id": n.comment_id,
        "actor": (
            {
                "id": n.actor.id,
                "username": n.actor.username,
                "nickname": n.actor.nickname,
                "avatar": n.actor.avatar,
            }
            if n.actor
            else None
        ),
        "created_at": clock.fmt_dt(n.created_at),
    }
