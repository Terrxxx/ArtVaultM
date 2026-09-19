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
  PictureOutlined,
  RollbackOutlined,
  SwapOutlined,
  UploadOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, downloadVersion, formatSize, projectPath, userPath } from '../api'
import { fmtDateTime } from '../timefmt'
import type { Asset, Version } from '../types'
import CommentSection from '../components/CommentSection'
import OnlinePreview, { previewKind } from '../components/OnlinePreview'
import UploadVersionModal from '../components/UploadVersionModal'
import ArtSpin from '../components/ArtSpin'

// 版本历史默认展示的条数
const VERSION_PREVIEW = 4
// 封面 3:2 横图：列宽固定 540，屏幕放不下时由 maxWidth 压到容器宽度
const COVER_WIDTH = 540
const COVER_HEIGHT = 360
// 尺寸交给列定，图自己撑满列宽；比例靠 aspectRatio 保持
const COVER_BOX: React.CSSProperties = {
  width: '100%',
  aspectRatio: `${COVER_WIDTH} / ${COVER_HEIGHT}`,
}

// 版本行左边缩略图的边长
const ROW_THUMB = 72

/** 版本行显示文件名（去掉扩展名，扩展名由旁边的格式标签表达） */
function fileStem(name?: string | null): string {
  const text = name || ''
  const i = text.lastIndexOf('.')
  return i > 0 ? text.slice(0, i) : text
}

