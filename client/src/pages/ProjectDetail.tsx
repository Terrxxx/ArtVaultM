import { useCallback, useEffect, useState } from 'react'
import {
  Avatar,
  Button,
  Card,
  Col,
  Drawer,
  Empty,
  Input,
  message,
  Result,
  Row,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd'
import {
  ArrowLeftOutlined,
  BarChartOutlined,
  BellOutlined,
  EditOutlined,
  GithubOutlined,
  PlusOutlined,
  SearchOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, projectPath, userPath } from '../api'
import type { ActivityResponse, Asset, Category, LeaderboardItem, Project } from '../types'
import { isSuperAdmin } from '../types'
import AssetCard from '../components/AssetCard'
import Heatmap, { RECENT } from '../components/Heatmap'
import Leaderboard from '../components/Leaderboard'
import UploadAssetModal from '../components/UploadAssetModal'
import { useAuthStore } from '../store'

function ProjectDetailView({ project: initial }: { project: Project }) {
  const [project, setProject] = useState(initial)
  const [assets, setAssets] = useState<Asset[]>([])
  const [categoryId, setCategoryId] = useState<number | undefined>()
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
  const me = useAuthStore((s) => s.user)
  const navigate = useNavigate()

  const categories: Category[] = project.categories || []

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [fresh, subs] = await Promise.all([
        api.getProject(project.id),
        api.listSubscriptions(),
      ])
      setProject(fresh)
      setSubscribed(subs.some((s) => s.target_type === 'project' && s.target_id === project.id))
      const params: Record<string, unknown> = {}
      if (categoryId) params.category_id = categoryId
      if (q) params.q = q
      setAssets(await api.listAssets(project.id, params))
    } catch (e: any) {
      message.error(e.response?.data?.detail || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [project.id, categoryId, q])

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

  const toggleSubscribe = async () => {
    try {
      const { subscribed: now } = await api.toggleSubscription('project', project.id)
      setSubscribed(now)
      message.success(now ? '已订阅项目更新' : '已取消订阅')
    } catch (e: any) {
      message.error(e.response?.data?.detail || '操作失败')
    }
  }

  return (
    <div>
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
          <Select
            style={{ minWidth: 160 }}
            allowClear
            placeholder="全部分类"
            value={categoryId}
            onChange={(v) => setCategoryId(v)}
            options={categories.map((c) => ({ value: c.id, label: c.name }))}
          />
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
          <Button icon={<BarChartOutlined />} onClick={() => setRankOpen(true)}>
            贡献排行
          </Button>
        </Space>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 60 }}>
            <Spin />
          </div>
        ) : assets.length === 0 ? (
          <Empty description={q ? '没有匹配的资产' : '暂无资产'} style={{ marginTop: 60 }} />
        ) : (
          <Row gutter={[16, 16]}>
            {assets.map((a) => (
              <Col xs={24} sm={12} lg={6} key={a.id}>
                <AssetCard asset={a} />
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
        categories={categories}
        onClose={() => setUploadOpen(false)}
        onSuccess={load}
      />

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
