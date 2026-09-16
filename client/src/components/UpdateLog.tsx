import { Button, Empty, List, Space, Tag, Typography } from 'antd'
import { ArrowRightOutlined } from '@ant-design/icons'
import { Link } from 'react-router-dom'
import type { UpdateItem } from '../types'

function fmtTime(t?: string | null): string {
  if (!t) return ''
  const d = new Date(t)
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes(),
  ).padStart(2, '0')}`
}

/** 行为说明：v1 是这条资产第一次上传，之后都是新版本 */
function actionOf(it: UpdateItem): string {
  return it.version === 1 ? '新建资产' : '更新资产'
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
  // 只有「只看某一天」时才需要这行（日期 + 查看全部）；平时的标题由外层 Card 提供，避免重复
  const title = date ? `${date} 的更新（${items.length}）` : null

  return (
    <div>
      {title && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 8,
          }}
        >
          <Typography.Text strong>{title}</Typography.Text>
          <Button type="link" size="small" onClick={onClearDate}>
            查看全部
          </Button>
        </div>
      )}

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
        renderItem={(it) => {
          if (it.restricted) {
            // 私有项目：不暴露资产名与项目名
            return (
              <List.Item style={{ padding: '10px 0' }}>
                <Space size={8} wrap>
                  <Tag>私有</Tag>
                  <Typography.Text type="secondary">该更新为私有仓库</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {fmtTime(it.created_at)}
                  </Typography.Text>
                </Space>
              </List.Item>
            )
          }

          return (
            <List.Item style={{ padding: '10px 0' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, width: '100%' }}>
                {/* 左边：项目名 + 资产名、说明、时间 */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Space size={8} wrap>
                    {showProject && it.project_name && (
                      <Typography.Text strong style={{ color: 'var(--av-primary)' }}>
                        {it.project_name}
                      </Typography.Text>
                    )}
                    <Tag>{actionOf(it)}</Tag>
                    <Typography.Text strong>{it.asset_name || '资产'}</Typography.Text>
                  </Space>
                  <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
                    {fmtTime(it.created_at)}
                  </Typography.Text>
                </div>
                {/* 右边：版本号 + 跳转按钮 */}
                <Space size={8} align="center">
                  <Tag color="green">v{it.version}</Tag>
                  <Link to={`/assets/${it.asset_id}`} title="查看资产">
                    <Button size="small" icon={<ArrowRightOutlined />} />
                  </Link>
                </Space>
              </div>
            </List.Item>
          )
        }}
      />
    </div>
  )
}
