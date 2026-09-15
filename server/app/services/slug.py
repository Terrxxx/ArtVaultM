import re

from pypinyin import lazy_pinyin


def slugify(name: str) -> str:
    """把项目名转成 URL 片段：中文转拼音、空格与符号转 -、统一小写。"""
    pinyin = "-".join(lazy_pinyin(name or ""))
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", pinyin).lower().strip("-")
    return slug or "project"
