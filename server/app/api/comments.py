from typing import List, Optional
import re

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..models import Asset, Comment, User
from ..schemas import CommentCreate
from ..serializers import user_brief
from ..services import notify
from .deps import ensure_project_access, get_current_user

router = APIRouter()

# 正文里写 @v1 就表示这条评论指向 v1；可以同时写多个
VERSION_REF = re.compile(r"@v(\d+)")


def parse_version_refs(content: str) -> List[int]:
    """从评论正文里解析出被 @ 到的版本号，去重并按从小到大排序。"""
    return sorted({int(n) for n in VERSION_REF.findall(content or "")})


def comment_to_dict(c: Comment) -> dict:
    return {
        "id": c.id,
        "asset_id": c.asset_id,
        "parent_id": c.parent_id,
        "versions": parse_version_refs(c.content),
        "content": c.content,
        # 用 user_brief：里面才有 avatar_url（前端要拿它显示头像）
        "user": user_brief(c.user),
        "created_at": c.created_at.isoformat() if c.created_at else None,
    }


@router.get("/assets/{asset_id}/comments")
def list_comments(
    asset_id: int,
    version: Optional[int] = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    asset = db.get(Asset, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="资产不存在")
    ensure_project_access(db, asset.project_id, user)

    comments = (
        db.query(Comment)
        .options(joinedload(Comment.user))
        .filter(Comment.asset_id == asset_id)
        .order_by(Comment.created_at)
        .all()
    )
    # 传入 version（版本号）则只看 @ 到该版本的评论；不传则返回全部
    if version is not None:
        comments = [c for c in comments if version in parse_version_refs(c.content)]
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

    parent = None
    if payload.parent_id is not None:
        parent = db.get(Comment, payload.parent_id)
        if parent is None or parent.asset_id != asset_id:
            raise HTTPException(status_code=400, detail="回复的评论不存在")

    comment = Comment(
        asset_id=asset_id,
        user_id=user.id,
        parent_id=payload.parent_id,
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

    # 1) 被 @ 提及的人（@v1 这种版本引用不算提及）
    mention_text = VERSION_REF.sub("", payload.content)
    for mentioned in notify.extract_mentions(db, mention_text, exclude_user_id=user.id):
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
