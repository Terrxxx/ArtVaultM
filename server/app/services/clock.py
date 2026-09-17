"""时间口径：以服务器时区为准，并且把时区信息一起发给客户端。

库里存的是 naive UTC（见 models 里各个 default=datetime.utcnow），这里负责三件事：

- 出口 `fmt_dt`：换算成服务器本地时间，并带上偏移（`2026-09-16T18:33:00-04:00`），
  客户端拿到后按访客自己的时区渲染；
- 出口 `fmt_day`：只要本地日期；
- 入口 `to_utc` / `local_midnight`：把「本地某一天」换算回 UTC 边界，供按日期查库用
  （热力图分格、更新日志「看某一天」都按服务器本地日期切）。

Windows 上拿不到历史夏令时规则，所以偏移在进程启动时取一次——改了系统时区要重启后端。
"""

from datetime import date, datetime, timedelta, timezone
from typing import Optional

_OFFSET = datetime.now().astimezone().utcoffset() or timedelta(0)
LOCAL_TZ = timezone(_OFFSET)

DAY_FMT = "%Y-%m-%d"


def to_local(dt: Optional[datetime]) -> Optional[datetime]:
    """naive 的按 UTC 解释，换成服务器本地时间。"""
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(LOCAL_TZ)


def to_utc(naive_local: Optional[datetime]) -> Optional[datetime]:
    """本地墙上时间 → naive UTC，用于和库里的值比较。"""
    if naive_local is None:
        return None
    return naive_local - _OFFSET


def now() -> datetime:
    """当前时刻（本地 aware）。"""
    return datetime.now(LOCAL_TZ)


def now_utc() -> datetime:
    """当前时刻的 naive UTC，和库里存的值同口径。"""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def today() -> date:
    return now().date()


def local_midnight(day: date) -> datetime:
    """本地某天零点对应的 naive UTC 时刻。"""
    return to_utc(datetime(day.year, day.month, day.day))


def fmt_dt(dt: Optional[datetime]) -> Optional[str]:
    """带偏移的本地 ISO，例如 2026-09-16T18:33:00-04:00。

    时区信息跟着值一起发给客户端，前端按访客自己的时区换算显示。
    不带微秒（ISO 里 6 位小数在部分浏览器上解析不可靠）。
    """
    local = to_local(dt)
    if local is None:
        return None
    total = int((local.utcoffset() or timedelta(0)).total_seconds())
    sign = "-" if total < 0 else "+"
    total = abs(total)
    offset = f"{sign}{total // 3600:02d}:{total % 3600 // 60:02d}"
    return f"{local.strftime('%Y-%m-%dT%H:%M:%S')}{offset}"


def fmt_day(dt: Optional[datetime]) -> Optional[str]:
    """只要本地日期部分。"""
    local = to_local(dt)
    return local.strftime(DAY_FMT) if local else None


def sqlite_day_mods() -> tuple:
    """给 sqlite 的 date(col, ...) 用：把 UTC 时间戳挪成本地日期。

    注意 sqlite 不认 '-4:00' 这种整体偏移（会返回 NULL），必须拆成
    hours / minutes 两个修饰符。
    """
    seconds = int(_OFFSET.total_seconds())
    sign = "-" if seconds < 0 else "+"
    seconds = abs(seconds)
    return (f"{sign}{seconds // 3600} hours", f"{sign}{seconds % 3600 // 60} minutes")
