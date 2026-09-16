import { useCallback, useEffect, useState } from 'react'
import {
  Avatar,
  Button,
  Card,
  Col,
  Dropdown,
  Empty,
  Form,
  Input,
  message,
  Modal,
  Row,
  Segmented,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd'
import {
  EditOutlined,
  FolderOutlined,
  GithubOutlined,
  MoreOutlined,
  PlusOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { Link, useNavigate } from 'react-router-dom'
import { api, projectPath, userPath } from '../api'
import type { Project } from '../types'
import { useAuthStore } from '../store'

export default function ProjectList() {
  const [mine, setMine] = useState<Project[]>([])
  const [plaza, setPlaza] = useState<Project[]>([])
  const [archived, setArchived] = useState(false)
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [createForm] = Form.useForm()
  const navigate = useNavigate()
  const me = useAuthStore((s) => s.user)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [myProjects, hot] = await Promise.all([
        api.listProjects(archived),
        // 广场只展示进行中的公开项目，归档视图下不展示
        archived ? Promise.resolve([]) : api.listPlaza(6),
      ])
      setMine(myProjects)
      setPlaza(hot)
    } catch (e: any) {
      message.error(e.response?.data?.detail || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [archived])

  useEffect(() => {
    load()
  }, [load])

  const onCreate = async (values: any) => {
    setSubmitting(true)
    try {
      const p = await api.createProject(values)
      message.success('创建成功')
      setCreateOpen(false)
      createForm.resetFields()
      navigate(projectPath(p))
    } catch (e: any) {
      message.error(e.response?.data?.detail || '创建失败')
    } finally {
      setSubmitting(false)
    }
  }

  const isMine = (p: Project) => me?.role === 'admin' || p.owner_id === me?.id

  const renderCard = (p: Project) => (
    <Col xs={24} sm={12} lg={8} key={p.id}>
      <Card
        hoverable
        onClick={() => navigate(projectPath(p))}
        styles={{ body: { cursor: 'pointer' } }}
      >
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Space align="center" size={8} style={{ width: '100%' }}>
            <FolderOutlined style={{ fontSize: 22, color: 'var(--av-primary)' }} />
            <Typography.Text strong style={{ fontSize: 16, flex: 1 }}>
              {p.name}
            </Typography.Text>
            {p.visibility === 'private' && <Tag color="orange">私有</Tag>}
            {p.is_archived && <Tag>已归档</Tag>}
            {isMine(p) && (
              <Dropdown
                menu={{
                  items: [
                    { key: 'edit', label: '编辑项目', icon: <EditOutlined /> },
                  ],
                  onClick: ({ key, domEvent }) => {
                    domEvent.stopPropagation()
                    if (key === 'edit') navigate(`/projects/${p.id}/edit`)
                  },
                }}
                trigger={['click']}
              >
                <Button
                  type="text"
                  size="small"
                  icon={<MoreOutlined />}
                  onClick={(e) => e.stopPropagation()}
                />
              </Dropdown>
            )}
          </Space>
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            {p.description || '暂无描述'}
          </Typography.Text>
          {p.owner && (
            <Link to={userPath(p.owner)} onClick={(e) => e.stopPropagation()}>
              <Space size={6} align="center">
                <Avatar
                  size={20}
                  icon={<UserOutlined />}
                  src={p.owner.avatar_url || undefined}
                />
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  创建者 {p.owner.nickname || p.owner.username}
                </Typography.Text>
              </Space>
            </Link>
          )}
          <Space size={8} wrap>
            {typeof p.heat === 'number' && <Tag color="volcano">热度 {p.heat}</Tag>}
            <Tag>{p.asset_count} 个资产</Tag>
            <Tag>{p.category_count} 个分类</Tag>
            {p.member_count > 0 && <Tag color="blue">{p.member_count} 位成员</Tag>}
            {p.github_repo_url && (
              <Tag icon={<GithubOutlined />}>
                <a href={p.github_repo_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                  GitHub
                </a>
              </Tag>
            )}
          </Space>
        </Space>
      </Card>
    </Col>
  )

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <Space size={16}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            我的项目
          </Typography.Title>
          <Segmented
            value={archived ? 'archived' : 'active'}
            onChange={(v) => setArchived(v === 'archived')}
            options={[
              { label: '进行中', value: 'active' },
              { label: '已归档', value: 'archived' },
            ]}
          />
        </Space>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => {
            createForm.setFieldsValue({ visibility: 'public' })
            setCreateOpen(true)
          }}
        >
          新建项目
        </Button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 80 }}>
          <Spin size="large" />
        </div>
      ) : (
        <Space direction="vertical" size={28} style={{ width: '100%' }}>
          <div>
            {mine.length === 0 ? (
              <Empty
                description={archived ? '没有已归档的项目' : '还没有项目，点击右上角新建'}
                style={{ marginTop: 24, marginBottom: 24 }}
              />
            ) : (
              <Row gutter={[16, 16]}>{mine.map(renderCard)}</Row>
            )}
          </div>

          {plaza.length > 0 && (
            <div>
              <Typography.Title level={5} style={{ marginBottom: 12 }}>
                广场
                <Typography.Text
                  type="secondary"
                  style={{ fontSize: 12, fontWeight: 400, marginLeft: 8 }}
                >
                  按热度推荐公开项目
                </Typography.Text>
              </Typography.Title>
              <Row gutter={[16, 16]}>{plaza.map(renderCard)}</Row>
            </div>
          )}
        </Space>
      )}

      <Modal
        title="新建项目"
        open={createOpen}
        onOk={() => createForm.submit()}
        onCancel={() => setCreateOpen(false)}
        confirmLoading={submitting}
        width={560}
      >
        <Form
          form={createForm}
          layout="vertical"
          onFinish={onCreate}
          initialValues={{ visibility: 'public' }}
        >
          <Form.Item name="name" label="项目名称" rules={[{ required: true, message: '请输入项目名称' }]}>
            <Input placeholder="如：暗黑之魂" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} placeholder="项目简介" />
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
        </Form>
      </Modal>
    </div>
  )
}
