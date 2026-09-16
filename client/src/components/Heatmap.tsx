import { Select, Space, Tooltip, Typography } from 'antd'
import type { ActivityItem } from '../types'

// 尺寸与 github.com 贡献图一致：10px 格子、3px 间距、2px 圆角
const CELL = 10
const GAP = 3
const ROWS = 7
const RADIUS = 2
// 月份标签那一行的高度，星期标签列要按它下移才能和格子对齐
const MONTH_ROW = 15

// 0 次 + 4 档强度
const COLORS = ['var(--av-heat-0)', 'var(--av-heat-1)', 'var(--av-heat-2)', 'var(--av-heat-3)', 'var(--av-heat-4)']

// 每格描一圈极淡的边，让相邻格子之间有缝隙感（和 GitHub 贡献图一致）
const CELL_EDGE = 'inset 0 0 0 1px var(--av-heat-border)'

// 周日为一周之首；和 GitHub 一样只标周一/周三/周五
const WEEKDAY_LABELS = ['', '一', '', '三', '', '五', '']
const MONTH_LABELS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']

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

/** 每列（一周）上方要不要写月份：这一列的第一天跨月了就写 */
function monthLabelsOf(cells: { date: string }[]): (string | null)[] {
  const labels: (string | null)[] = []
  for (let i = 0; i < cells.length; i += ROWS) {
    const d = new Date(cells[i].date)
    const prev = i >= ROWS ? new Date(cells[i - ROWS].date) : null
    labels.push(!prev || prev.getMonth() !== d.getMonth() ? MONTH_LABELS[d.getMonth()] : null)
  }
  return labels
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
  const monthLabels = monthLabelsOf(cells)
  const total = days.reduce((sum, d) => sum + d.count, 0)

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 16,
        flexWrap: 'wrap',
      }}
    >
      {/* 图区自带一层底（暗色下是 #0d1117），空格子才有稳定的底色衬托 */}
      <div
        style={{
          overflowX: 'auto',
          background: 'var(--av-heat-canvas)',
          borderRadius: 6,
          padding: 8,
          opacity: loading ? 0.4 : 1,
        }}
      >
        <div style={{ display: 'flex', gap: 4 }}>
          {/* 星期标签：只标一/三/五，和格子逐行对齐 */}
          <div
            style={{
              display: 'grid',
              gridTemplateRows: `repeat(${ROWS}, ${CELL}px)`,
              gap: GAP,
              paddingTop: MONTH_ROW,
            }}
          >
            {WEEKDAY_LABELS.map((label, i) => (
              <Typography.Text
                key={i}
                type="secondary"
                style={{ fontSize: 9, lineHeight: `${CELL}px` }}
              >
                {label}
              </Typography.Text>
            ))}
          </div>

          <div>
            {/* 月份标签：和格子同一套列宽，靠文字溢出显示，天然对齐 */}
            <div
              style={{
                display: 'grid',
                gridAutoFlow: 'column',
                gridAutoColumns: `${CELL}px`,
                gap: GAP,
                height: MONTH_ROW,
              }}
            >
              {monthLabels.map((label, i) => (
                <Typography.Text
                  key={i}
                  type="secondary"
                  style={{ fontSize: 10, lineHeight: 1, whiteSpace: 'nowrap' }}
                >
                  {label || ''}
                </Typography.Text>
              ))}
            </div>

            <div
              style={{
                display: 'grid',
                gridAutoFlow: 'column',
                gridTemplateRows: `repeat(${ROWS}, ${CELL}px)`,
                gridAutoColumns: `${CELL}px`,
                gap: GAP,
              }}
            >
              {cells.map((c) => {
                const selected = selectedDate === c.date
                const blank = c.future || !c.inRange
                return (
                  <Tooltip key={c.date} title={`${c.date}　${c.count} 次更新`}>
                    <div
                      onClick={() => c.inRange && onSelectDay?.(c.date)}
                      style={{
                        width: CELL,
                        height: CELL,
                        borderRadius: RADIUS,
                        background: blank ? 'transparent' : COLORS[level(c.count)],
                        boxShadow: blank ? undefined : CELL_EDGE,
                        outline: selected ? '2px solid var(--av-primary)' : undefined,
                        outlineOffset: 1,
                        cursor: c.inRange ? 'pointer' : 'default',
                      }}
                    />
                  </Tooltip>
                )
              })}
            </div>
          </div>
        </div>
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
        <Space size={4} align="center">
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            少
          </Typography.Text>
          {COLORS.map((c) => (
            <div
              key={c}
              style={{
                width: CELL,
                height: CELL,
                borderRadius: RADIUS,
                background: c,
                boxShadow: CELL_EDGE,
              }}
            />
          ))}
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            多
          </Typography.Text>
        </Space>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          共 {total} 次更新
        </Typography.Text>
      </Space>
    </div>
  )
}
