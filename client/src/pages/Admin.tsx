import { useCallback, useEffect, useState } from 'react'
import {
  Button,
  Form,
  Input,
  message,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { Link } from 'react-router-dom'
import { api, projectPath } from '../api'
import type { Project, User } from '../types'
import { useAuthStore } from '../store'

export default function Admin() {
  const me = useAuthStore((s) => s.user)

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        管理后台
      </Typography.Title>
      <Tabs
        items={[
          { key: 'users', label: '用户管理', children: <UserManager me={me} /> },
          { key: 'projects', label: '全部项目', children: <ProjectManager /> },
        ]}
      />
    </div>
  )
}

function UserManager({ me }: { me: User | null }) {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [editing, setEditing] = useState<User | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)
  const [form] = Form.useForm()
  const [editForm] = Form.useForm()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setUsers(await api.listUsers())
    } catch (e: any) {
      message.error(e.response?.data?.detail || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const onCreate = async (values: any) => {
    setSubmitting(true)
    try {
      await api.createUser(values)
      message.success('创建成功')
      setOpen(false)
      form.resetFields()
      load()
    } catch (e: any) {
      message.error(e.response?.data?.detail || '创建失败')
    } finally {
      setSubmitting(false)
    }
  }

  const toggleStatus = async (u: User) => {
    try {
      await api.setUserStatus(u.id, u.status === 'active' ? 'disabled' : 'active')
      message.success('已更新')
      load()
    } catch (e: any) {
      message.error(e.response?.data?.detail || '操作失败')
    }
  }

  const changeRole = async (u: User, role: string) => {
    try {
      await api.updateUser(u.id, { role })
      message.success('角色已更新')
      load()
    } catch (e: any) {
      message.error(e.response?.data?.detail || '更新失败')
      load()
    }
  }

  const openEdit = (u: User) => {
    setEditing(u)
    editForm.setFieldsValue({ nickname: u.nickname, role: u.role })
  }

  const onSaveEdit = async (values: { nickname?: string; role?: string }) => {
    if (!editing) return
    setSavingEdit(true)
    try {
      await api.updateUser(editing.id, values)
      message.success('已更新')
      setEditing(null)
      load()
    } catch (e: any) {
      message.error(e.response?.data?.detail || '更新失败')
    } finally {
      setSavingEdit(false)
    }
  }

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    { title: '用户名', dataIndex: 'username' },
    { title: '昵称', dataIndex: 'nickname', render: (v: string) => v || '-' },
    {
      title: '角色',
      dataIndex: 'role',
      width: 140,
      render: (role: string, u: User) =>
        u.id === me?.id ? (
          <Tag color="purple">管理员（我）</Tag>
        ) : (
          <Select
            size="small"
            value={role}
            style={{ width: 110 }}
            onChange={(v) => changeRole(u, v)}
            options={[
              { value: 'member', label: '成员' },
              { value: 'admin', label: '管理员' },
            ]}
          />
        ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (v: string) => (v === 'active' ? <Tag color="green">正常</Tag> : <Tag color="red">已禁用</Tag>),
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      width: 170,
      render: (v: string) => (v ? new Date(v).toLocaleString() : '-'),
    },
    {
      title: '操作',
      key: 'action',
      render: (_: unknown, u: User) => (
        <Space>
          <Button type="link" size="small" style={{ padding: 0 }} onClick={() => openEdit(u)}>
            编辑
          </Button>
          {u.id === me?.id ? (
            <Typography.Text type="secondary">当前账号</Typography.Text>
          ) : (
            <Switch
              checked={u.status === 'active'}
              checkedChildren="启用"
              unCheckedChildren="禁用"
              onChange={() => toggleStatus(u)}
            />
          )}
        </Space>
      ),
    },
  ]

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
          注册账号
        </Button>
      </div>
      <Table rowKey="id" columns={columns} dataSource={users} loading={loading} pagination={false} />

      <Modal
        title="注册账号"
        open={open}
        onOk={() => form.submit()}
        onCancel={() => setOpen(false)}
        confirmLoading={submitting}
      >
        <Form form={form} layout="vertical" onFinish={onCreate} initialValues={{ role: 'member' }}>
          <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input placeholder="登录用户名" />
          </Form.Item>
          <Form.Item name="password" label="初始密码" rules={[{ required: true, min: 6, message: '至少 6 位' }]}>
            <Input.Password placeholder="初始密码" />
          </Form.Item>
          <Form.Item name="nickname" label="昵称">
            <Input placeholder="显示名称" />
          </Form.Item>
          <Form.Item name="role" label="角色">
            <Select
              options={[
                { value: 'member', label: '成员' },
                { value: 'admin', label: '管理员' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`编辑用户：${editing?.username ?? ''}`}
        open={!!editing}
        onOk={() => editForm.submit()}
        onCancel={() => setEditing(null)}
        confirmLoading={savingEdit}
      >
        <Form form={editForm} layout="vertical" onFinish={onSaveEdit}>
          <Form.Item name="nickname" label="昵称">
            <Input placeholder="显示名称" />
          </Form.Item>
          <Form.Item name="role" label="角色">
            <Select
              disabled={editing?.id === me?.id}
              options={[
                { value: 'member', label: '成员' },
                { value: 'admin', label: '管理员' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}

function ProjectManager() {
  const [projects, setProjects] = useState<Project[]>([])
  const [archived, setArchived] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setProjects(await api.listAllProjects(archived))
    } catch (e: any) {
      message.error(e.response?.data?.detail || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [archived])

  useEffect(() => {
    load()
  }, [load])

  const toggleArchive = async (p: Project) => {
    try {
      await api.updateProject(p.id, { is_archived: !p.is_archived })
      message.success('已更新')
      load()
    } catch (e: any) {
      message.error(e.response?.data?.detail || '操作失败')
    }
  }

  const remove = async (p: Project) => {
    try {
      await api.deleteProject(p.id)
      message.success('项目已删除')
      load()
    } catch (e: any) {
      message.error(e.response?.data?.detail || '删除失败')
    }
  }

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    {
      title: '项目',
      dataIndex: 'name',
      render: (_: string, p: Project) => <Link to={projectPath(p)}>{p.name}</Link>,
    },
    {
      title: '所有者',
      dataIndex: 'owner',
      width: 140,
      render: (o: Project['owner']) => (o ? o.nickname || o.username : '-'),
    },
    {
      title: '可见性',
      dataIndex: 'visibility',
      width: 90,
      render: (v: string) => (v === 'private' ? <Tag color="orange">私有</Tag> : <Tag>公开</Tag>),
    },
    { title: '资产', dataIndex: 'asset_count', width: 70 },
    {
      title: '状态',
      dataIndex: 'is_archived',
      width: 90,
      render: (v: boolean) => (v ? <Tag>已归档</Tag> : <Tag color="green">进行中</Tag>),
    },
    {
      title: '操作',
      key: 'action',
      width: 180,
      render: (_: unknown, p: Project) => (
        <Space>
          <Button type="link" size="small" style={{ padding: 0 }} onClick={() => toggleArchive(p)}>
            {p.is_archived ? '取消归档' : '归档'}
          </Button>
          <Popconfirm title="删除该项目？不可恢复" onConfirm={() => remove(p)}>
            <Button type="link" size="small" danger style={{ padding: 0 }} icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginBottom: 12 }}>
        <Select
          value={archived ? 'archived' : 'active'}
          style={{ width: 120 }}
          onChange={(v) => setArchived(v === 'archived')}
          options={[
            { value: 'active', label: '进行中' },
            { value: 'archived', label: '已归档' },
          ]}
        />
      </div>
      <Table rowKey="id" columns={columns} dataSource={projects} loading={loading} pagination={false} />
    </>
  )
}
