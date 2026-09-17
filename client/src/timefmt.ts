/**
 * 时间展示。
 *
 * 服务端发来的是**带时区偏移**的 ISO（如 2026-09-16T18:33:00-04:00），时区跟着值走，
 * 这里统一按访客自己的时区换算成可读文本。所有时间格式化都走这里，
 * 别在组件里散落 new Date(...)。
 */

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function parse(v?: string | null): Date | null {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

/** 2026/9/16 18:33 */
export function fmtDateTime(v?: string | null): string {
  const d = parse(v)
  return d ? d.toLocaleString() : (v ?? '')
}

/** 2026/9/16 */
export function fmtDay(v?: string | null): string {
  const d = parse(v)
  return d ? d.toLocaleDateString() : (v ?? '')
}

/** 9月16日 18:33 */
export function fmtShort(v?: string | null): string {
  const d = parse(v)
  if (!d) return v ?? ''
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
