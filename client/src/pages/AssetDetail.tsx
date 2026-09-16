import { useCallback, useEffect, useState } from 'react'
import {
  Avatar,
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  List,
  message,
  Modal,
  Row,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd'
import {
  ArrowLeftOutlined,
  BellOutlined,
  DownloadOutlined,
  EditOutlined,
  EyeOutlined,
  FileOutlined,
  LikeFilled,
  LikeOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, downloadVersion, formatSize, projectPath, userPath } from '../api'
import type { Asset, Version } from '../types'
import CommentSection from '../components/CommentSection'
import OnlinePreview, { previewKind } from '../components/OnlinePreview'
import UploadVersionModal from '../components/UploadVersionModal'
import { isSuperAdmin } from '../types'
import { useAuthStore } from '../store'

// 版本历史默认展示的条数，容器高度按这个条数固定
const VERSION_PREVIEW = 4
const VERSION_ITEM_HEIGHT = 92

export default function AssetDetail() {
  const { id } = useParams()
  const assetId = Number(id)
  const [asset, setAsset] = useState<Asset | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [loading, setLoading] = useState(true)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [subscribed, setSubscribed] = useState(false)
  const [previewTarget, setPreviewTarget] = useState<Version | null>(null)
  const user = useAuthStore((s) => s.user)
  const navigate = useNavigate()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [a, subs] = await Promise.all([api.getAsset(assetId), api.listSubscriptions()])
      setAsset(a)
      setSubscribed(subs.some((s) => s.target_type === 'asset' && s.target_id === assetId))
    } catch (e: any) {
      message.error(e.response?.data?.detail || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [assetId])

  useEffect(() => {
    load()
  }, [load])

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Spin size="large" />
      </div>
    )
  }
  if (!asset) return <Empty />

  const versions = asset.versions || []
  // 左上角固定展示资产封面，不随所选版本变化
  const coverSrc = asset.cover_thumbnail_url || null
  const canWrite = user?.id === asset.created_by || isSuperAdmin(user?.role)
  const totalDownloads = versions.reduce((sum, v) => sum + (v.download_count || 0), 0)
  const visibleVersions = expanded ? versions : versions.slice(0, VERSION_PREVIEW)

  // 版本列表的缩略图来自该版本自己的文件（只有图片版本有）
  const rowThumbOf = (v: Version) => v.thumb_small_url || null

  const toggleLike = async () => {
    const res = await api.toggleLike(assetId)
    setAsset({ ...asset, liked_by_me: res.liked, like_count: res.like_count })
  }

  const toggleSubscribe = async () => {
    const { subscribed: now } = await api.toggleSubscription('asset', assetId)
    setSubscribed(now)
    message.success(now ? '已订阅该资产更新' : '已取消订阅')
  }

  // 返回项目时落回该资产所在的文件夹，而不是项目根目录
  const projectHref = `${projectPath({
    id: asset.project_id,
    slug: asset.project_slug,
    owner: asset.project_owner,
  })}${asset.folder_id ? `?folder=${asset.folder_id}` : ''}`

  return (
    <div>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Space>
          <Link to={projectHref}>
            <ArrowLeftOutlined /> 返回项目
          </Link>
        </Space>

        <Row gutter={16}>
          <Col xs={24} md={10}>
            <Card styles={{ body: { padding: 0 } }}>
              {coverSrc ? (
                <img src={coverSrc} alt={asset.name} style={{ width: '100%', display: 'block' }} />
              ) : (
                <div
                  style={{
                    height: 260,
                    background: '#f0f0f0',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#c0c0c0',
                  }}
                >
                  <FileOutlined style={{ fontSize: 56 }} />
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    暂无封面
                  </Typography.Text>
                </div>
              )}
            </Card>
            <Typography.Text
              type="secondary"
              style={{ fontSize: 12, display: 'block', marginTop: 6, textAlign: 'center' }}
            >
              资产封面{canWrite ? ' · 可在「编辑资产」中更换' : ''}
            </Typography.Text>
          </Col>
          <Col xs={24} md={14}>
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Space align="center" size={12} wrap>
                <Typography.Title level={3} style={{ margin: 0 }}>
                  {asset.name}
                </Typography.Title>
                {asset.category_name && <Tag color="geekblue">{asset.category_name}</Tag>}
                <Tag color="green">最新 v{asset.latest_version?.version}</Tag>
              </Space>
              {asset.tags?.length > 0 && (
                <Space size={4} wrap>
                  {asset.tags.map((t) => (
                    <Tag key={t}>{t}</Tag>
                  ))}
                </Space>
              )}
              <Typography.Text>{asset.description || '暂无描述'}</Typography.Text>
              <Descriptions size="small" column={1}>
                <Descriptions.Item label="上传者">
                  {asset.creator ? (
                    <Link to={userPath(asset.creator)}>
                      <Space size={6}>
                        <Avatar
                          size={20}
                          icon={<UserOutlined />}
                          src={asset.creator.avatar_url || undefined}
                        />
                        {asset.creator.nickname || asset.creator.username}
                      </Space>
                    </Link>
                  ) : (
                    '-'
                  )}
                </Descriptions.Item>
                <Descriptions.Item label="版本数">{asset.version_count}</Descriptions.Item>
                <Descriptions.Item label="总下载">{totalDownloads} 次</Descriptions.Item>
              </Descriptions>
              <Space wrap>
                <Button
                  type={asset.liked_by_me ? 'primary' : 'default'}
                  icon={asset.liked_by_me ? <LikeFilled /> : <LikeOutlined />}
                  onClick={toggleLike}
                >
                  {asset.like_count}
                </Button>
                <Button
                  type={subscribed ? 'primary' : 'default'}
                  icon={<BellOutlined />}
                  onClick={toggleSubscribe}
                >
                  {subscribed ? '已订阅' : '订阅更新'}
                </Button>
                {canWrite && (
                  <Button
                    icon={<EditOutlined />}
                    onClick={() => navigate(`/assets/${assetId}/edit`)}
                  >
                    编辑资产
                  </Button>
                )}
                {canWrite && (
                  <Button type="primary" onClick={() => setUploadOpen(true)}>
                    上传新版本
                  </Button>
                )}
              </Space>
            </Space>
          </Col>
        </Row>

        <Card
          title={`版本历史（${versions.length}）`}
          extra={
            versions.length > VERSION_PREVIEW && (
              <Button type="link" size="small" onClick={() => setExpanded((v) => !v)}>
                {expanded ? '收起' : `展开其余 ${versions.length - VERSION_PREVIEW} 个`}
              </Button>
            )
          }
        >
          {/* 容器高度固定为约 4 条，超出部分滚动 */}
          <div
            style={{
              maxHeight: VERSION_PREVIEW * VERSION_ITEM_HEIGHT,
              overflowY: versions.length > VERSION_PREVIEW ? 'auto' : 'visible',
              paddingRight: versions.length > VERSION_PREVIEW ? 8 : 0,
            }}
          >
            <List
              dataSource={visibleVersions}
              renderItem={(v: Version) => {
                const rowThumb = rowThumbOf(v)
                return (
                <List.Item
                  actions={[
                    <Button
                      key="pv"
                      icon={<EyeOutlined />}
                      onClick={() => setPreviewTarget(v)}
                    >
                      预览
                    </Button>,
                    <Button
                      key="dl"
                      icon={<DownloadOutlined />}
                      onClick={() => downloadVersion(v.id, v.file_name)}
                    >
                      下载
                    </Button>,
                  ]}
                >
                  <List.Item.Meta
                    avatar={
                      rowThumb ? (
                        <img
                          src={rowThumb}
                          alt={asset.name}
                          style={{
                            width: 42,
                            height: 42,
                            objectFit: 'cover',
                            borderRadius: 4,
                            border: '1px solid #eee',
                          }}
                        />
                      ) : undefined
                    }
                    title={
                      <Space wrap>
                        {v.is_latest && <Tag color="green">最新</Tag>}
                        <Typography.Text strong>v{v.version}</Typography.Text>
                        {v.file_format && <Tag>{v.file_format}</Tag>}
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          下载 {v.download_count} 次
                        </Typography.Text>
                      </Space>
                    }
                    description={
                      <Space direction="vertical" size={2}>
                        <Typography.Text type="secondary">
                          {v.file_name} · {formatSize(v.file_size)}
                        </Typography.Text>
                        {v.changelog && (
                          <Typography.Text type="secondary">说明：{v.changelog}</Typography.Text>
                        )}
                        <Space size={6} align="center" style={{ fontSize: 12 }}>
                          {v.uploader ? (
                            <Link to={userPath(v.uploader)}>
                              <Space size={6} align="center">
                                <Avatar
                                  size={18}
                                  icon={<UserOutlined />}
                                  src={v.uploader.avatar_url || undefined}
                                />
                                {v.uploader.nickname || v.uploader.username}
                              </Space>
                            </Link>
                          ) : (
                            <Typography.Text type="secondary">未知</Typography.Text>
                          )}
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            上传于 {v.created_at ? new Date(v.created_at).toLocaleString() : ''}
                          </Typography.Text>
                        </Space>
                      </Space>
                    }
                  />
                </List.Item>
                )
              }}
            />
          </div>
        </Card>

        <Card title="评论">
          <CommentSection assetId={assetId} versions={versions} />
        </Card>
      </Space>

      {/* 点「预览」才预览，并把内容限制在合适大小内 */}
      <Modal
        open={!!previewTarget}
        onCancel={() => setPreviewTarget(null)}
        footer={null}
        width={880}
        title={
          previewTarget
            ? `预览 · v${previewTarget.version}${previewTarget.is_latest ? '（最新）' : ''}`
            : '预览'
        }
      >
        <div style={{ maxHeight: '72vh', overflow: 'auto' }}>
          <OnlinePreview
            version={previewTarget}
            assetName={asset.name}
            fallback={
              previewTarget?.thumbnail_url ? (
                <img
                  src={previewTarget.thumbnail_url}
                  alt={asset.name}
                  style={{ maxWidth: '100%', maxHeight: '70vh', display: 'block', margin: '0 auto' }}
                />
              ) : coverSrc ? (
                <img
                  src={coverSrc}
                  alt={asset.name}
                  style={{ maxWidth: '100%', maxHeight: '70vh', display: 'block', margin: '0 auto' }}
                />
              ) : (
                <Empty description="该格式暂不支持在线预览" style={{ padding: 40 }} />
              )
            }
          />
        </div>
      </Modal>

      <UploadVersionModal
        open={uploadOpen}
        assetId={assetId}
        onClose={() => setUploadOpen(false)}
        onSuccess={load}
      />
    </div>
  )
}
