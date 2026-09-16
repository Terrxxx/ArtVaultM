"""文件夹树的通用操作。

序列化（算子树统计）、权限判断（能不能删）、接口删除（自底向上删整棵子树）
都要用，所以单独放一处，避免各自写一份遍历。
"""

from ..models import Folder


def collect_subtree(folder: Folder) -> list:
    """该文件夹及其所有子孙文件夹（父在前），删除时按倒序处理。"""
    nodes = []
    stack = [folder]
    while stack:
        node = stack.pop()
        nodes.append(node)
        stack.extend(node.children)
    return nodes


def _alive(node: Folder) -> int:
    """这个文件夹里未进回收站的资产数。"""
    return sum(1 for a in node.assets if a.deleted_at is None)


def subtree_counts(folder: Folder) -> tuple:
    """返回 (子树内资产总数, 子树内子文件夹总数)，都包含整棵子树；回收站里的不算。"""
    assets = _alive(folder)
    folders = 0
    stack = list(folder.children)
    while stack:
        node = stack.pop()
        folders += 1
        assets += _alive(node)
        stack.extend(node.children)
    return assets, folders
