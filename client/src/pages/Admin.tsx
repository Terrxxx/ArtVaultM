import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Card,
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
import { Link, useNavigate } from 'react-router-dom'
import { api, projectPath } from '../api'
import type { AdminProject, StorageConfig, User } from '../types'
import { isSuperAdmin, ROLE_LABEL } from '../types'
import { useAuthStore } from '../store'

export default function Admin() {
  const me = useAuthStore((s) => s.user)
  const superAdmin = isSuperAdmin(me?.role)

  const tabs = [
    { key: 'users', label: '用户管理', children: <UserManager me={me} /> },
    { key: 'projects', label: '全部项目', children: <ProjectManager /> },
  ]
  if (superAdmin) {
    tabs.push({ key: 'storage', label: '对象存储', children: <StoragePanel /> })
  }

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        管理后台
      </Typography.Title>
      <Tabs items={tabs} />
    </div>
  )
}

function RoleTag({ role }: { role: string }) {
  if (role === 'super_admin') return <Tag color="purple">高级管理员</Tag>
  if (role === 'admin') return <Tag color="blue">管理员</Tag>
  return <Tag>成员</Tag>
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
  const superAdmin = isSuperAdmin(me?.role)

  /** 管理员只能管普通成员；高级管理员可管所有人（且不能改自己） */
  const manageable = (u: User) =>
    superAdmin ? u.id !== me?.id : u.role === 'member'

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
      width: 130,
      render: (role: string, u: User) => (
        <Space size={6}>
          <RoleTag role={role} />
          {u.id === me?.id && <Typography.Text type="secondary">(我)</Typography.Text>}
        </Space>
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
      render: (_: unknown, u: User) => {
        if (!manageable(u)) {
          return (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {u.id === me?.id ? '当前账号' : '无权修改'}
            </Typography.Text>
          )
        }
        return (
          <Space>
            <Button type="link" size="small" style={{ padding: 0 }} onClick={() => openEdit(u)}>
              编辑
            </Button>
            <Switch
              checked={u.status === 'active'}
              checkedChildren="启用"
              unCheckedChildren="禁用"
              onChange={() => toggleStatus(u)}
            />
          </Space>
        )
      },
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
                { value: 'admin', label: '管理员', disabled: !superAdmin },
                { value: 'super_admin', label: '高级管理员', disabled: !superAdmin },
              ]}
            />
          </Form.Item>
          {!superAdmin && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              只有高级管理员可以创建管理员账号
            </Typography.Text>
          )}
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
          <Form.Item
            name="role"
            label="角色"
            extra={!superAdmin ? '只有高级管理员可以调整角色' : undefined}
          >
            <Select
              disabled={!superAdmin}
              options={[
                { value: 'member', label: '成员' },
                { value: 'admin', label: '管理员' },
                { value: 'super_admin', label: '高级管理员' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}

function ProjectManager() {
  const [projects, setProjects] = useState<AdminProject[]>([])
  const [archived, setArchived] = useState(false)
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()
  const me = useAuthStore((s) => s.user)
  const superAdmin = isSuperAdmin(me?.role)

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

  const toggleArchive = async (p: AdminProject) => {
    try {
      await api.updateProject(p.id, { is_archived: !p.is_archived })
      message.success('已更新')
      load()
    } catch (e: any) {
      message.error(e.response?.data?.detail || '操作失败')
    }
  }

  const remove = async (p: AdminProject) => {
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
      render: (_: string, p: AdminProject) => <Link to={projectPath(p)}>{p.name}</Link>,
    },
    {
      title: '所有者',
      dataIndex: 'owner',
      width: 140,
      render: (o: AdminProject['owner']) => (o ? o.nickname || o.username : '-'),
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
      width: 200,
      render: (_: unknown, p: AdminProject) =>
        p.can_edit ? (
          <Space>
            <Button
              type="link"
              size="small"
              style={{ padding: 0 }}
              onClick={() => navigate(`/projects/${p.id}/edit`)}
            >
              编辑
            </Button>
            <Button type="link" size="small" style={{ padding: 0 }} onClick={() => toggleArchive(p)}>
              {p.is_archived ? '取消归档' : '归档'}
            </Button>
            <Popconfirm title="删除该项目？不可恢复" onConfirm={() => remove(p)}>
              <Button type="link" size="small" danger style={{ padding: 0 }} icon={<DeleteOutlined />}>
                删除
              </Button>
            </Popconfirm>
          </Space>
        ) : (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            只读（仅高级管理员可编辑）
          </Typography.Text>
        ),
    },
  ]

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
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
      {!superAdmin && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="管理员可以查看全部项目（含他人私有项目），但只有高级管理员可以编辑。"
        />
      )}
      <Table rowKey="id" columns={columns} dataSource={projects} loading={loading} pagination={false} />
    </>
  )
}

