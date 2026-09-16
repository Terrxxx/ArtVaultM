import { useCallback, useEffect, useState } from 'react'
import {
  Avatar,
  Button,
  Card,
  Empty,
  Form,
  Input,
  List,
  message,
  Popconfirm,
  Result,
  Select,
  Space,
  Spin,
  Switch,
  Tabs,
  Tag,
  Typography,
} from 'antd'
import {
  ArrowLeftOutlined,
  DeleteOutlined,
  PlusOutlined,
  SearchOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, projectPath, userPath } from '../api'
import type { Category, Project, ProjectMember, UserBrief } from '../types'

export default function ProjectEdit() {
  const { id } = useParams()
  const projectId = Number(id)
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // 受控的页签：分类/成员操作后的重新加载不会把页面弹回「基本信息」
  const [activeTab, setActiveTab] = useState('basic')
  const [form] = Form.useForm()
  const navigate = useNavigate()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const p = await api.getProject(projectId)
      setProject(p)
      form.setFieldsValue({
        name: p.name,
        description: p.description,
        github_repo_url: p.github_repo_url,
        visibility: p.visibility,
      })
      setError(null)
    } catch (e: any) {
      setError(e.response?.data?.detail || '项目不存在')
    } finally {
      setLoading(false)
    }
  }, [projectId, form])

  useEffect(() => {
    load()
  }, [load])

  // 只有首次加载才铺满整页转圈；分类/成员操作后的刷新不再把整个页面拆掉重画
  if (loading && !project) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Spin size="large" />
      </div>
    )
  }
  if (error || !project) return <Result status="404" title={error || '项目不存在'} />

  // 读后端算好的能力字段
  const canEdit = project.can_edit
  if (!canEdit) return <Result status="403" title="只有项目创建者或高级管理员可以编辑该项目" />

  const onSaveBasic = async (values: any) => {
    setSaving(true)
    try {
      await api.updateProject(projectId, values)
      message.success('已保存')
      load()
    } catch (e: any) {
      message.error(e.response?.data?.detail || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const onDeleteProject = async () => {
    try {
      await api.deleteProject(projectId)
      message.success('项目已删除')
      navigate('/')
    } catch (e: any) {
      message.error(e.response?.data?.detail || '删除失败')
    }
  }

  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>
      <Space align="center" size={12} style={{ marginBottom: 16 }} wrap>
        <Link to={projectPath(project)}>
          <ArrowLeftOutlined /> 返回项目
        </Link>
        <Typography.Title level={4} style={{ margin: 0 }}>
          编辑项目 · {project.name}
        </Typography.Title>
        {project.visibility === 'private' && <Tag color="orange">私有</Tag>}
        {project.is_archived && <Tag>已归档</Tag>}
      </Space>

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: 'basic',
            label: '基本信息',
            children: (
              <Card>
                <Form form={form} layout="vertical" onFinish={onSaveBasic}>
                  <Form.Item name="name" label="项目名称" rules={[{ required: true, message: '请输入项目名称' }]}>
                    <Input />
                  </Form.Item>
                  <Form.Item name="description" label="描述">
                    <Input.TextArea rows={3} />
                  </Form.Item>
                  <Form.Item name="github_repo_url" label="GitHub 仓库地址">
                    <Input placeholder="https://github.com/owner/repo" />
                  </Form.Item>
                  <Form.Item name="visibility" label="可见性">
                    <Select
                      options={[
                        { value: 'public', label: '公开（所有登录用户可见）' },
                        { value: 'private', label: '私有（仅自己与项目成员可见）' },
                      ]}
                    />
                  </Form.Item>
                  <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
                    项目链接：/{project.owner?.username}/{project.slug}（链接不会随改名变化）
                  </Typography.Text>
                  <Button type="primary" htmlType="submit" loading={saving}>
                    保存
                  </Button>
                </Form>
              </Card>
            ),
          },
          {
            key: 'categories',
            label: `分类管理 (${project.categories?.length ?? 0})`,
            children: <CategoryManager projectId={projectId} categories={project.categories || []} onChanged={load} />,
          },
          {
            key: 'members',
            label: `成员管理 (${project.member_count})`,
            children: (
              <MemberManager
                projectId={projectId}
                members={project.members || []}
                pending={project.pending_members || []}
                onChanged={load}
              />
            ),
          },
          {
            key: 'danger',
            label: '归档与删除',
            children: (
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <Card title="归档">
                  <Space>
                    <Switch
                      checked={project.is_archived}
                      onChange={async (checked) => {
                        await api.updateProject(projectId, { is_archived: checked })
                        message.success(checked ? '已归档' : '已取消归档')
                        load()
                      }}
                    />
                    <Typography.Text type="secondary">
                      归档后项目默认不出现在列表里，可随时取消
                    </Typography.Text>
                  </Space>
                </Card>
                <Card title="删除项目">
                  <Space direction="vertical">
                    <Typography.Text type="secondary">
                      删除后项目下的资产、版本、评论都会一并移除，且无法恢复。
                    </Typography.Text>
                    <Popconfirm title="确定删除整个项目？此操作不可恢复" onConfirm={onDeleteProject}>
                      <Button danger icon={<DeleteOutlined />}>
                        删除项目
                      </Button>
                    </Popconfirm>
                  </Space>
                </Card>
              </Space>
            ),
          },
        ]}
      />
    </div>
  )
}