export default function AssetDetail() {
  const { id } = useParams()
  const assetId = Number(id)
  const [asset, setAsset] = useState<Asset | null>(null)
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
  // 回滚到某个历史版本
  const [rollbackTarget, setRollbackTarget] = useState<Version | null>(null)
  const [rollbackChangelog, setRollbackChangelog] = useState('')
  const [rollbackSubmitting, setRollbackSubmitting] = useState(false)
  // 修改版本说明
  const [changelogTarget, setChangelogTarget] = useState<Version | null>(null)
  const [changelogText, setChangelogText] = useState('')
  const [changelogSubmitting, setChangelogSubmitting] = useState(false)
  // 给某个版本单独换缩略图
  const [thumbTarget, setThumbTarget] = useState<Version | null>(null)
  const [thumbFile, setThumbFile] = useState<any[]>([])
  const [thumbSubmitting, setThumbSubmitting] = useState(false)
  // 评论里点了 @v2 后，把那一版闪一下
  const [flashVersion, setFlashVersion] = useState<number | null>(null)
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

  // 主体要保持在原来的居中位置，评论栏才能塞进左边的空白；所以让外层容器撑满屏幕
  useEffect(() => {
    document.body.classList.add('av-wide')
    return () => document.body.classList.remove('av-wide')
  }, [])

  if (loading) {
    return (
      <ArtSpin />
    )
  }
  if (!asset) return <Empty />

  const versions = asset.versions || []
  // 左上角固定展示资产封面，不随所选版本变化
  const coverSrc = asset.cover_thumbnail_url || null
  // 能改资料、传新版本、换源、删历史版本：由后端算好（项目成员或资产创建者）
  const canWrite = asset.can_edit
  const totalDownloads = versions.reduce((sum, v) => sum + (v.download_count || 0), 0)
  const visibleVersions = expanded ? versions : versions.slice(0, VERSION_PREVIEW)

  // 版本列表的缩略图来自该版本自己的文件（只有图片版本有）
  // 版本行左边的小图：优先这个版本上传的缩略图（够大、放大不糊），
  // 没有才退回后端从图片文件派生的 42×42 小图
  const rowThumbOf = (v: Version) => v.thumbnail_url || v.thumb_small_url || null

  const toggleLike = async () => {
    const res = await api.toggleLike(assetId)
    setAsset({ ...asset, liked_by_me: res.liked, like_count: res.like_count })
  }

  const toggleSubscribe = async () => {
    const { subscribed: now } = await api.toggleSubscription('asset', assetId)
    setSubscribed(now)
    message.success(now ? '已订阅该资产更新' : '已取消订阅')
  }

  // 评论里点 @v2：滚到那一版并闪一下（被折叠起来了才展开列表）
  const focusVersion = (version: number) => {
    const idx = versions.findIndex((v) => v.version === version)
    if (idx < 0) {
      message.info(`v${version} 已经不在了`)
      return
    }
    if (idx >= VERSION_PREVIEW) setExpanded(true)
    setFlashVersion(version)
    window.setTimeout(() => setFlashVersion(null), 1600)
    // 展开要等下一帧才渲染出来，所以延后一拍再滚
    window.setTimeout(() => {
      document
        .querySelector(`[data-version="${version}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 80)
  }

  // 只换这个版本的缩略图，文件与版本号都不动
  const uploadThumbnail = async () => {
    const file = thumbFile[0]?.originFileObj
    if (!thumbTarget || !file) return
    const fd = new FormData()
    fd.append('file', file)
    setThumbSubmitting(true)
    try {
      await api.setVersionThumbnail(thumbTarget.id, fd)
      message.success('缩略图已更新')
      setThumbTarget(null)
      setThumbFile([])
      load()
    } catch (e: any) {
      message.error(e.response?.data?.detail || '上传失败')
    } finally {
      setThumbSubmitting(false)
    }
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

  // 回滚：以旧版本的文件新建一版，版本号照常递增
  const doRollback = async () => {
    if (!rollbackTarget) return
    setRollbackSubmitting(true)
    try {
      await api.rollbackVersion(rollbackTarget.id, rollbackChangelog.trim())
      message.success('已按该版本新建一版')
      setRollbackTarget(null)
      setRollbackChangelog('')
      load()
    } catch (e: any) {
      message.error(e.response?.data?.detail || '回滚失败')
    } finally {
      setRollbackSubmitting(false)
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
          <CommentSection assetId={assetId} versions={versions} onSelectVersion={focusVersion} />
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
            {/* 封面列固定 540 宽，窄屏由 maxWidth 压到容器宽度，比例交给 aspectRatio */}
            <Col flex={`0 0 ${COVER_WIDTH}px`} style={{ maxWidth: '100%' }}>
              <Card styles={{ body: { padding: 0 } }}>
                {coverSrc ? (
                  <img
                    src={coverSrc}
                    alt={asset.name}
                    style={{ ...COVER_BOX, objectFit: 'cover', display: 'block' }}
                  />
                ) : (
                  <div
                    style={{
                      ...COVER_BOX,
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
                  className={
                    flashVersion === v.version
                      ? 'av-version-item av-version-flash'
                      : 'av-version-item'
                  }
                  data-version={v.version}
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
                    <Typography.Text
                      key="meta"
                      type="secondary"
                      style={{ fontSize: 12, whiteSpace: 'nowrap' }}
                    >
                      下载 {v.download_count} 次
                    </Typography.Text>,
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
                            {
                              key: 'thumbnail',
                              icon: <PictureOutlined />,
                              label: '上传缩略图',
                            },
                            {
                              key: 'rollback',
                              icon: <RollbackOutlined />,
                              label: '回滚到此版本',
                              disabled: !!v.is_latest,
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
                            } else if (key === 'thumbnail') {
                              setThumbTarget(v)
                              setThumbFile([])
                            } else if (key === 'rollback') {
                              setRollbackTarget(v)
                              setRollbackChangelog('')
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
                            width: ROW_THUMB,
                            height: ROW_THUMB,
                            objectFit: 'cover',
                            borderRadius: 4,
                            border: '1px solid var(--av-border)',
                          }}
                        />
                      ) : undefined
                    }
                    title={
                      // 这几个格子挨紧一点（Space size + .av-tag-tight 里把 Tag 自带的右外边距也去掉）
                      <Space wrap size={4} className="av-tag-tight">
                        {v.is_latest && <Tag color="green">最新</Tag>}
                        <Typography.Text strong>{fileStem(v.file_name)}</Typography.Text>
                        {/* 版本号单独占一个格子，不接在文件名后面 */}
                        <Tag>v{v.version}</Tag>
                        {v.file_format && <Tag>{v.file_format}</Tag>}
                        {/* 文件大小也做成格子，跟在扩展名后面 */}
                        <Tag>{formatSize(v.file_size)}</Tag>
                      </Space>
                    }
                    description={
                      <Space direction="vertical" size={2}>
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
                            上传于 {fmtDateTime(v.created_at)}
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

      {/* 单独给这个版本换缩略图：不动文件，也不影响版本号与下载数 */}
      <Modal
        title={`上传缩略图 · v${thumbTarget?.version ?? ''}`}
        open={!!thumbTarget}
        onOk={uploadThumbnail}
        onCancel={() => {
          setThumbTarget(null)
          setThumbFile([])
        }}
        confirmLoading={thumbSubmitting}
        okText="上传"
        cancelText="取消"
        okButtonProps={{ disabled: thumbFile.length === 0 }}
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Typography.Text type="secondary">
            {thumbTarget?.thumbnail_url
              ? '这个版本已经有缩略图，上传新的会替换掉它。'
              : '这个版本还没有缩略图。'}
          </Typography.Text>
          <Upload
            beforeUpload={() => false}
            maxCount={1}
            listType="picture"
            accept="image/*"
            fileList={thumbFile}
            onChange={({ fileList }) => setThumbFile(fileList)}
          >
            <Button icon={<UploadOutlined />}>选择图片</Button>
          </Upload>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            只换这一版左侧显示的小图，文件、版本号和下载次数都不变。
          </Typography.Text>
        </Space>
      </Modal>

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

      {/* 回滚：以该版本的文件新建一版，老版本保留 */}
      <Modal
        title={`回滚到 v${rollbackTarget?.version ?? ''}`}
        open={!!rollbackTarget}
        onOk={doRollback}
        onCancel={() => setRollbackTarget(null)}
        confirmLoading={rollbackSubmitting}
        okText="回滚"
        cancelText="取消"
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Typography.Text type="secondary">
            会把 v{rollbackTarget?.version} 的文件复制成一个新版本（版本号照常递增），
            v{rollbackTarget?.version} 本身仍然保留，不会丢。
          </Typography.Text>
          <Input
            value={rollbackChangelog}
            onChange={(e) => setRollbackChangelog(e.target.value)}
            placeholder={`版本说明（可选，留空则写「回滚到 v${rollbackTarget?.version ?? ''}」）`}
          />
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
