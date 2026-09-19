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


def subtree_sizes(folder: Folder) -> tuple:
    """返回 (大小, 占用空间)，都覆盖整棵子树；回收站里的资产不算。

    - 大小：子树里所有版本的文件大小之和（同一份文件被两个版本共用就算两次）
    - 占用空间：按 file_path 去重后的实际占用（哈希去重、回滚复用只算一份）

    缩略图/封面不计（库里没存它们的大小），所以数字比磁盘实际占用略小。
    """
    total = 0
    files = set()
    for node in collect_subtree(folder):
        for asset in node.assets:
            if asset.deleted_at is not None:
                continue
            for version in asset.versions:
                size = version.file_size or 0
                total += size
                if version.file_path:
                    files.add((version.file_path, size))
    return total, sum(size for _, size in files)
