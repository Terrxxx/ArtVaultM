import { Avatar, Empty, Segmented, Tooltip, Typography } from 'antd'
import { UserOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { userPath } from '../api'
import type { LeaderboardItem } from '../types'

/** 可选的时间窗口 */
export const RANK_WINDOWS = [
  { label: '7 天', value: 7 },
  { label: '30 天', value: 30 },
  { label: '365 天', value: 365 },
]

// 前三名的柱色（金银铜），其余用主题色
const TOP_COLORS = ['#f5a623', '#b8c2cc', '#cd7f32']
const BAR_COLOR = 'var(--av-primary)'
const CHART_HEIGHT = 150
// 柱子区可用高度（上面要给数字标签留位置）
const BAR_AREA = CHART_HEIGHT - 26

interface Props {
  items: LeaderboardItem[]
  days: number
  onDaysChange: (days: number) => void
  loading?: boolean
  /** 最多画几根柱子 */
  limit?: number
  emptyText?: string
}

/** 竖向柱状排行：每人一根柱子，高度代表更新量 */
export default function Leaderboard({
  items,
  days,
  onDaysChange,
  loading,
  limit = 5,
  emptyText = '这段时间还没有更新',
}: Props) {
  const navigate = useNavigate()
  const shown = items.slice(0, limit)
  const max = Math.max(...shown.map((i) => i.count), 1)

  return (
    <div style={{ opacity: loading ? 0.5 : 1 }}>
      <Segmented
        block
        size="small"
        value={days}
        onChange={(v) => onDaysChange(Number(v))}
        options={RANK_WINDOWS}
        style={{ marginBottom: 16 }}
      />

      {shown.length === 0 ? (
        <Empty description={emptyText} image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: CHART_HEIGHT }}>
          {shown.map((it, index) => {
            const name = it.user.nickname || it.user.username
            // 用像素高度而不是百分比：flex 列布局里百分比高度会被拉伸
            const barHeight = Math.max(Math.round((it.count / max) * BAR_AREA), 6)
            return (
              <Tooltip key={it.user.id} title={`${name} · ${it.count} 次更新`}>
                <div
                  onClick={() => navigate(userPath(it.user))}
                  style={{
                    flex: 1,
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'flex-end',
                    alignItems: 'center',
                    gap: 4,
                    cursor: 'pointer',
                    minWidth: 0,
                  }}
                >
                  <Typography.Text style={{ fontSize: 12, fontWeight: 600 }}>
                    {it.count}
                  </Typography.Text>
                  <div
                    style={{
                      width: '100%',
                      height: barHeight,
                      flexShrink: 0,
                      background: TOP_COLORS[index] || BAR_COLOR,
                      borderRadius: '4px 4px 0 0',
                    }}
                  />
                </div>
              </Tooltip>
            )
          })}
        </div>
      )}

      {shown.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            {shown.map((it, index) => (
              <div
                key={it.user.id}
                onClick={() => navigate(userPath(it.user))}
                style={{
                  flex: 1,
                  minWidth: 0,
                  textAlign: 'center',
                  cursor: 'pointer',
                }}
              >
                <Avatar
                  size={22}
                  icon={<UserOutlined />}
                  src={it.user.avatar_url || undefined}
                  style={{ border: `2px solid ${TOP_COLORS[index] || 'var(--av-border)'}` }}
                />
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--av-text-2)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {it.user.nickname || it.user.username}
                </div>
              </div>
            ))}
          </div>
          <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 10 }}>
            共 {shown.length} 人上榜 · 点击柱子进入主页
          </Typography.Text>
        </>
      )}
    </div>
  )
}
