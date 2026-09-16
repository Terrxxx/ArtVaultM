import { Button, Card, Dropdown, Space, Tag, Typography } from 'antd'
import { FileOutlined, FolderOutlined, LikeOutlined } from '@ant-design/icons'
import { Link } from 'react-router-dom'
import { assetPath } from '../api'
import type { Asset, Category } from '../types'

interface Props {
  asset: Asset
  /** 传入文件夹列表与回调后，展示「移动到文件夹」菜单 */
  categories?: Category[]
  onMove?: (assetId: number, categoryId: number) => void
}

export default function AssetCard({ asset, categories, onMove }: Props) {
  const cover = asset.cover_thumbnail_url || null
  // 有回调、且存在其它可选文件夹时才展示移动入口
  const movable =
    !!onMove && !!categories?.some((c) => c.id !== asset.category_id)

  return (
    <div style={{ position: 'relative', height: '100%' }}>
      <Link to={assetPath(asset)}>
        <Card
          hoverable
          styles={{ body: { padding: 12 } }}
          cover={
            cover ? (
              <div
                style={{
                  height: 150,
                  overflow: 'hidden',
                  background: '#f0f0f0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <img src={cover} alt={asset.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
            ) : (
              <div
                style={{
                  height: 150,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: '#f0f0f0',
                  color: '#c0c0c0',
                }}
              >
                <FileOutlined style={{ fontSize: 44 }} />
              </div>
            )
          }
        >
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <Typography.Text strong ellipsis={{ tooltip: asset.name }}>
              {asset.name}
            </Typography.Text>
            <Space size={4} wrap>
              {asset.category_name && <Tag color="geekblue">{asset.category_name}</Tag>}
              <Tag color="blue">v{asset.latest_version?.version ?? 1}</Tag>
            </Space>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {asset.version_count} 个版本 · {asset.creator?.nickname || asset.creator?.username}
            </Typography.Text>
            <Space size={4}>
              <Typography.Text type={asset.liked_by_me ? undefined : 'secondary'} style={{ fontSize: 12 }}>
                <LikeOutlined /> {asset.like_count}
              </Typography.Text>
            </Space>
          </Space>
        </Card>
      </Link>

      {movable && (
        <Dropdown
          trigger={['click']}
          menu={{
            items: (categories || [])
              .filter((c) => c.id !== asset.category_id)
              .map((c) => ({ key: String(c.id), label: c.name })),
            onClick: ({ key, domEvent }) => {
              domEvent.stopPropagation()
              onMove?.(asset.id, Number(key))
            },
          }}
        >
          <Button
            size="small"
            icon={<FolderOutlined />}
            style={{ position: 'absolute', top: 8, right: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.18)' }}
            onClick={(e) => e.stopPropagation()}
          >
            移动
          </Button>
        </Dropdown>
      )}
    </div>
  )
}
