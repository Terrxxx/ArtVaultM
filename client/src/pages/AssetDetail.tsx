import { useCallback, useEffect, useState } from 'react'
import {
  Avatar,
  Button,
  Card,
  Col,
  Descriptions,
  Dropdown,
  Empty,
  Input,
  List,
  message,
  Modal,
  Row,
  Space,
  Spin,
  Tag,
  Typography,
  Upload,
} from 'antd'
import {
  ArrowLeftOutlined,
  BellOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  EyeOutlined,
  FileOutlined,
  LikeFilled,
  LikeOutlined,
  MoreOutlined,
  SwapOutlined,
  UploadOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, downloadVersion, formatSize, projectPath, userPath } from '../api'
import type { Asset, Project, Version } from '../types'
import CommentSection from '../components/CommentSection'
import OnlinePreview, { previewKind } from '../components/OnlinePreview'
import UploadVersionModal from '../components/UploadVersionModal'
import { isSuperAdmin } from '../types'
import { useAuthStore } from '../store'

// 版本历史默认展示的条数
const VERSION_PREVIEW = 4
// 封面固定 3:2 横图：图片按这个尺寸裁切填满，不随栏宽变大变小
const COVER_WIDTH = 540
const COVER_HEIGHT = 360

export default function AssetDetail() {
  const { id } = useParams()
  const assetId = Number(id)
  const [asset, setAsset] = useState<Asset | null>(null)
  // 项目成员列表决定「谁能改这个资产」，单独取一次
  const [project, setProject] = useState<Project | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [loading, setLoading] = useState(true)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [subscribed, setSubscribed] = useState(false)
  const [previewTarget, setPreviewTarget] = useState<Version | null>(null)
  // 换源 / 删除版本
  const [replaceTarget, setReplaceTarget] = useState<Version | null>(null)
  const [replaceFile, setReplaceFile] = useState<any[]>([])
  const [replaceChangelog, setReplaceChangelog] = useState('')
  const [replaceSubmitting, setReplaceSubmitting] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Version | null>(null)
  const [deleteSubmitting, setDeleteSubmitting] = useState(false)
  // 修改版本说明
  const [changelogTarget, setChangelogTarget] = useState<Version | null>(null)
  const [changelogText, setChangelogText] = useState('')
  const [changelogSubmitting, setChangelogSubmitting] = useState(false)
  const user = useAuthStore((s) => s.user)
  const navigate = useNavigate()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [a, subs] = await Promise.all([api.getAsset(assetId), api.listSubscriptions()])
      setAsset(a)
      setSubscribed(subs.some((s) => s.target_type === 'asset' && s.target_id === assetId))
      setProject(await api.getProject(a.project_id))
    } catch (e: any) {
      message.error(e.response?.data?.detail || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [assetId])

  useEffect(() => {
    load()
  }, [load])

  // 主体要保持在原来的居中位置，评论栏才能塞进左边的空白；所以让外层容器撑满屏幕
  useEffect(() => {
    document.body.classList.add('av-wide')
    return () => document.body.classList.remove('av-wide')
  }, [])

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
  // 项目内的资产由项目成员共同维护：改资料、传新版本、换源、删历史版本都能做；
  // 删除整个资产仍然只有创建者或高级管理员能动
  const canWrite =
    !!user &&
    (user.id === asset.created_by ||
      isSuperAdmin(user.role) ||
      project?.owner_id === user.id ||
      (project?.members || []).some((m) => m.user?.id === user.id))
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

  // 换源：把该版本的文件换成新上传的，版本号与下载数不变
  const replaceSource = async () => {
    const file = replaceFile[0]?.originFileObj
    if (!replaceTarget || !file) return
    const fd = new FormData()
    fd.append('file', file)
    if (replaceChangelog.trim()) fd.append('changelog', replaceChangelog.trim())
    setReplaceSubmitting(true)
    try {
      await api.replaceVersionSource(replaceTarget.id, fd)
      message.success('已换源')
      setReplaceTarget(null)
      setReplaceFile([])
      setReplaceChangelog('')
      load()
    } catch (e: any) {
      message.error(e.response?.data?.detail || '换源失败')
    } finally {
      setReplaceSubmitting(false)
    }
  }

  const removeVersion = async () => {
    if (!deleteTarget) return
    setDeleteSubmitting(true)
    try {
      await api.deleteVersion(deleteTarget.id)
      message.success('已删除该版本')
      setDeleteTarget(null)
      load()
    } catch (e: any) {
      message.error(e.response?.data?.detail || '删除失败')
    } finally {
      setDeleteSubmitting(false)
    }
  }

  // 只改版本说明，不动文件
  const saveChangelog = async () => {
    if (!changelogTarget) return
    setChangelogSubmitting(true)
    try {
      await api.updateVersionChangelog(changelogTarget.id, changelogText.trim())
      message.success('已更新版本说明')
      setChangelogTarget(null)
      load()
    } catch (e: any) {
      message.error(e.response?.data?.detail || '保存失败')
    } finally {
      setChangelogSubmitting(false)
    }
  }

  // 返回时落回该资产所在的文件夹，而不是项目根目录
  const projectHref = `${projectPath({
    id: asset.project_id,
    slug: asset.project_slug,
    owner: asset.project_owner,
  })}${asset.folder_id ? `?folder=${asset.folder_id}` : ''}`

  return (
    <div>
      <div className="av-center-layout">
        {/* 左栏：评论 */}
        <div className="av-rail-comments av-rail-plain">
          <Typography.Title level={5} style={{ marginTop: 0, marginBottom: 12 }}>
            评论
          </Typography.Title>
          <CommentSection assetId={assetId} versions={versions} />
        </div>

        {/* 主内容 */}
        <div className="av-center-main">
          <Button
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate(projectHref)}
            style={{ marginBottom: 16 }}
          >
            返回
          </Button>
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Row gutter={16}>
            {/* 列宽自适应封面，封面内尺寸固定，保证正好 3:2 */}
            <Col flex="0 0 auto">
              <Card styles={{ body: { padding: 0 } }}>
                {coverSrc ? (
                  <img
                    src={coverSrc}
                    alt={asset.name}
                    style={{
                      width: COVER_WIDTH,
                      height: COVER_HEIGHT,
                      objectFit: 'cover',
                      display: 'block',
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: COVER_WIDTH,
                      height: COVER_HEIGHT,
                      background: 'var(--av-surface)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--av-icon-muted)',
                    }}
                  >
                    <FileOutlined style={{ fontSize: 56 }} />
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      暂无封面
                    </Typography.Text>
                  </div>
                )}
              </Card>
            </Col>
            {/* flex 基数为 0，信息栏才不会因为内容太宽而换到封面下面 */}
            <Col style={{ flex: '1 1 0', minWidth: 0 }}>
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
            {/* 只渲染前 N 条，不做内部滚动，避免固定高度把最后一条截成半行 */}
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
                    canWrite && (
                      <Dropdown
                        key="more"
                        trigger={['click']}
                        menu={{
                          items: [
                            {
                              key: 'changelog',
                              icon: <EditOutlined />,
                              label: '修改说明',
                            },
                            { key: 'replace', icon: <SwapOutlined />, label: '换源' },
                            {
                              key: 'delete',
                              icon: <DeleteOutlined />,
                              label: v.is_latest ? '删除此版本（最新版本不能删）' : '删除此版本',
                              danger: true,
                              disabled: !!v.is_latest,
                            },
                          ],
                          onClick: ({ key }) => {
                            if (key === 'changelog') {
                              setChangelogTarget(v)
                              setChangelogText(v.changelog || '')
                            } else if (key === 'replace') {
                              setReplaceTarget(v)
                              setReplaceFile([])
                              setReplaceChangelog('')
                            } else if (key === 'delete') {
                              setDeleteTarget(v)
                            }
                          },
                        }}
                      >
                        <Button icon={<MoreOutlined />} />
                      </Dropdown>
                    ),
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
                            border: '1px solid var(--av-border)',
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
          </Card>
          </Space>
        </div>
      </div>

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

      {/* 换源：只换文件，版本号与下载数不变 */}
      <Modal
        title={`换源 · v${replaceTarget?.version ?? ''}`}
        open={!!replaceTarget}
        onOk={replaceSource}
        onCancel={() => {
          setReplaceTarget(null)
          setReplaceFile([])
          setReplaceChangelog('')
        }}
        confirmLoading={replaceSubmitting}
        okText="替换"
        cancelText="取消"
        okButtonProps={{ disabled: replaceFile.length === 0 }}
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Typography.Text type="secondary">
            当前文件：{replaceTarget?.file_name}（{formatSize(replaceTarget?.file_size ?? 0)}）
          </Typography.Text>
          <Upload
            beforeUpload={() => false}
            maxCount={1}
            fileList={replaceFile}
            onChange={({ fileList }) => setReplaceFile(fileList)}
          >
            <Button icon={<UploadOutlined />}>选择新文件</Button>
          </Upload>
          <Input
            value={replaceChangelog}
            onChange={(e) => setReplaceChangelog(e.target.value)}
            placeholder="版本说明（可选，留空则保持不变）"
          />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            版本号、下载次数与评论都会保留，只把文件换成新的。
          </Typography.Text>
        </Space>
      </Modal>

      {/* 修改版本说明 */}
      <Modal
        title={`修改说明 · v${changelogTarget?.version ?? ''}`}
        open={!!changelogTarget}
        onOk={saveChangelog}
        onCancel={() => setChangelogTarget(null)}
        confirmLoading={changelogSubmitting}
        okText="保存"
        cancelText="取消"
      >
        <Input.TextArea
          rows={3}
          value={changelogText}
          onChange={(e) => setChangelogText(e.target.value)}
          placeholder="这一版改了什么，留空表示清空说明"
        />
      </Modal>

      {/* 删除历史版本 */}
      <Modal
        title={`删除版本 v${deleteTarget?.version ?? ''}`}
        open={!!deleteTarget}
        onOk={removeVersion}
        onCancel={() => setDeleteTarget(null)}
        confirmLoading={deleteSubmitting}
        okText="删除"
        cancelText="取消"
        okButtonProps={{ danger: true }}
      >
        <Typography.Text type="danger">
          该版本的文件与缩略图会被删除，不可恢复。引用它的评论正文不受影响。
        </Typography.Text>
      </Modal>
    </div>
  )
}
