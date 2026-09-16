import { Avatar, Empty, Segmented, Typography } from 'antd'
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

// 前三名的条色（金银铜），其余用主题色
const TOP_COLORS = ['#f5a623', '#b8c2cc', '#cd7f32']
const BAR_COLOR = 'var(--av-primary)'

interface Props {
  items: LeaderboardItem[]
  days: number
  onDaysChange: (days: number) => void
  loading?: boolean
  /** 最多列几个人 */
  limit?: number
  emptyText?: string
}

/** 名次列表：序号 + 头像 + 昵称 + 更新量，下面一条细进度条 */
export default function Leaderboard({
  items,
  days,
  onDaysChange,
  loading,
  limit = 8,
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
        style={{ marginBottom: 12 }}
      />

      {shown.length === 0 ? (
        <Empty description={emptyText} image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {shown.map((it, index) => {
            const name = it.user.nickname || it.user.username
            const color = TOP_COLORS[index] || BAR_COLOR
            // 最低留一点宽度，免得 0 次的看起来像没画出来
            const width = `${Math.max(Math.round((it.count / max) * 100), 4)}%`
            return (
              <div
                key={it.user.id}
                onClick={() => navigate(userPath(it.user))}
                title={`${name} · ${it.count} 次更新`}
                style={{ cursor: 'pointer' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Typography.Text
                    style={{ width: 16, textAlign: 'right', fontSize: 12, fontWeight: 600, color }}
                  >
                    {index + 1}
                  </Typography.Text>
                  <Avatar size={22} icon={<UserOutlined />} src={it.user.avatar_url || undefined} />
                  <Typography.Text
                    ellipsis
                    style={{ flex: 1, minWidth: 0, fontSize: 13 }}
                  >
                    {name}
                  </Typography.Text>
                  <Typography.Text style={{ fontSize: 12, fontWeight: 600 }}>
                    {it.count}
                  </Typography.Text>
                </div>
                <div
                  style={{
                    height: 4,
                    borderRadius: 2,
                    background: 'var(--av-surface)',
                    marginTop: 6,
                    marginLeft: 24,
                    overflow: 'hidden',
                  }}
                >
                  <div style={{ width, height: '100%', borderRadius: 2, background: color }} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
