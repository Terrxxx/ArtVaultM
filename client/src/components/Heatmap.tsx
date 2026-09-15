import { Tooltip, Typography } from 'antd'
import type { ActivityItem } from '../types'

const CELL = 12
const GAP = 3
const ROWS = 7

// 由浅到深的 5 档（0 次 + 4 档强度）
const COLORS = ['#ebedf0', '#d9d5f5', '#b3a8ea', '#8a79dd', '#6c5ce7']

function level(count: number): number {
  if (count <= 0) return 0
  if (count === 1) return 1
  if (count <= 3) return 2
  if (count <= 6) return 3
  return 4
}

function fmt(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 把「按天的活跃度」铺成 GitHub 那样的周列网格 */
function buildCells(items: ActivityItem[], weeks: number) {
  const counts = new Map(items.map((i) => [i.date, i.count]))
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // 让最后一列是完整的一周（到周六），看起来更规整
  const end = new Date(today)
  end.setDate(end.getDate() + (6 - end.getDay()))
  const start = new Date(end)
  start.setDate(start.getDate() - (weeks * ROWS - 1))

  const cells: { date: string; count: number; future: boolean }[] = []
  for (let i = 0; i < weeks * ROWS; i++) {
    const d = new Date(start)
    d.setDate(d.getDate() + i)
    const key = fmt(d)
    cells.push({ date: key, count: counts.get(key) || 0, future: d > today })
  }
  return cells
}

interface Props {
  items: ActivityItem[]
  /** 展示最近多少周，默认半年 */
  weeks?: number
  loading?: boolean
}

export default function Heatmap({ items, weeks = 26, loading }: Props) {
  const cells = buildCells(items, weeks)
  const total = items.reduce((sum, i) => sum + i.count, 0)

  return (
    <div>
      <div
        style={{
          display: 'grid',
          gridAutoFlow: 'column',
          gridTemplateRows: `repeat(${ROWS}, ${CELL}px)`,
          gridAutoColumns: `${CELL}px`,
          gap: GAP,
          overflowX: 'auto',
          paddingBottom: 4,
          opacity: loading ? 0.4 : 1,
        }}
      >
        {cells.map((c) => (
          <Tooltip key={c.date} title={`${c.date}　${c.count} 次更新`}>
            <div
              style={{
                width: CELL,
                height: CELL,
                borderRadius: 2,
                background: c.future ? 'transparent' : COLORS[level(c.count)],
              }}
            />
          </Tooltip>
        ))}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 8,
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          近 {weeks} 周共 {total} 次更新
        </Typography.Text>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            少
          </Typography.Text>
          {COLORS.map((c) => (
            <div key={c} style={{ width: CELL, height: CELL, borderRadius: 2, background: c }} />
          ))}
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            多
          </Typography.Text>
        </div>
      </div>
    </div>
  )
}
