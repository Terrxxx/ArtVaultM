import { Avatar, Empty, List, Segmented, Space, Tag, Typography } from 'antd'
import { UserOutlined } from '@ant-design/icons'
import { Link } from 'react-router-dom'
import { userPath } from '../api'
import type { LeaderboardItem } from '../types'

/** 可选的时间窗口 */
export const RANK_WINDOWS = [
  { label: '7 天', value: 7 },
  { label: '30 天', value: 30 },
  { label: '365 天', value: 365 },
]

const MEDAL = ['#f5a623', '#b8c2cc', '#cd7f32']

interface Props {
  items: LeaderboardItem[]
  days: number
  onDaysChange: (days: number) => void
  loading?: boolean
  emptyText?: string
}

export default function Leaderboard({
  items,
  days,
  onDaysChange,
  loading,
  emptyText = '这段时间还没有更新',
}: Props) {
  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <Segmented value={days} onChange={(v) => onDaysChange(Number(v))} options={RANK_WINDOWS} />
      </div>

      <List
        loading={loading}
        dataSource={items}
        locale={{ emptyText: <Empty description={emptyText} image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
        renderItem={(it, index) => (
          <List.Item style={{ padding: '8px 0' }}>
            <Space size={10} align="center" style={{ width: '100%' }}>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  fontSize: 12,
                  fontWeight: 600,
                  color: index < 3 ? '#fff' : '#888',
                  background: index < 3 ? MEDAL[index] : '#f0f0f0',
                  flexShrink: 0,
                }}
              >
                {index + 1}
              </span>
              <Link to={userPath(it.user)} style={{ flex: 1, minWidth: 0 }}>
                <Space size={8} align="center">
                  <Avatar size="small" icon={<UserOutlined />} src={it.user.avatar_url || undefined} />
                  <Typography.Text ellipsis>{it.user.nickname || it.user.username}</Typography.Text>
                </Space>
              </Link>
              <Tag color="blue">{it.count} 次更新</Tag>
            </Space>
          </List.Item>
        )}
      />
    </div>
  )
}
