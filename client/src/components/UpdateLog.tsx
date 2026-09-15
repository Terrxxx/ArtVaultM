import { Avatar, Button, Empty, List, Space, Tag, Typography } from 'antd'
import { UserOutlined } from '@ant-design/icons'
import { Link } from 'react-router-dom'
import { userPath } from '../api'
import type { UpdateItem } from '../types'

function fmtTime(t?: string | null): string {
  if (!t) return ''
  const d = new Date(t)
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes(),
  ).padStart(2, '0')}`
}

interface Props {
  items: UpdateItem[]
  /** 当前只看某一天时，显示该日期并提供「查看全部」 */
  date?: string | null
  onClearDate?: () => void
  loading?: boolean
  /** 展示项目名（个人主页跨项目时有用） */
  showProject?: boolean
}

export default function UpdateLog({
  items,
  date,
  onClearDate,
  loading,
  showProject = false,
}: Props) {
  const title = date ? `${date} 的更新（${items.length}）` : `更新日志（最近 ${items.length} 条）`

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 8,
        }}
      >
        <Typography.Text strong>{title}</Typography.Text>
        {date && (
          <Button type="link" size="small" onClick={onClearDate}>
            查看全部
          </Button>
        )}
      </div>

      <List
        loading={loading}
        dataSource={items}
        locale={{
          emptyText: (
            <Empty
              description={date ? '这一天没有更新' : '暂无更新记录'}
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          ),
        }}
        renderItem={(it) => (
          <List.Item style={{ padding: '10px 0' }}>
            <List.Item.Meta
              avatar={
                <Link to={userPath(it.uploader)}>
                  <Avatar size="small" icon={<UserOutlined />} src={it.uploader?.avatar_url || undefined} />
                </Link>
              }
              title={
                <Space size={8} wrap>
                  <Typography.Text strong>{it.asset_name || '资产'}</Typography.Text>
                  <Tag color="green">v{it.version}</Tag>
                  {showProject && it.project_name && (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      @ {it.project_name}
                    </Typography.Text>
                  )}
                </Space>
              }
              description={
                <Space direction="vertical" size={2}>
                  {it.changelog && <Typography.Text>{it.changelog}</Typography.Text>}
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {it.uploader ? (
                      <Link to={userPath(it.uploader)}>
                        {it.uploader.nickname || it.uploader.username}
                      </Link>
                    ) : (
                      '未知'
                    )}{' '}
                    · {fmtTime(it.created_at)}
                  </Typography.Text>
                </Space>
              }
            />
          </List.Item>
        )}
      />
    </div>
  )
}
