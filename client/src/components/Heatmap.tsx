import { Select, Space, Tooltip, Typography } from 'antd'
import type { ActivityItem } from '../types'

const CELL = 13
const GAP = 3
const ROWS = 7

// 0 次 + 4 档强度
const COLORS = ['var(--av-heat-0)', 'var(--av-heat-1)', 'var(--av-heat-2)', 'var(--av-heat-3)', 'var(--av-heat-4)']

/** 「最近一年」的哨兵值（滚动 12 个月），其余值为具体年份 */
export const RECENT = 'recent'

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

/** 计算展示区间；「最近一年」是滚动 53 周，具体年份是自然年 */
function rangeOf(year: string | number): { start: Date; end: Date } {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  if (year === RECENT) {
    return { start: new Date(today.getTime() - 364 * 86400000), end: today }
  }

  const y = Number(year)
  return { start: new Date(y, 0, 1), end: new Date(y, 11, 31) }
}

function buildCells(days: ActivityItem[], year: string | number) {
  const counts = new Map(days.map((d) => [d.date, d.count]))
  const { start, end } = rangeOf(year)

  // 向前补到周日、向后补到周六，保证每列是完整的一周
  const gridStart = new Date(start)
  gridStart.setDate(gridStart.getDate() - gridStart.getDay())
  const gridEnd = new Date(end)
  gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay()))

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const cells: { date: string; count: number; inRange: boolean; future: boolean }[] = []
  const cursor = new Date(gridStart)
  while (cursor <= gridEnd) {
    const key = fmt(cursor)
    cells.push({
      date: key,
      count: counts.get(key) || 0,
      inRange: cursor >= start && cursor <= end,
      future: cursor > today,
    })
    cursor.setDate(cursor.getDate() + 1)
  }
  return cells
}

interface Props {
  days: ActivityItem[]
  years: number[]
  value: string | number
  onChange: (value: string | number) => void
  selectedDate?: string | null
  onSelectDay?: (date: string) => void
  loading?: boolean
}

export default function Heatmap({
  days,
  years,
  value,
  onChange,
  selectedDate,
  onSelectDay,
  loading,
}: Props) {
  const cells = buildCells(days, value)
  const total = days.reduce((sum, d) => sum + d.count, 0)

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
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
          {cells.map((c) => {
            const selected = selectedDate === c.date
            return (
              <Tooltip key={c.date} title={`${c.date}　${c.count} 次更新`}>
                <div
                  onClick={() => c.inRange && onSelectDay?.(c.date)}
                  style={{
                    width: CELL,
                    height: CELL,
                    borderRadius: 2,
                    background: c.future || !c.inRange ? 'transparent' : COLORS[level(c.count)],
                    outline: selected ? '2px solid var(--av-primary)' : 'none',
                    outlineOffset: 1,
                    cursor: c.inRange ? 'pointer' : 'default',
                  }}
                />
              </Tooltip>
            )
          })}
        </div>

        <Space direction="vertical" size={8} align="end">
          <Select
            size="small"
            style={{ width: 130 }}
            value={value}
            onChange={onChange}
            options={[
              { value: RECENT, label: '最近一年' },
              ...years.map((y) => ({ value: y, label: `${y} 年` })),
            ]}
          />
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
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            共 {total} 次更新
          </Typography.Text>
        </Space>
      </div>
    </div>
  )
}
