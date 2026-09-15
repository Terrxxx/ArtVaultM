from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..models import Asset, AssetVersion, Comment, User
from ..schemas import CommentCreate
from ..services import notify
from .deps import ensure_project_access, get_current_user

router = APIRouter()


def comment_to_dict(c: Comment) -> dict:
    return {
        "id": c.id,
        "asset_id": c.asset_id,
        "parent_id": c.parent_id,
        "version_id": c.version_id,
        "version": c.version.version if c.version else None,
        "content": c.content,
        "user": {
            "id": c.user.id,
            "username": c.user.username,
            "nickname": c.user.nickname,
            "avatar": c.user.avatar,
        },
        "created_at": c.created_at.isoformat() if c.created_at else None,
    }


@router.get("/assets/{asset_id}/comments")
def list_comments(
    asset_id: int,
    version_id: Optional[int] = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    asset = db.get(Asset, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="资产不存在")
    ensure_project_access(db, asset.project_id, user)

    query = (
        db.query(Comment)
        .options(joinedload(Comment.user), joinedload(Comment.version))
        .filter(Comment.asset_id == asset_id)
    )
    # 传入 version_id 则只看该版本的评论；不传则返回全部
    if version_id is not None:
        query = query.filter(Comment.version_id == version_id)

    comments = query.order_by(Comment.created_at).all()
    return [comment_to_dict(c) for c in comments]


@router.post("/assets/{asset_id}/comments")
def add_comment(
    asset_id: int,
    payload: CommentCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    asset = db.get(Asset, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="资产不存在")
    ensure_project_access(db, asset.project_id, user)

    version_id = payload.version_id
    parent = None

    if payload.parent_id is not None:
        parent = db.get(Comment, payload.parent_id)
        if parent is None or parent.asset_id != asset_id:
            raise HTTPException(status_code=400, detail="回复的评论不存在")
        # 回复默认跟随被回复评论所属的版本
        if version_id is None:
            version_id = parent.version_id

    if version_id is not None:
        version = db.get(AssetVersion, version_id)
        if version is None or version.asset_id != asset_id:
            raise HTTPException(status_code=400, detail="版本不存在或不属于该资产")

    comment = Comment(
        asset_id=asset_id,
        user_id=user.id,
        parent_id=payload.parent_id,
        version_id=version_id,
        content=payload.content,
    )
    db.add(comment)
    db.flush()

    notified = set()

    def _notify(user_id: int, ntype: str, text: str) -> None:
        if user_id in notified:
            return
        if notify.add_notification(
            db,
            user_id,
            ntype,
            actor_id=user.id,
            project_id=asset.project_id,
            asset_id=asset_id,
            comment_id=comment.id,
            content=text,
        ):
            notified.add(user_id)

    # 1) 被 @ 提及的人
    for mentioned in notify.extract_mentions(db, payload.content, exclude_user_id=user.id):
        _notify(mentioned.id, "mention", f"在「{asset.name}」的评论中提到了你：{payload.content[:120]}")

    # 2) 被回复的评论作者
    if parent is not None:
        _notify(parent.user_id, "comment", f"回复了你在「{asset.name}」下的评论：{payload.content[:120]}")

    # 3) 资产作者
    _notify(asset.created_by, "comment", f"「{asset.name}」收到新评论：{payload.content[:120]}")

    # 4) 订阅了该资产的用户
    for sub_user_id in notify.subscriber_ids(db, "asset", asset_id):
        _notify(sub_user_id, "comment", f"你订阅的「{asset.name}」有新评论：{payload.content[:120]}")

    db.commit()
    db.refresh(comment)
    return comment_to_dict(comment)


@router.delete("/comments/{comment_id}")
def delete_comment(
    comment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    comment = db.get(Comment, comment_id)
    if comment is None:
        raise HTTPException(status_code=404, detail="评论不存在")
    if user.role != "admin" and comment.user_id != user.id:
        raise HTTPException(status_code=403, detail="只能删除自己的评论")
    db.delete(comment)
    db.commit()
    return {"ok": True}