function StoragePanel() {
  const [cfg, setCfg] = useState<StorageConfig | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [form] = Form.useForm()

  const load = useCallback(async () => {
    try {
      const c = await api.getStorageConfig()
      setCfg(c)
      form.setFieldsValue({
        provider: c.provider,
        cos_secret_id: c.cos_secret_id,
        cos_secret_key: '',
        cos_region: c.cos_region,
        cos_bucket: c.cos_bucket,
        cos_app_id: c.cos_app_id,
        cos_prefix: c.cos_prefix,
      })
    } catch (e: any) {
      message.error(e.response?.data?.detail || '加载失败')
    }
  }, [form])

  useEffect(() => {
    load()
  }, [load])

  const provider = Form.useWatch('provider', form)

  const onSave = async (values: any) => {
    setSaving(true)
    try {
      const c = await api.updateStorageConfig(values)
      setCfg(c)
      form.setFieldValue('cos_secret_key', '')
      message.success('已保存')
    } catch (e: any) {
      message.error(e.response?.data?.detail || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const onTest = async () => {
    setTesting(true)
    try {
      const r = await api.testStorageConfig()
      r.ok ? message.success(r.message) : message.error(r.message)
    } catch (e: any) {
      message.error(e.response?.data?.detail || '测试失败')
    } finally {
      setTesting(false)
    }
  }

  return (
    <Card>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="启用后，新上传的资产文件会存到该 COS 桶的指定目录下；用户下载时由服务端签发临时链接，不会暴露永久密钥。"
        description="缩略图与头像仍保存在服务器本地（便于页面直接展示）。密钥不会明文回传，留空表示不修改。"
      />
      <Form
        form={form}
        layout="vertical"
        onFinish={onSave}
        initialValues={{ provider: 'local', cos_prefix: 'artvaultm' }}
        style={{ maxWidth: 560 }}
      >
        <Form.Item name="provider" label="存储方式">
          <Select
            options={[
              { value: 'local', label: '本地磁盘（默认）' },
              { value: 'cos', label: '腾讯云 COS 对象存储' },
            ]}
          />
        </Form.Item>
        {provider === 'cos' && (
          <>
            <Form.Item name="cos_secret_id" label="SecretId" rules={[{ required: true, message: '请填写 SecretId' }]}>
              <Input placeholder="AKID..." autoComplete="off" />
            </Form.Item>
            <Form.Item
              name="cos_secret_key"
              label="SecretKey"
              extra={cfg?.cos_secret_key_set ? '已保存过密钥，留空表示不修改' : '尚未设置密钥'}
            >
              <Input.Password placeholder={cfg?.cos_secret_key_set ? '••••••••（留空不修改）' : '请输入 SecretKey'} autoComplete="new-password" />
            </Form.Item>
            <Form.Item name="cos_region" label="地域 Region" rules={[{ required: true, message: '如 ap-guangzhou' }]}>
              <Input placeholder="ap-guangzhou" />
            </Form.Item>
            <Form.Item name="cos_bucket" label="存储桶 Bucket" rules={[{ required: true, message: '如 mybucket-1250000000' }]}>
              <Input placeholder="mybucket-1250000000" />
            </Form.Item>
            <Form.Item name="cos_app_id" label="APPID">
              <Input placeholder="1250000000" />
            </Form.Item>
            <Form.Item name="cos_prefix" label="存储目录" extra="资产文件会放在该目录下">
              <Input placeholder="artvaultm" addonBefore="/" />
            </Form.Item>
          </>
        )}
        <Space>
          <Button type="primary" htmlType="submit" loading={saving}>
            保存
          </Button>
          {provider === 'cos' && (
            <Button onClick={onTest} loading={testing}>
              测试连接
            </Button>
          )}
        </Space>
        {cfg?.updated_at && (
          <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 12 }}>
            上次更新：{new Date(cfg.updated_at).toLocaleString()}
          </Typography.Text>
        )}
      </Form>
    </Card>
  )
}
