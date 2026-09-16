"""权限判断的唯一出处。

- 接口层用它做校验（ensure_project_access / ensure_project_editor 内部调用）
- 序列化层用它算能力字段（project.can_edit、asset.can_edit、folder.can_delete …），
  前端只读这些字段、不再自己推算，避免两边规则漂移

全部只依赖已加载的 ORM 关系（project.members / asset.project / folder.project），
不额外查库，所以放在 services 里、serializers 也能直接引用而不产生循环导入。
"""

from typing import Optional

from ..models import Asset, Folder, Project, User
from .folders import subtree_counts

MEMBER = "member"
ADMIN = "admin"
SUPER_ADMIN = "super_admin"


def is_super_admin(user: Optional[User]) -> bool:
    return bool(user) and user.role == SUPER_ADMIN


def is_admin_like(user: Optional[User]) -> bool:
    """管理员或高级管理员（可进入管理后台）。"""
    return bool(user) and user.role in (ADMIN, SUPER_ADMIN)


def is_accepted_member(project: Optional[Project], user_id: int) -> bool:
    """是否为项目的正式成员（受邀但未同意的 pending 不算）。"""
    if project is None:
        return False
    return any(
        m.user_id == user_id and m.status == "accepted" for m in project.members
    )


def can_edit_project(project: Optional[Project], user: Optional[User]) -> bool:
    """项目设置（改名/可见性/分类管理/成员/归档删除）：仅创建者，高级管理员例外。"""
    if user is None or project is None:
        return False
    return is_super_admin(user) or project.owner_id == user.id


def can_contribute(project: Optional[Project], user: Optional[User]) -> bool:
    """项目内容贡献：上传资产、整理文件夹、改资产、传版本。

    所有者 / 正式成员 / 高级管理员都可以。
    """
    if user is None or project is None:
        return False
    if is_super_admin(user) or project.owner_id == user.id:
        return True
    return is_accepted_member(project, user.id)


def can_edit_asset(asset: Optional[Asset], user: Optional[User]) -> bool:
    """资产内容（改资料、传新版本、换源、删历史版本）：项目可贡献者或资产创建者。"""
    if user is None or asset is None:
        return False
    return asset.created_by == user.id or can_contribute(asset.project, user)


def can_move_asset(asset: Optional[Asset], user: Optional[User]) -> bool:
    """把资产移到别的文件夹：项目所有者/高级管理员，或资产创建者本人。"""
    if user is None or asset is None:
        return False
    return asset.created_by == user.id or can_edit_project(asset.project, user)


def can_delete_asset(asset: Optional[Asset], user: Optional[User]) -> bool:
    """删除整个资产：只有资产创建者本人或高级管理员。"""
    if user is None or asset is None:
        return False
    return is_super_admin(user) or asset.created_by == user.id


def can_manage_trash(asset: Optional[Asset], user: Optional[User]) -> bool:
    """回收站里的恢复/彻底删除：资产创建者、高级管理员，或项目创建者。"""
    if user is None or asset is None:
        return False
    return can_delete_asset(asset, user) or can_edit_project(asset.project, user)


def can_delete_folder(folder: Optional[Folder], user: Optional[User]) -> bool:
    """删除文件夹（会连整个子树的资产一起删）。

    项目所有者/高级管理员随便删；普通成员只能在子树里没有资产时删。
    """
    if user is None or folder is None:
        return False
    if can_edit_project(folder.project, user):
        return True
    if not can_contribute(folder.project, user):
        return False
    assets, _ = subtree_counts(folder)
    return assets == 0
