import { Card, Space, Tag, Typography } from 'antd'
import { FileOutlined, LikeOutlined } from '@ant-design/icons'
import { Link } from 'react-router-dom'
import { assetPath } from '../api'
import type { Asset } from '../types'

export default function AssetCard({ asset }: { asset: Asset }) {
  const cover = asset.cover_thumbnail_url || null

  return (
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
  )
}
