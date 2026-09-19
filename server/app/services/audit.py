"""项目内的操作日志。

埋点方式：在各端点原有的 db.commit() 之前调用 record()。这里**只 db.add()**，
不 commit 也不 flush——跟着调用方的事务一起落库（和 notify / badges.sync 一个套路）。
这样端点后面抛异常回滚时，日志也一起回滚，不会留下没真正发生的记录。
"""

from typing import Optional

from sqlalchemy.orm import Session

from ..models import AuditLog, User

# 动作类型：机器可读，方便以后按类型过滤
ASSET_CREATE = "asset.create"
ASSET_UPDATE = "asset.update"
ASSET_MOVE = "asset.move"
ASSET_DELETE = "asset.delete"
ASSET_RESTORE = "asset.restore"
ASSET_PURGE = "asset.purge"
VERSION_UPLOAD = "version.upload"
VERSION_REPLACE = "version.replace"
VERSION_THUMBNAIL = "version.thumbnail"
VERSION_ROLLBACK = "version.rollback"
VERSION_CHANGELOG = "version.changelog"
VERSION_DELETE = "version.delete"
FOLDER_CREATE = "folder.create"
FOLDER_UPDATE = "folder.update"
FOLDER_DELETE = "folder.delete"
CATEGORY_CREATE = "category.create"
CATEGORY_UPDATE = "category.update"
CATEGORY_DELETE = "category.delete"
MEMBER_INVITE = "member.invite"
MEMBER_REMOVE = "member.remove"
MEMBER_ACCEPT = "member.accept"
MEMBER_DECLINE = "member.decline"
PROJECT_CREATE = "project.create"
PROJECT_UPDATE = "project.update"
PROJECT_DELETE = "project.delete"


def record(db: Session, project_id: Optional[int], user: Optional[User], action: str, detail: str) -> None:
    """往当前事务里加一条日志（不 commit）。"""
    if project_id is None or user is None:
        return
    db.add(
        AuditLog(
            project_id=project_id,
            user_id=user.id,
            action=action,
            detail=detail,
        )
    )