function CategoryManager({
  projectId,
  categories,
  onChanged,
}: {
  projectId: number
  categories: Category[]
  onChanged: () => void
}) {
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')

  const add = async () => {
    if (!newName.trim()) return
    try {
      await api.createCategory(projectId, newName.trim())
      setNewName('')
      message.success('已添加分类')
      onChanged()
    } catch (e: any) {
      message.error(e.response?.data?.detail || '添加失败')
    }
  }

  const rename = async (id: number) => {
    if (!editName.trim()) return
    try {
      await api.updateCategory(id, { name: editName.trim() })
      setEditingId(null)
      message.success('已重命名')
      onChanged()
    } catch (e: any) {
      message.error(e.response?.data?.detail || '重命名失败')
    }
  }

  const remove = async (id: number) => {
    try {
      await api.deleteCategory(id)
      message.success('已删除分类')
      onChanged()
    } catch (e: any) {
      message.error(e.response?.data?.detail || '删除失败')
    }
  }

  return (
    <Card>
      <Space style={{ marginBottom: 16 }}>
        <Input
          placeholder="新分类名称"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onPressEnter={add}
          style={{ width: 220 }}
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={add}>
          添加
        </Button>
      </Space>
      <List
        dataSource={categories}
        locale={{ emptyText: <Empty description="暂无分类" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
        renderItem={(c) => (
          <List.Item
            actions={[
              editingId === c.id ? (
                <Space key="edit">
                  <Button type="link" size="small" onClick={() => rename(c.id)}>
                    保存
                  </Button>
                  <Button type="link" size="small" onClick={() => setEditingId(null)}>
                    取消
                  </Button>
                </Space>
              ) : (
                <Button
                  key="ren"
                  type="link"
                  size="small"
                  onClick={() => {
                    setEditingId(c.id)
                    setEditName(c.name)
                  }}
                >
                  重命名
                </Button>
              ),
              <Popconfirm key="del" title="删除该分类？" onConfirm={() => remove(c.id)}>
                <Button type="link" size="small" danger>
                  删除
                </Button>
              </Popconfirm>,
            ]}
          >
            {editingId === c.id ? (
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onPressEnter={() => rename(c.id)}
                style={{ width: 220 }}
              />
            ) : (
              <Space size={8}>
                <Tag color={c.is_system ? 'geekblue' : 'green'}>{c.name}</Tag>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {c.asset_count} 个资产{c.is_system ? ' · 系统预置' : ''}
                </Typography.Text>
              </Space>
            )}
          </List.Item>
        )}
      />
    </Card>
  )
}

function MemberManager({
  projectId,
  members,
  pending,
  onChanged,
}: {
  projectId: number
  members: ProjectMember[]
  pending: ProjectMember[]
  onChanged: () => void
}) {
  const [keyword, setKeyword] = useState('')
  const [candidates, setCandidates] = useState<UserBrief[]>([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    if (!keyword.trim()) {
      setCandidates([])
      return
    }
    const t = setTimeout(async () => {
      setSearching(true)
      try {
        setCandidates(await api.searchUsers(keyword.trim()))
      } catch {
        setCandidates([])
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => clearTimeout(t)
  }, [keyword])

  const joined = new Set([...members, ...pending].map((m) => m.user?.id))

  const invite = async (u: UserBrief) => {
    try {
      await api.inviteMember(projectId, u.id)
      message.success(`已邀请 ${u.nickname || u.username}，等待对方同意`)
      onChanged()
    } catch (e: any) {
      message.error(e.response?.data?.detail || '邀请失败')
    }
  }

  const remove = async (memberId: number) => {
    try {
      await api.removeMember(projectId, memberId)
      message.success('已移除')
      onChanged()
    } catch (e: any) {
      message.error(e.response?.data?.detail || '移除失败')
    }
  }

  const renderUser = (m: ProjectMember) => (
    <List.Item
      key={m.id}
      actions={[
        <Popconfirm key="rm" title="移除该成员？" onConfirm={() => remove(m.id)}>
          <Button type="link" danger size="small">
            移除
          </Button>
        </Popconfirm>,
      ]}
    >
      <List.Item.Meta
        avatar={<Avatar size="small" icon={<UserOutlined />} src={m.user?.avatar_url || undefined} />}
        title={<Link to={userPath(m.user)}>{m.user?.nickname || m.user?.username}</Link>}
        description={`@${m.user?.username}`}
      />
    </List.Item>
  )

  return (
    <Space direction="vertical" size={20} style={{ width: '100%' }}>
      <Card title="邀请成员">
        <Input
          prefix={<SearchOutlined />}
          placeholder="输入用户昵称搜索"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          allowClear
        />
        {keyword.trim() && (
          <List
            size="small"
            loading={searching}
            dataSource={candidates}
            locale={{ emptyText: '没有匹配的用户' }}
            style={{ marginTop: 8 }}
            renderItem={(u) => (
              <List.Item
                actions={[
                  joined.has(u.id) ? (
                    <Typography.Text key="in" type="secondary">
                      已在项目中
                    </Typography.Text>
                  ) : (
                    <Button key="inv" type="link" size="small" onClick={() => invite(u)}>
                      邀请
                    </Button>
                  ),
                ]}
              >
                <List.Item.Meta
                  avatar={<Avatar size="small" icon={<UserOutlined />} src={u.avatar_url || undefined} />}
                  title={u.nickname || u.username}
                  description={`@${u.username}`}
                />
              </List.Item>
            )}
          />
        )}
      </Card>

      {pending.length > 0 && (
        <Card title={`待同意 (${pending.length})`}>
          <List dataSource={pending} renderItem={(m) => renderUser(m)} />
        </Card>
      )}

      <Card title={`正式成员 (${members.length})`}>
        <List
          dataSource={members}
          locale={{ emptyText: '暂无成员' }}
          renderItem={(m) => renderUser(m)}
        />
      </Card>
    </Space>
  )
}
