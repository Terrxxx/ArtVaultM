"""成就徽章：按已有的统计数据算出来，不额外建表。

全部由上传记录推导（资产数、版本数、被赞、被下载、提交时段、连续天数…），
所以新徽章就是加一条定义，历史数据自动补上。

解锁状态永远是**算**出来的；`user_badges` 只是「已提醒过」的账本，保证同一个
成就不会提醒第二次（哪怕它先解锁、后因删资产重新上锁、再解锁）。
"""

from datetime import datetime
from typing import List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models import (
    Asset,
    AssetVersion,
    Comment,
    DownloadLog,
    Folder,
    Like,
    Project,
    ProjectMember,
    User,
    UserBadge,
)
from . import clock, notify, trash

MB = 1024 * 1024


def _longest_streak(days: set) -> int:
    """最长连续提交天数。"""
    best = 0
    run = 0
    prev = None
    for d in sorted(days):
        run = run + 1 if prev and (d - prev).days == 1 else 1
        best = max(best, run)
        prev = d
    return best


def _count(db: Session, model, *filters) -> int:
    return db.query(func.count(model.id)).filter(*filters).scalar() or 0


def _gather(db: Session, user_id: int) -> dict:
    """把算徽章需要的数据一次性取出来。尽量一条聚合查询搞定一个信号。"""
    stats = {
        "asset_count": 0,
        "version_count": 0,
        "max_likes": 0,
        "total_likes": 0,
        "likers": 0,
        "downloads": 0,
        "downloaders": 0,
        "night": 0,
        "night3": 0,
        "early": 0,
        "weekend": 0,
        "new_year": 0,
        "streak": 0,
        "active_days": 0,
        "day_burst": 0,
        "days_since_first": None,
        "project_count": 0,
        "project_span": 0,
        "guest_upload": 0,
        "assets_with_desc": 0,
        "assets_with_tags": 0,
        "assets_with_cover": 0,
        "max_versions_on_asset": 0,
        "changelog_versions": 0,
        "formats": 0,
        "total_bytes": 0,
        "max_file_size": 0,
        "comments_received": 0,
        "comments_made": 0,
        "replies_made": 0,
        "self_comment": 0,
        "folders": 0,
        "members": 0,
        "profile_fields": 0,
        "account_days": 0,
    }

    user = db.get(User, user_id)
    if user is not None:
        stats["profile_fields"] = sum(
            1 for field in (user.nickname, user.avatar, user.github_url) if field
        )
        if user.created_at:
            stats["account_days"] = (datetime.utcnow() - user.created_at).days

    my_project_ids = [
        pid
        for (pid,) in db.query(Project.id).filter(Project.owner_id == user_id).all()
    ]
    stats["project_count"] = len(my_project_ids)
    if my_project_ids:
        stats["folders"] = _count(db, Folder, Folder.project_id.in_(my_project_ids))
        stats["members"] = _count(
            db,
            ProjectMember,
            ProjectMember.project_id.in_(my_project_ids),
            ProjectMember.status == "accepted",
        )

    stats["comments_made"] = _count(db, Comment, Comment.user_id == user_id)
    stats["replies_made"] = _count(
        db, Comment, Comment.user_id == user_id, Comment.parent_id.isnot(None)
    )

    assets = db.query(Asset).filter(Asset.created_by == user_id, trash.alive()).all()
    stats["asset_count"] = len(assets)
    if not assets:
        return stats

    asset_ids = [a.id for a in assets]
    stats["assets_with_desc"] = sum(1 for a in assets if (a.description or "").strip())
    stats["assets_with_tags"] = sum(1 for a in assets if a.tags)
    stats["assets_with_cover"] = sum(1 for a in assets if a.cover_thumbnail)
    stats["project_span"] = len({a.project_id for a in assets})

    project_ids = {a.project_id for a in assets}
    owners = dict(
        db.query(Project.id, Project.owner_id).filter(Project.id.in_(project_ids)).all()
    )
    stats["guest_upload"] = int(any(owners.get(a.project_id) != user_id for a in assets))

    like_counts = [
        count
        for (_, count) in db.query(Like.asset_id, func.count(Like.id))
        .filter(Like.asset_id.in_(asset_ids))
        .group_by(Like.asset_id)
        .all()
    ]
    stats["max_likes"] = max(like_counts, default=0)
    stats["total_likes"] = sum(like_counts)
    stats["likers"] = (
        db.query(func.count(func.distinct(Like.user_id)))
        .filter(Like.asset_id.in_(asset_ids))
        .scalar()
        or 0
    )

    commenters = [
        uid for (uid,) in db.query(Comment.user_id).filter(Comment.asset_id.in_(asset_ids))
    ]
    stats["comments_received"] = sum(1 for uid in commenters if uid != user_id)
    stats["self_comment"] = int(any(uid == user_id for uid in commenters))

    versions = (
        db.query(
            AssetVersion.id,
            AssetVersion.asset_id,
            AssetVersion.created_at,
            AssetVersion.file_size,
            AssetVersion.file_format,
            AssetVersion.changelog,
        )
        .filter(AssetVersion.asset_id.in_(asset_ids))
        .all()
    )
    stats["version_count"] = len(versions)
    if not versions:
        return stats

    per_asset: dict = {}
    per_day: dict = {}
    days = set()
    formats = set()
    earliest: Optional[datetime] = None
    total_bytes = 0
    max_file_size = 0
    changelog_versions = 0

    for v in versions:
        per_asset[v.asset_id] = per_asset.get(v.asset_id, 0) + 1
        if (v.changelog or "").strip():
            changelog_versions += 1
        size = v.file_size or 0
        total_bytes += size
        max_file_size = max(max_file_size, size)
        if v.file_format:
            formats.add(v.file_format.lower())

        created = v.created_at
        if not created:
            continue
        day = created.date()
        days.add(day)
        per_day[day] = per_day.get(day, 0) + 1
        hour = created.hour
        if 0 <= hour < 5:
            stats["night"] = 1
        if hour == 3:
            stats["night3"] = 1
        if 5 <= hour < 8:
            stats["early"] = 1
        if created.weekday() >= 5:
            stats["weekend"] = 1
        if (created.month, created.day) == (1, 1):
            stats["new_year"] = 1
        if earliest is None or created < earliest:
            earliest = created

    stats["changelog_versions"] = changelog_versions
    stats["formats"] = len(formats)
    stats["total_bytes"] = total_bytes
    stats["max_file_size"] = max_file_size
    stats["max_versions_on_asset"] = max(per_asset.values(), default=0)
    stats["streak"] = _longest_streak(days)
    stats["active_days"] = len(days)
    stats["day_burst"] = max(per_day.values(), default=0)
    if earliest:
        stats["days_since_first"] = (datetime.utcnow() - earliest).days

    version_ids = [v.id for v in versions]
    stats["downloads"] = _count(
        db, DownloadLog, DownloadLog.asset_version_id.in_(version_ids)
    )
    stats["downloaders"] = (
        db.query(func.count(func.distinct(DownloadLog.user_id)))
        .filter(DownloadLog.asset_version_id.in_(version_ids))
        .scalar()
        or 0
    )
    return stats


