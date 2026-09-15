import { useCallback, useEffect, useState } from 'react'
import {
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
  Tabs,
  Tag,
  Typography,
  Upload,
} from 'antd'
import { ArrowLeftOutlined, DeleteOutlined, UploadOutlined } from '@ant-design/icons'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, thumbUrl } from '../api'
import type { Asset, AssetRelation, Category } from '../types'
import { useAuthStore } from '../store'

const normFile = (e: any) => (Array.isArray(e) ? e : e?.fileList)

export default function AssetEdit() {
  const { id } = useParams()
  const assetId = Number(id)
  const [asset, setAsset] = useState<Asset | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [relations, setRelations] = useState<AssetRelation[]>([])
  const [siblings, setSiblings] = useState<Asset[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()
  const me = useAuthStore((s) => s.user)
  const navigate = useNavigate()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const a = await api.getAsset(assetId)
      setAsset(a)
      form.setFieldsValue({
        name: a.name,
        description: a.description,
        tags: a.tags?.join(',') ?? '',
        category_id: a.category_id,
      })
      const [cats, rels, sib] = await Promise.all([
        api.listCategories(a.project_id),
        api.listRelations(assetId),
        api.listAssets(a.project_id),
      ])
      setCategories(cats)
      setRelations(rels)
      setSiblings(sib.filter((x) => x.id !== assetId))
      setError(null)
    } catch (e: any) {
      setError(e.response?.data?.detail || '资产不存在')
    } finally {
      setLoading(false)
    }
  }, [assetId, form])

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
  if (error || !asset) return <Result status="404" title={error || '资产不存在'} />

  const canEdit = me?.role === 'admin' || asset.created_by === me?.id

  const onSave = async (values: any) => {
    const fd = new FormData()
    fd.append('name', values.name)
    if (values.description !== undefined) fd.append('description', values.description ?? '')
    if (values.tags !== undefined) fd.append('tags', values.tags ?? '')
    if (values.category_id) fd.append('category_id', String(values.category_id))
    const thumb = values.thumbnail?.[0]?.originFileObj
    if (thumb) fd.append('thumbnail', thumb)

    setSaving(true)
    try {
      await api.updateAsset(assetId, fd)
      message.success('已保存')
      form.setFieldValue('thumbnail', [])
      load()
    } catch (e: any) {
      message.error(e.response?.data?.detail || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const onDelete = async () => {
    try {
      await api.deleteAsset(assetId)
      message.success('资产已删除')
      // /projects/:id 会自动重定向到规范地址
      navigate(`/projects/${asset.project_id}`)
    } catch (e: any) {
      message.error(e.response?.data?.detail || '删除失败')
    }
  }

  const addRelation = async (toId: number) => {
    try {
      await api.addRelation(assetId, toId)
      message.success('已建立关联')
      load()
    } catch (e: any) {
      message.error(e.response?.data?.detail || '关联失败')
    }
  }

  const removeRelation = async (relId: number) => {
    try {
      await api.deleteRelation(relId)
      message.success('已解除关联')
      load()
    } catch (e: any) {
      message.error(e.response?.data?.detail || '解除失败')
    }
  }

  const cover = thumbUrl(asset.cover_thumbnail)

  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>
      <Space align="center" size={12} style={{ marginBottom: 16 }} wrap>
        <Link to={`/assets/${assetId}`}>
          <ArrowLeftOutlined /> 返回资产
        </Link>
        <Typography.Title level={4} style={{ margin: 0 }}>
          编辑资产 · {asset.name}
        </Typography.Title>
        {asset.category_name && <Tag color="geekblue">{asset.category_name}</Tag>}
      </Space>

      <Tabs
        items={[
          {
            key: 'basic',
            label: '基本信息',
            children: (
              <Card>
                <Form form={form} layout="vertical" onFinish={onSave} disabled={!canEdit}>
                  <Form.Item name="name" label="资产名称" rules={[{ required: true, message: '请输入资产名称' }]}>
                    <Input />
                  </Form.Item>
                  <Form.Item name="category_id" label="分类">
                    <Select options={categories.map((c) => ({ value: c.id, label: c.name }))} />
                  </Form.Item>
                  <Form.Item name="description" label="描述">
                    <Input.TextArea rows={3} />
                  </Form.Item>
                  <Form.Item name="tags" label="标签（逗号分隔）">
                    <Input placeholder="角色,主角" />
                  </Form.Item>
                  <Form.Item label="封面 / 缩略图">
                    <Space align="center" size={16}>
                      {cover ? (
                        <img
                          src={cover}
                          alt="cover"
                          style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 4, border: '1px solid #eee' }}
                        />
                      ) : (
                        <div
                          style={{
                            width: 72,
                            height: 72,
                            background: '#f5f5f5',
                            borderRadius: 4,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#ccc',
                            fontSize: 12,
                          }}
                        >
                          无图
                        </div>
                      )}
                      <Form.Item name="thumbnail" valuePropName="fileList" getValueFromEvent={normFile} noStyle>
                        <Upload beforeUpload={() => false} maxCount={1} accept="image/*">
                          <Button icon={<UploadOutlined />}>更换图片</Button>
                        </Upload>
                      </Form.Item>
                    </Space>
                  </Form.Item>
                  {canEdit && (
                    <Button type="primary" htmlType="submit" loading={saving}>
                      保存
                    </Button>
                  )}
                </Form>
              </Card>
            ),
          },
          {
            key: 'relations',
            label: `资产关联 (${relations.length})`,
            children: (
              <Card>
                {canEdit && siblings.length > 0 && (
                  <Select
                    showSearch
                    optionFilterProp="label"
                    placeholder="关联到本项目其他资产（如动画→模型）"
                    style={{ width: '100%', marginBottom: 16 }}
                    value={null}
                    options={siblings.map((s) => ({ value: s.id, label: s.name }))}
                    onSelect={(v: number | null) => {
                      if (v != null) addRelation(v)
                    }}
                  />
                )}
                <List
                  dataSource={relations}
                  locale={{ emptyText: <Empty description="暂无关联" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
                  renderItem={(r) => (
                    <List.Item
                      actions={
                        canEdit
                          ? [
                              <Popconfirm key="rm" title="解除关联？" onConfirm={() => removeRelation(r.id)}>
                                <Button type="link" danger size="small">
                                  解除
                                </Button>
                              </Popconfirm>,
                            ]
                          : []
                      }
                    >
                      <Link to={`/assets/${r.asset.id}`}>
                        {r.direction === 'in' ? '← ' : '→ '}
                        {r.asset.name}
                      </Link>
                    </List.Item>
                  )}
                />
              </Card>
            ),
          },
          {
            key: 'danger',
            label: '删除',
            children: (
              <Card title="删除资产">
                <Space direction="vertical">
                  <Typography.Text type="secondary">
                    删除后该资产的所有版本、文件、评论、点赞与关联都会一并移除，且无法恢复。
                  </Typography.Text>
                  {canEdit ? (
                    <Popconfirm title="确定删除该资产？此操作不可恢复" onConfirm={onDelete}>
                      <Button danger icon={<DeleteOutlined />}>
                        删除资产
                      </Button>
                    </Popconfirm>
                  ) : (
                    <Typography.Text type="secondary">只有资产上传者或管理员可以删除</Typography.Text>
                  )}
                </Space>
              </Card>
            ),
          },
        ]}
      />
    </div>
  )
}
