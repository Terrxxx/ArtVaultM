import { useCallback, useEffect, useState } from 'react'
import { Avatar, Button, Drawer, Empty, List, message, Popconfirm, Space, Spin, Tag, Typography } from 'antd'
import { DeleteOutlined, FileOutlined, UndoOutlined } from '@ant-design/icons'
import { api, userPath } from '../api'
import type { TrashItem } from '../types'
import { Link } from 'react-router-dom'

interface Props {
  open: boolean
  projectId: number
  onClose: () => void
  /** 恢复/彻底删除后通知外面刷新资产列表 */
  onChanged: () => void
}

function fmtTime(t?: string | null): string {
  if (!t) return ''
  const d = new Date(t)
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes(),
  ).padStart(2, '0')}`
}

export default function TrashDrawer({ open, projectId, onClose, onChanged }: Props) {
  const [items, setItems] = useState<TrashItem[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setItems(await api.listTrash(projectId))
    } catch (e: any) {
      message.error(e.response?.data?.detail || '加载回收站失败')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  const restore = async (item: TrashItem) => {
    try {
      const r = await api.restoreAsset(item.id)
      message.success(r?.folder_id ? '已恢复到原文件夹' : '已恢复到项目根目录')
      load()
      onChanged()
    } catch (e: any) {
      message.error(e.response?.data?.detail || '恢复失败')
    }
  }

  const purge = async (item: TrashItem) => {
    try {
      await api.purgeAsset(item.id)
      message.success('已彻底删除')
      load()
    } catch (e: any) {
      message.error(e.response?.data?.detail || '删除失败')
    }
  }

  return (
    <Drawer
      title={`回收站（${items.length}）`}
      placement="right"
      width={420}
      open={open}
      onClose={onClose}
    >
      <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
        删除的资产会在这里保留 30 天，到期后自动清理。恢复时会尽量放回原来的文件夹。
      </Typography.Text>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin />
        </div>
      ) : items.length === 0 ? (
        <Empty description="回收站是空的" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <List
          dataSource={items}
          renderItem={(it) => (
            <List.Item style={{ padding: '10px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
                {it.cover_thumbnail_url ? (
                  <img
                    src={it.cover_thumbnail_url}
                    alt={it.name}
                    style={{ width: 42, height: 42, objectFit: 'cover', borderRadius: 4 }}
                  />
                ) : (
                  <div
                    style={{
                      width: 42,
                      height: 42,
                      borderRadius: 4,
                      background: 'var(--av-surface)',
                      color: 'var(--av-icon-muted)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <FileOutlined />
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Typography.Text strong ellipsis style={{ display: 'block' }}>
                    {it.name}
                  </Typography.Text>
                  <Space size={6} wrap>
                    <Tag>{it.version_count} 个版本</Tag>
                    {it.creator && (
                      <Link to={userPath(it.creator)}>
                        <Space size={4} align="center">
                          <Avatar size={16} icon={<FileOutlined />} src={it.creator.avatar_url || undefined} />
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            {it.creator.nickname || it.creator.username}
                          </Typography.Text>
                        </Space>
                      </Link>
                    )}
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {fmtTime(it.deleted_at)} 删除
                    </Typography.Text>
                  </Space>
                </div>
                {it.can_manage && (
                  <Space size={4}>
                    <Button size="small" icon={<UndoOutlined />} onClick={() => restore(it)}>
                      恢复
                    </Button>
                    <Popconfirm
                      title="彻底删除？文件会一并抹掉，不可恢复"
                      onConfirm={() => purge(it)}
                    >
                      <Button size="small" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                  </Space>
                )}
              </div>
            </List.Item>
          )}
        />
      )}
    </Drawer>
  )
}