# (key, 名称, 图标, 达成条件文案, 目标值, 是否隐藏, 当前值取值函数)
# 顺序即展示顺序（已解锁的排前面，组内保持这里的先后）。
# 隐藏成就解锁前不出现在接口返回里，改 key 会让所有人重新提醒一次。
RULES = [
    # ---- 起手 ----
    ("first_asset", "初次执笔", "🖌️", "上传第一个资产", 1, False, lambda s: s["asset_count"]),
    ("ten_assets", "小有所成", "📦", "上传 10 个资产", 10, False, lambda s: s["asset_count"]),
    ("fifty_assets", "多产画师", "🏭", "上传 50 个资产", 50, False, lambda s: s["asset_count"]),
    ("hundred_assets", "百件大户", "🏛️", "上传 100 个资产", 100, False, lambda s: s["asset_count"]),
    ("project_maker", "项目缔造者", "🚩", "创建自己的项目", 1, False, lambda s: s["project_count"]),
    ("project_5", "五标齐发", "🎌", "创建 5 个项目", 5, False, lambda s: s["project_count"]),
    # ---- 版本 ----
    ("fifty_versions", "五十版", "✍️", "累计发布 50 个版本", 50, False, lambda s: s["version_count"]),
    ("hundred_versions", "百版老人", "📚", "累计发布 100 个版本", 100, False, lambda s: s["version_count"]),
    ("five_hundred_versions", "版本洪水", "🌊", "累计发布 500 个版本", 500, False, lambda s: s["version_count"]),
    ("asset_10_versions", "回头客", "🔁", "给同一个资产发布 10 个版本", 10, False, lambda s: s["max_versions_on_asset"]),
    ("asset_30_versions", "打磨狂人", "🧬", "给同一个资产发布 30 个版本", 30, True, lambda s: s["max_versions_on_asset"]),
    ("version_changelog_20", "记录癖", "📓", "给 20 个版本写过更新说明", 20, False, lambda s: s["changelog_versions"]),
    # ---- 资产细节 ----
    ("asset_with_desc_10", "言之有物", "📝", "给 10 个资产写描述", 10, False, lambda s: s["assets_with_desc"]),
    ("asset_with_tags_10", "标签党", "🏷️", "给 10 个资产打标签", 10, False, lambda s: s["assets_with_tags"]),
    ("cover_10", "有头有脸", "🖼️", "给 10 个资产设置封面", 10, False, lambda s: s["assets_with_cover"]),
    # ---- 人气 ----
    ("like_5", "第一次被喜欢", "💗", "单个资产被赞 5 次", 5, False, lambda s: s["max_likes"]),
    ("popular", "人气担当", "❤️", "单个资产被赞 20 次", 20, False, lambda s: s["max_likes"]),
    ("like_100", "明星资产", "🌟", "单个资产被赞 100 次", 100, False, lambda s: s["max_likes"]),
    ("total_likes_200", "两百赞", "💯", "累计获赞 200 次", 200, False, lambda s: s["total_likes"]),
    ("likers_10", "众口一词", "🗣️", "单个资产被 10 个不同的人点赞", 10, True, lambda s: s["likers"]),
    ("downloads_10", "有人下载", "📤", "资产被下载 10 次", 10, False, lambda s: s["downloads"]),
    ("downloads_500", "小手传开", "🧲", "资产被下载 500 次", 500, False, lambda s: s["downloads"]),
    ("downloaded", "万众期待", "📥", "资产被下载 1000 次", 1000, False, lambda s: s["downloads"]),
    ("downloaders_50", "五十人拿走", "🧑‍🤝‍🧑", "资产被 50 个不同的人下载", 50, False, lambda s: s["downloaders"]),
    # ---- 评论 ----
    ("comments_received_10", "有问必答", "💬", "收到 10 条别人的评论", 10, False, lambda s: s["comments_received"]),
    ("comments_made_10", "热心观众", "🎤", "发表 10 条评论", 10, False, lambda s: s["comments_made"]),
    ("replies_20", "接话王", "🪃", "回复别人的评论 20 次", 20, False, lambda s: s["replies_made"]),
    ("comment_self_asset", "自言自语", "🤖", "评论自己的资产", 1, True, lambda s: s["self_comment"]),
    # ---- 提交时段 ----
    ("night_owl", "夜猫子", "🌙", "在凌晨 0-5 点提交过版本", 1, False, lambda s: s["night"]),
    ("early_bird", "早起的鸟", "🐦", "在早上 5-8 点提交过版本", 1, False, lambda s: s["early"]),
    ("midnight_3", "凌晨三点整", "🕒", "在凌晨 3 点提交过版本", 1, True, lambda s: s["night3"]),
    ("weekend_upload", "周末战士", "🛋️", "在周末提交过版本", 1, True, lambda s: s["weekend"]),
    ("new_year_upload", "跨年上传", "🎆", "在 1 月 1 日提交过版本", 1, True, lambda s: s["new_year"]),
    # ---- 坚持 ----
    ("streak_3", "三日不辍", "📅", "连续 3 天提交版本", 3, False, lambda s: s["streak"]),
    ("week_streak", "周更狂魔", "🔥", "连续 7 天提交版本", 7, False, lambda s: s["streak"]),
    ("streak_30", "月度劳模", "🗓️", "连续 30 天提交版本", 30, False, lambda s: s["streak"]),
    ("streak_100", "百日筑基", "🧱", "连续 100 天提交版本", 100, True, lambda s: s["streak"]),
    ("active_days_100", "出勤百天", "📆", "累计 100 天有提交", 100, False, lambda s: s["active_days"]),
    ("day_burst_20", "爆发日", "💥", "单日提交 20 个版本", 20, True, lambda s: s["day_burst"]),
    # ---- 文件 ----
    ("formats_5", "格式收藏家", "🎨", "用过 5 种文件格式", 5, False, lambda s: s["formats"]),
    ("size_1gb", "一个 G", "💾", "累计上传超过 1GB", 1024 * MB, False, lambda s: s["total_bytes"]),
    ("size_10gb", "数据搬运工", "🗄️", "累计上传超过 10GB", 10 * 1024 * MB, False, lambda s: s["total_bytes"]),
    ("big_file_200", "大块头", "🐘", "上传过 200MB 以上的单个版本", 200 * MB, True, lambda s: s["max_file_size"]),
    # ---- 协作 ----
    ("guest_upload", "客座设计", "🎭", "在别人的项目里上传资产", 1, False, lambda s: s["guest_upload"]),
    ("projects_10", "十项目巡演", "🧭", "在 10 个不同项目里上传过资产", 10, False, lambda s: s["project_span"]),
    ("members_10", "人多势众", "👥", "有 10 位成员加入自己的项目", 10, False, lambda s: s["members"]),
    ("folders_10", "归类强迫症", "🗃️", "在自己的项目里建 10 个文件夹", 10, False, lambda s: s["folders"]),
    # ---- 资历 ----
    ("profile_complete", "门面齐整", "🪪", "昵称、头像、GitHub 链接都填好", 3, False, lambda s: s["profile_fields"]),
    ("veteran", "老资历", "🕰️", "入行满一年", 365, False, lambda s: s["days_since_first"] or 0),
    ("account_2y", "两年陈酿", "🍷", "账号满两年", 730, False, lambda s: s["account_days"]),
]


