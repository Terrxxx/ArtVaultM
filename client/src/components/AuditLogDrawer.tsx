import { useCallback, useEffect, useState } from 'react'
import { Avatar, Button, Drawer, Empty, List, Popconfirm, Space, Typography, message } from 'antd'
import { DeleteOutlined, UserOutlined } from '@ant-design/icons'
import { api } from '../api'
import { fmtDateTime } from '../timefmt'
import type { ProjectLogItem } from '../types'
import ArtSpin from './ArtSpin'

const PAGE = 50

interface Props {
  open: boolean
  projectId: number
  onClose: () => void
}

/** 项目操作日志：谁在什么时候改了什么。只有所有者与高级管理员能打开。 */
export default function AuditLogDrawer({ open, projectId, onClose }: Props) {
  const [items, setItems] = useState<ProjectLogItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api.listProjectLogs(projectId, 0, PAGE)
      setItems(r.items)
      setTotal(r.total)
    } catch (e: any) {
      message.error(e.response?.data?.detail || '加载失败')
      setItems([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  const loadMore = async () => {
    setLoadingMore(true)
    try {
      const r = await api.listProjectLogs(projectId, items.length, PAGE)
      setItems((prev) => [...prev, ...r.items])
      setTotal(r.total)
    } catch (e: any) {
      message.error(e.response?.data?.detail || '加载失败')
    } finally {
      setLoadingMore(false)
    }
  }

  const clearAll = async () => {
    try {
      await api.clearProjectLogs(projectId)
      setItems([])
      setTotal(0)
      message.success('操作日志已清除')
    } catch (e: any) {
      message.error(e.response?.data?.detail || '清除失败')
    }
  }

  return (
    <Drawer
      title="操作日志"
      placement="right"
      width={420}
      open={open}
      onClose={onClose}
      extra={
        items.length > 0 && (
          <Popconfirm
            title="清除全部操作日志？"
            description="记录会一并删掉，不可恢复"
            okText="清除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={clearAll}
          >
            <Button size="small" danger icon={<DeleteOutlined />}>
              清除
            </Button>
          </Popconfirm>
        )
      }
    >
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        只记改动型操作（增删改、移动重命名、成员与权限变更），项目所有者与高级管理员可见。
      </Typography.Text>

      <div style={{ marginTop: 12 }}>
        {loading ? (
          <ArtSpin padding={48} />
        ) : items.length === 0 ? (
          <Empty
            description="暂无记录"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        ) : (
          <>
            <List
              dataSource={items}
              renderItem={(it) => (
                <List.Item style={{ padding: '10px 0' }}>
                  <List.Item.Meta
                    avatar={
                      <Avatar
                        size="small"
                        icon={<UserOutlined />}
                        src={it.user?.avatar_url || undefined}
                      />
                    }
                    title={
                      <Space size={8} wrap>
                        <Typography.Text strong>
                          {it.user?.nickname || it.user?.username || '未知用户'}
                        </Typography.Text>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {fmtDateTime(it.created_at)}
                        </Typography.Text>
                      </Space>
                    }
                    description={it.detail}
                  />
                </List.Item>
              )}
            />
            {items.length < total && (
              <div style={{ textAlign: 'center', marginTop: 12 }}>
                <Button loading={loadingMore} onClick={loadMore}>
                  加载更多
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </Drawer>
  )
}
