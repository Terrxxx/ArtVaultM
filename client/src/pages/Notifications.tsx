import { useEffect, useState } from 'react'
import { Avatar, Button, Card, Empty, List, Space, Tag, Typography, message } from 'antd'
import { TeamOutlined, UserOutlined } from '@ant-design/icons'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import type { Invitation, Notification } from '../types'

const TYPE_LABEL: Record<string, { text: string; color: string }> = {
  comment: { text: '评论', color: 'blue' },
  mention: { text: '@提及', color: 'purple' },
  invite: { text: '邀请', color: 'green' },
  update: { text: '更新', color: 'orange' },
}

export default function Notifications() {
  const [items, setItems] = useState<Notification[]>([])
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  const load = async () => {
    setLoading(true)
    try {
      const [notes, invs] = await Promise.all([api.listNotifications(), api.listInvitations()])
      setItems(notes)
      setInvitations(invs)
    } catch (e: any) {
      message.error(e.response?.data?.detail || '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const markAll = async () => {
    await api.markAllRead()
    load()
  }

  const onClickItem = async (n: Notification) => {
    if (!n.is_read) {
      await api.markRead(n.id)
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)))
    }
  }

  const respond = async (inv: Invitation, accept: boolean) => {
    try {
      if (accept) {
        const res = await api.acceptInvitation(inv.member_id)
        message.success('已加入项目')
        navigate(`/projects/${res.project_id}`)
      } else {
        await api.declineInvitation(inv.member_id)
        message.success('已拒绝邀请')
      }
      load()
    } catch (e: any) {
      message.error(e.response?.data?.detail || '操作失败')
    }
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          消息
        </Typography.Title>
        <Button onClick={markAll}>全部标为已读</Button>
      </div>

      {invitations.length > 0 && (
        <Card
          title={
            <Space>
              <TeamOutlined />
              项目邀请（{invitations.length}）
            </Space>
          }
          style={{ marginBottom: 16 }}
          styles={{ body: { padding: 0 } }}
        >
          <List
            dataSource={invitations}
            renderItem={(inv) => (
              <List.Item
                style={{ padding: '12px 16px' }}
                actions={[
                  <Button key="acc" type="primary" size="small" onClick={() => respond(inv, true)}>
                    接受
                  </Button>,
                  <Button key="dec" size="small" onClick={() => respond(inv, false)}>
                    拒绝
                  </Button>,
                ]}
              >
                <List.Item.Meta
                  title={
                    <Space size={8} wrap>
                      <Typography.Text strong>{inv.project.name}</Typography.Text>
                      {inv.project.visibility === 'private' && <Tag color="orange">私有</Tag>}
                    </Space>
                  }
                  description={`由 ${inv.project.owner?.nickname || inv.project.owner?.username || '未知'} 邀请你加入，需你同意后才能进入`}
                />
              </List.Item>
            )}
          />
        </Card>
      )}

      <Card loading={loading} styles={{ body: { padding: items.length ? 0 : 24 } }}>
        {items.length === 0 && !loading ? (
          <Empty description="暂无消息" />
        ) : (
          <List
            dataSource={items}
            renderItem={(n) => {
              const meta = TYPE_LABEL[n.type] || { text: n.type, color: 'default' }
              const link = n.asset_id ? `/assets/${n.asset_id}` : n.project_id ? `/projects/${n.project_id}` : null
              const inner = (
                <List.Item
                  onClick={() => onClickItem(n)}
                  style={{
                    padding: '12px 16px',
                    background: n.is_read ? undefined : 'var(--av-unread-bg)',
                    cursor: 'pointer',
                  }}
                >
                  <List.Item.Meta
                    avatar={<Avatar icon={<UserOutlined />} src={n.actor?.avatar_url || undefined} />}
                    title={
                      <Space size={8} wrap>
                        <Tag color={meta.color}>{meta.text}</Tag>
                        <Typography.Text strong>{n.actor?.nickname || n.actor?.username || '系统'}</Typography.Text>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {n.created_at ? new Date(n.created_at).toLocaleString() : ''}
                        </Typography.Text>
                      </Space>
                    }
                    description={n.content}
                  />
                </List.Item>
              )
              return link ? <Link to={link} key={n.id}>{inner}</Link> : <div key={n.id}>{inner}</div>
            }}
          />
        )}
      </Card>
    </div>
  )
}