def compute(db: Session, user_id: int) -> List[dict]:
    """该用户当前的成就列表。隐藏且未解锁的不返回。"""
    stats = _gather(db, user_id)
    # 解锁时间的来源是账本：记的是「系统第一次发现它解锁」的时刻
    unlocked_at = {
        row.badge_key: row.unlocked_at
        for row in db.query(UserBadge).filter(UserBadge.user_id == user_id).all()
    }
    items = []
    for order, (key, name, icon, desc, target, hidden, value_of) in enumerate(RULES):
        value = int(value_of(stats))
        unlocked = value >= target
        if hidden and not unlocked:
            continue
        stamp = unlocked_at.get(key)
        items.append(
            (
                order,
                {
                    "key": key,
                    "name": name,
                    "icon": icon,
                    "desc": desc,
                    "target": target,
                    "value": min(value, target),
                    "unlocked": unlocked,
                    "hidden": hidden,
                    "unlocked_at": clock.fmt_dt(stamp),
                },
            )
        )
    # 已解锁的排前面，组内保持 RULES 里的顺序
    items.sort(key=lambda pair: (not pair[1]["unlocked"], pair[0]))
    return [item for _, item in items]


def sync(db: Session, user_id: int) -> List[dict]:
    """检查某个用户的成就，把新解锁的记进账本并各发一条站内消息。

    返回本次新解锁的成就（供接口回传给前端弹提示）。**不 commit**，
    交给调用端点原有的 db.commit()；`login` 那种没有写入的端点要自己 commit。

    先 flush：sessionmaker 关掉了 autoflush，不 flush 的话本请求里刚 db.add()
    的版本 / 点赞 / 下载记录对下面的查询不可见，成就会漏判。
    """
    db.flush()
    unlocked = [b for b in compute(db, user_id) if b["unlocked"]]
    known = {
        row.badge_key
        for row in db.query(UserBadge).filter(UserBadge.user_id == user_id).all()
    }
    fresh = [b for b in unlocked if b["key"] not in known]
    for badge in fresh:
        db.add(UserBadge(user_id=user_id, badge_key=badge["key"]))
        notify.add_notification(
            db,
            user_id,
            "badge",
            content=f'解锁成就「{badge["name"]}」{badge["icon"]} {badge["desc"]}',
        )
    return fresh


def sync_many(db: Session, *user_ids: Optional[int]) -> dict:
    """一次检查多个用户（如点赞者 + 资产所有者），同一个用户只算一次。

    返回 {user_id: 新解锁的成就}，调用方取自己那一条回传前端。
    """
    result = {}
    for user_id in dict.fromkeys(user_ids):
        if user_id is None:
            continue
        result[user_id] = sync(db, user_id)
    return result
