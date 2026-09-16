import { useCallback, useEffect, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import {
  Avatar,
  Button,
  Card,
  Col,
  Drawer,
  Dropdown,
  Empty,
  Input,
  message,
  Modal,
  Result,
  Row,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd'
import {
  ArrowLeftOutlined,
  BarChartOutlined,
  BellOutlined,
  DeleteOutlined,
  EditOutlined,
  FileOutlined,
  FolderAddOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  GithubOutlined,
  HomeOutlined,
  MoreOutlined,
  PlusOutlined,
  SearchOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, projectPath, userPath } from '../api'
import type { ActivityResponse, Asset, Folder, LeaderboardItem, Project } from '../types'
import { isSuperAdmin } from '../types'
import AssetCard from '../components/AssetCard'
import Heatmap, { RECENT } from '../components/Heatmap'
import Leaderboard from '../components/Leaderboard'
import UploadAssetModal from '../components/UploadAssetModal'
import { useAuthStore } from '../store'

function ProjectDetailView({ project: initial }: { project: Project }) {
  const [project, setProject] = useState(initial)
  const [assets, setAssets] = useState<Asset[]>([])
  // 当前所在文件夹：0 = 项目根目录
  const [folderId, setFolderId] = useState(0)
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [subscribed, setSubscribed] = useState(false)
  const [activity, setActivity] = useState<ActivityResponse | null>(null)
  const [year, setYear] = useState<string | number>(RECENT)
  const [rankDays, setRankDays] = useState(30)
  const [rankItems, setRankItems] = useState<LeaderboardItem[]>([])
  const [rankLoading, setRankLoading] = useState(true)
  const [rankOpen, setRankOpen] = useState(false)
  const [folderOpen, setFolderOpen] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [folderSubmitting, setFolderSubmitting] = useState(false)
  // 拖拽悬停中的文件夹（含面包屑，0 = 根目录），用于高亮提示
  const [overFolder, setOverFolder] = useState<number | null>(null)
  // 正在拖拽的卡片，用来把它本身调成半透明
  const [draggingKey, setDraggingKey] = useState<string | null>(null)
  // 拖拽时跟随光标的图标（离屏渲染，交给 setDragImage）
  const dragIconRef = useRef<HTMLDivElement>(null)
  // 重命名文件夹弹窗
  const [renameTarget, setRenameTarget] = useState<Folder | null>(null)
  const [renameName, setRenameName] = useState('')
  const [renameSubmitting, setRenameSubmitting] = useState(false)
  // 删除文件夹确认弹窗（仅文件夹内有资产时使用）
  const [deleteTarget, setDeleteTarget] = useState<Folder | null>(null)
  const [deleteInput, setDeleteInput] = useState('')
  const [deleteSubmitting, setDeleteSubmitting] = useState(false)
  const me = useAuthStore((s) => s.user)
  const navigate = useNavigate()

  // 文件夹（目录）与「资产类型」是两套东西：这里导航用的是 folders
  const folders: Folder[] = project.folders || []

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [fresh, subs] = await Promise.all([
        api.getProject(project.id),
        api.listSubscriptions(),
      ])
      setProject(fresh)
      setSubscribed(subs.some((s) => s.target_type === 'project' && s.target_id === project.id))
      const params: Record<string, unknown> = { folder_id: folderId }
      if (q) params.q = q
      setAssets(await api.listAssets(project.id, params))
    } catch (e: any) {
      message.error(e.response?.data?.detail || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [project.id, folderId, q])

  useEffect(() => {
    load()
  }, [load])

  // 热力图（按年）
  useEffect(() => {
    let alive = true
    api
      .getProjectActivity(project.id, year)
      .then((r) => alive && setActivity(r))
      .catch(() => alive && setActivity(null))
    return () => {
      alive = false
    }
  }, [project.id, year])

  // 贡献排行（按时间窗口）
  useEffect(() => {
    let alive = true
    setRankLoading(true)
    api
      .getProjectLeaderboard(project.id, rankDays)
      .then((r) => alive && setRankItems(r.items))
      .catch(() => alive && setRankItems([]))
      .finally(() => alive && setRankLoading(false))
    return () => {
      alive = false
    }
  }, [project.id, rankDays])

  // 编辑项目：仅创建者本人或高级管理员
  const canEdit = project.owner_id === me?.id || isSuperAdmin(me?.role)
  // 上传资产：需要先受邀加入项目（所有者/成员），高级管理员例外
  const isMember =
    canEdit ||
    project.owner_id === me?.id ||
    (project.members || []).some((m) => m.user?.id === me?.id)
  // 移动资产：项目所有者/高级管理员，或资产创建者本人
  const canMoveAsset = (a: Asset) => canEdit || a.created_by === me?.id
  // 整理文件夹（新建/重命名/移动/删空文件夹）：项目成员即可
  const canManageFolder = isMember
  // 删除会连资产一起删的文件夹：仅项目创建者或高级管理员
  const canDeleteFolder = (c: Folder) => canEdit || !c.subtree_asset_count
  // 删除时需要输入名称二次确认：整个子树里有资产或有子文件夹
  const needsConfirm = (c: Folder) => c.subtree_asset_count > 0 || c.subtree_folder_count > 0

  // 当前文件夹下的子文件夹
  const childFolders = folders.filter((c) => (c.parent_id || 0) === folderId)

  // 面包屑链：从当前 folderId 向上回溯到根
  const chain: Folder[] = []
  let cursor = folderId
  while (cursor) {
    const c = folders.find((x) => x.id === cursor)
    if (!c) break
    chain.unshift(c)
    cursor = c.parent_id || 0
  }

  const toggleSubscribe = async () => {
    try {
      const { subscribed: now } = await api.toggleSubscription('project', project.id)
      setSubscribed(now)
      message.success(now ? '已订阅项目更新' : '已取消订阅')
    } catch (e: any) {
      message.error(e.response?.data?.detail || '操作失败')
    }
  }

  const createFolder = async () => {
    if (!folderName.trim()) return
    setFolderSubmitting(true)
    try {
      await api.createFolder(project.id, folderName.trim(), folderId || null)
      message.success('已创建文件夹')
      setFolderName('')
      setFolderOpen(false)
      load()
    } catch (e: any) {
      message.error(e.response?.data?.detail || '创建失败')
    } finally {
      setFolderSubmitting(false)
    }
  }

  const moveAsset = async (assetId: number, targetFolderId: number) => {
    try {
      await api.moveAsset(assetId, targetFolderId)
      message.success('已移动')
      load()
    } catch (e: any) {
      message.error(e.response?.data?.detail || '移动失败')
    }
  }

  const moveFolder = async (folderToMoveId: number, targetFolderId: number) => {
    try {
      await api.updateFolder(folderToMoveId, { parent_id: targetFolderId })
      message.success('已移动文件夹')
      load()
    } catch (e: any) {
      message.error(e.response?.data?.detail || '移动失败')
    }
  }

  const renameFolder = async () => {
    if (!renameTarget || !renameName.trim()) return
    setRenameSubmitting(true)
    try {
      await api.updateFolder(renameTarget.id, { name: renameName.trim() })
      message.success('已重命名')
      setRenameTarget(null)
      setRenameName('')
      load()
    } catch (e: any) {
      message.error(e.response?.data?.detail || '重命名失败')
    } finally {
      setRenameSubmitting(false)
    }
  }

  // 删除确认文案：整个子树会删掉多少东西
  const deleteSummary = (c: Folder) => {
    const parts: string[] = []
    if (c.subtree_folder_count) parts.push(`${c.subtree_folder_count} 个子文件夹`)
    if (c.subtree_asset_count) parts.push(`${c.subtree_asset_count} 个资产`)
    return parts.join('、')
  }

  const removeFolder = async (target: Folder) => {
    try {
      await api.deleteFolder(target.id)
      message.success('文件夹已删除')
      setDeleteTarget(null)
      setDeleteInput('')
      load()
    } catch (e: any) {
      message.error(e.response?.data?.detail || '删除失败')
    }
  }

  // 子树里有资产或有子文件夹的，要输入名称二次确认（会一并删掉），空的直接删
  const requestDeleteFolder = (target: Folder) => {
    if (!needsConfirm(target)) {
      removeFolder(target)
      return
    }
    setDeleteTarget(target)
    setDeleteInput('')
  }

  const confirmDeleteFolder = async () => {
    if (!deleteTarget || deleteInput.trim() !== deleteTarget.name) return
    setDeleteSubmitting(true)
    try {
      await removeFolder(deleteTarget)
    } finally {
      setDeleteSubmitting(false)
    }
  }

  // 统一拖拽载荷：asset:1 / folder:2；同时把跟随光标的图标换成文件图标
  const startDrag = (e: DragEvent<HTMLElement>, key: string, payload: string) => {
    e.dataTransfer.setData('text/plain', payload)
    e.dataTransfer.effectAllowed = 'move'
    if (dragIconRef.current) e.dataTransfer.setDragImage(dragIconRef.current, 24, 24)
    setDraggingKey(key)
  }

  const endDrag = () => setDraggingKey(null)

  // 文件夹/面包屑段作为拖放目标：拖资产或文件夹到此处 = 移入该文件夹（0 = 根目录）
  const dropHandlers = (targetId: number) => ({
    onDragOver: (e: DragEvent<HTMLElement>) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setOverFolder(targetId)
    },
    onDragLeave: (e: DragEvent<HTMLElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) {
        setOverFolder((cur) => (cur === targetId ? null : cur))
      }
    },
    onDrop: (e: DragEvent<HTMLElement>) => {
      e.preventDefault()
      setOverFolder(null)
      const raw = e.dataTransfer.getData('text/plain')
      if (!raw) return
      const [kind, idStr] = raw.split(':')
      const id = Number(idStr)
      if (!id) return
      if (kind === 'asset') moveAsset(id, targetId)
      // 文件夹不能移入自己
      else if (kind === 'folder' && id !== targetId) moveFolder(id, targetId)
    },
  })

  const crumbStyle = (id: number): React.CSSProperties => ({
    cursor: 'pointer',
    padding: '2px 6px',
    borderRadius: 4,
    color: folderId === id ? '#1677ff' : undefined,
    fontWeight: folderId === id ? 600 : undefined,
    background: overFolder === id ? '#e6f4ff' : undefined,
  })

  return (
    <div>
      {/* 离屏渲染的拖拽跟随图标：拖卡片时显示为文件图标 */}
      <div
        ref={dragIconRef}
        style={{
          position: 'fixed',
          top: -1000,
          left: -1000,
          width: 52,
          height: 52,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#fff',
          border: '1px solid #1677ff',
          borderRadius: 8,
          color: '#1677ff',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        }}
      >
        <FileOutlined style={{ fontSize: 28 }} />
      </div>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Space align="center" size={12} wrap>
          <Link to="/">
            <ArrowLeftOutlined /> 返回
          </Link>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {project.name}
          </Typography.Title>
          {project.is_archived && <Tag>已归档</Tag>}
          {project.visibility === 'private' && <Tag color="orange">私有</Tag>}
          {project.github_repo_url && (
            <a href={project.github_repo_url} target="_blank" rel="noreferrer">
              <Tag icon={<GithubOutlined />}>GitHub</Tag>
            </a>
          )}
          {project.owner && (
            <Link to={userPath(project.owner)}>
              <Space size={6} align="center">
                <Avatar
                  size={22}
                  icon={<UserOutlined />}
                  src={project.owner.avatar_url || undefined}
                />
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  创建者 {project.owner.nickname || project.owner.username}
                </Typography.Text>
              </Space>
            </Link>
          )}
          <Space>
            <Button
              size="small"
              icon={<BellOutlined />}
              type={subscribed ? 'primary' : 'default'}
              onClick={toggleSubscribe}
            >
              {subscribed ? '已订阅' : '订阅'}
            </Button>
            {canEdit && (
              <Button
                size="small"
                icon={<EditOutlined />}
                onClick={() => navigate(`/projects/${project.id}/edit`)}
              >
                编辑项目
              </Button>
            )}
          </Space>
        </Space>
        {project.description && <Typography.Text type="secondary">{project.description}</Typography.Text>}

        <Space wrap>
          <Input.Search
            placeholder="搜索资产名 / 描述 / 标签 / 文件名 / 上传者"
            allowClear
            enterButton={<SearchOutlined />}
            style={{ width: 380 }}
            onSearch={setQ}
          />
          {isMember ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setUploadOpen(true)}>
              上传资产
            </Button>
          ) : (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              需要项目所有者邀请并同意后，才能上传资产
            </Typography.Text>
          )}
          {canManageFolder && (
            <Button
              icon={<FolderAddOutlined />}
              onClick={() => {
                setFolderName('')
                setFolderOpen(true)
              }}
            >
              新建文件夹
            </Button>
          )}
          <Button icon={<BarChartOutlined />} onClick={() => setRankOpen(true)}>
            贡献排行
          </Button>
        </Space>

        {/* 面包屑路径，如 /模型/角色；点击导航，拖资产到某段 = 移入该文件夹 */}
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
          <span {...dropHandlers(0)} onClick={() => setFolderId(0)} style={crumbStyle(0)}>
            <HomeOutlined style={{ marginRight: 4 }} />
            {project.name}
          </span>
          {chain.map((c) => (
            <span key={c.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ color: '#bbb' }}>/</span>
              <span {...dropHandlers(c.id)} onClick={() => setFolderId(c.id)} style={crumbStyle(c.id)}>
                {c.name}
              </span>
            </span>
          ))}
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 60 }}>
            <Spin />
          </div>
        ) : childFolders.length === 0 && assets.length === 0 ? (
          <Empty
            description={q ? '没有匹配的资产' : folderId === 0 ? '暂无内容' : '此文件夹为空'}
            style={{ marginTop: 60 }}
          />
        ) : (
          <Row gutter={[16, 16]}>
            {childFolders.map((c) => {
              const hovering = overFolder === c.id
              return (
                <Col xs={12} sm={8} lg={6} key={`folder-${c.id}`}>
                  <div
                    style={{
                      position: 'relative',
                      height: '100%',
                      opacity: draggingKey === `folder:${c.id}` ? 0.4 : 1,
                    }}
                  >
                    <div
                      {...dropHandlers(c.id)}
                      draggable={canManageFolder}
                      onDragStart={(e) => startDrag(e, `folder:${c.id}`, `folder:${c.id}`)}
                      onDragEnd={endDrag}
                      onClick={() => setFolderId(c.id)}
                      style={{ height: '100%', cursor: 'pointer' }}
                    >
                      <Card
                        hoverable
                        styles={{ body: { padding: 12 } }}
                        style={{ borderColor: hovering ? '#1677ff' : undefined }}
                        cover={
                          <div
                            style={{
                              height: 150,
                              position: 'relative',
                              background: hovering ? '#e6f4ff' : '#fffbe6',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: hovering ? '#1677ff' : '#f5b400',
                            }}
                          >
                            {hovering ? (
                              <FolderOpenOutlined style={{ fontSize: 52 }} />
                            ) : (
                              <FolderOutlined style={{ fontSize: 52 }} />
                            )}
                            {hovering && (
                              <div
                                style={{
                                  position: 'absolute',
                                  bottom: 8,
                                  left: 0,
                                  right: 0,
                                  textAlign: 'center',
                                  fontSize: 12,
                                  color: '#1677ff',
                                }}
                              >
                                释放以移入
                              </div>
                            )}
                          </div>
                        }
                      >
                        <Space direction="vertical" size={4} style={{ width: '100%' }}>
                          <Typography.Text strong ellipsis={{ tooltip: c.name }}>
                            {c.name}
                          </Typography.Text>
                          <Space size={4} wrap>
                            <Tag color="blue">{c.subtree_asset_count} 个资产</Tag>
                            {c.subtree_folder_count > 0 && (
                              <Tag color="purple">{c.subtree_folder_count} 个子文件夹</Tag>
                            )}
                          </Space>
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            {canManageFolder ? '点击进入 · 拖动可移入其他文件夹' : '点击进入'}
                          </Typography.Text>
                          <Space size={4}>
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                              <FolderOutlined /> 文件夹
                            </Typography.Text>
                          </Space>
                        </Space>
                      </Card>
                    </div>
                    {canManageFolder && (
                      <Dropdown
                        trigger={['click']}
                        menu={{
                          items: [
                            {
                              key: 'rename',
                              icon: <EditOutlined />,
                              label: '重命名',
                            },
                            {
                              key: 'delete',
                              icon: <DeleteOutlined />,
                              label: canDeleteFolder(c)
                                ? '删除文件夹'
                                : '删除文件夹（内有资产，仅项目创建者或高级管理员可删）',
                              danger: true,
                              disabled: !canDeleteFolder(c),
                            },
                          ],
                          onClick: ({ key, domEvent }) => {
                            domEvent.stopPropagation()
                            if (key === 'rename') {
                              setRenameTarget(c)
                              setRenameName(c.name)
                            } else if (key === 'delete') {
                              requestDeleteFolder(c)
                            }
                          },
                        }}
                      >
                        <Button
                          size="small"
                          type="text"
                          icon={<MoreOutlined />}
                          draggable={false}
                          style={{ position: 'absolute', bottom: 8, right: 8 }}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </Dropdown>
                    )}
                  </div>
                </Col>
              )
            })}
            {assets.map((a) => (
              <Col
                xs={24}
                sm={12}
                lg={6}
                key={a.id}
                style={{ opacity: draggingKey === `asset:${a.id}` ? 0.4 : 1 }}
              >
                <AssetCard
                  asset={a}
                  draggable={canMoveAsset(a)}
                  onDragStart={(e) => startDrag(e, `asset:${a.id}`, `asset:${a.id}`)}
                  onDragEnd={endDrag}
                />
              </Col>
            ))}
          </Row>
        )}

        <Card title="更新热力图">
          <Heatmap
            days={activity?.days || []}
            years={activity?.years || []}
            value={year}
            onChange={setYear}
          />
        </Card>
      </Space>

      <UploadAssetModal
        open={uploadOpen}
        projectId={project.id}
        categories={project.categories || []}
        folderId={folderId}
        onClose={() => setUploadOpen(false)}
        onSuccess={load}
      />

      <Modal
        title="新建文件夹"
        open={folderOpen}
        onOk={createFolder}
        onCancel={() => setFolderOpen(false)}
        confirmLoading={folderSubmitting}
        okText="创建"
        cancelText="取消"
      >
        <Input
          placeholder="文件夹名称，如：角色、场景、道具"
          value={folderName}
          onChange={(e) => setFolderName(e.target.value)}
          onPressEnter={createFolder}
          autoFocus
        />
      </Modal>

      {/* 重命名文件夹 */}
      <Modal
        title="重命名文件夹"
        open={!!renameTarget}
        onOk={renameFolder}
        onCancel={() => {
          setRenameTarget(null)
          setRenameName('')
        }}
        confirmLoading={renameSubmitting}
        okText="保存"
        cancelText="取消"
        okButtonProps={{ disabled: !renameName.trim() }}
      >
        <Input
          value={renameName}
          onChange={(e) => setRenameName(e.target.value)}
          onPressEnter={renameFolder}
          placeholder="文件夹名称"
          autoFocus
        />
      </Modal>

      {/* 删除文件夹：仅当文件夹内有资产时弹窗，需输入文件夹名称二次确认 */}
      <Modal
        title={`删除文件夹「${deleteTarget?.name ?? ''}」`}
        open={!!deleteTarget}
        onOk={confirmDeleteFolder}
        onCancel={() => {
          setDeleteTarget(null)
          setDeleteInput('')
        }}
        confirmLoading={deleteSubmitting}
        okText="删除"
        cancelText="取消"
        okButtonProps={{ danger: true, disabled: deleteInput.trim() !== deleteTarget?.name }}
      >
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Typography.Text type="danger">
            删除后，该文件夹连同其中的 {deleteTarget ? deleteSummary(deleteTarget) : ''}
            都会被一并永久删除，不可恢复。
          </Typography.Text>
          <Typography.Text type="secondary">
            请输入文件夹名称「{deleteTarget?.name}」以确认删除：
          </Typography.Text>
          <Input
            value={deleteInput}
            onChange={(e) => setDeleteInput(e.target.value)}
            placeholder={deleteTarget?.name}
            autoFocus
          />
        </Space>
      </Modal>

      {/* 贡献排行放在左侧抽屉里，不影响主体布局 */}
      <Drawer
        title="贡献排行"
        placement="left"
        width={340}
        open={rankOpen}
        onClose={() => setRankOpen(false)}
      >
        <Leaderboard
          items={rankItems}
          days={rankDays}
          onDaysChange={setRankDays}
          loading={rankLoading}
          emptyText="这段时间还没有贡献"
        />
      </Drawer>
    </div>
  )
}

