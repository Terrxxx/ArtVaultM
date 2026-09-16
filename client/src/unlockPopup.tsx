import { notification } from 'antd'
import type { Badge } from './types'

/**
 * 成就解锁弹窗。
 *
 * 批量上传时一次请求可能解锁好几个成就，攒一小会儿合并成一条弹窗，
 * 免得好几条通知叠在屏幕右侧。
 */
const MERGE_MS = 300

let pending: Badge[] = []
let timer: number | undefined

function flush() {
  timer = undefined
  const badges = pending
  pending = []
  if (badges.length === 0) return

  notification.open({
    message: badges.length === 1 ? `🏆 解锁成就：${badges[0].name}` : `🏆 解锁 ${badges.length} 个成就`,
    description: (
      <div style={{ display: 'grid', gap: 4 }}>
        {badges.map((b) => (
          <div key={b.key}>
            <span style={{ marginRight: 6 }}>{b.icon}</span>
            <span style={{ fontWeight: 600 }}>{b.name}</span>
            <span style={{ color: 'var(--av-text-3)', marginLeft: 6 }}>{b.desc}</span>
          </div>
        ))}
      </div>
    ),
    duration: 6,
  })
}

export function showUnlockedBadges(badges?: Badge[] | null) {
  if (!badges || badges.length === 0) return
  pending.push(...badges)
  if (timer === undefined) timer = window.setTimeout(flush, MERGE_MS)
}