/** 路由 /projects/:id（兼容旧链接） */
export default function ProjectDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [project, setProject] = useState<Project | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    api
      .getProject(Number(id))
      .then((p) => {
        if (!alive) return
        // 统一跳转到规范地址 /用户名/slug
        const canonical = projectPath(p)
        if (canonical !== `/projects/${p.id}`) navigate(canonical, { replace: true })
        else setProject(p)
      })
      .catch((e) => alive && setError(e.response?.data?.detail || '项目不存在'))
    return () => {
      alive = false
    }
  }, [id, navigate])

  if (error) return <Result status="404" title={error} />
  if (!project) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Spin size="large" />
      </div>
    )
  }
  return <ProjectDetailView project={project} />
}

/** 路由 /:username/:slug */
export function ProjectDetailBySlug() {
  const { username, slug } = useParams()
  const [project, setProject] = useState<Project | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setProject(null)
    setError(null)
    api
      .getProjectBySlug(String(username), String(slug))
      .then((p) => alive && setProject(p))
      .catch((e) => alive && setError(e.response?.data?.detail || '项目不存在'))
    return () => {
      alive = false
    }
  }, [username, slug])

  if (error) return <Result status="404" title={error} />
  if (!project) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Spin size="large" />
      </div>
    )
  }
  return <ProjectDetailView project={project} />
}
