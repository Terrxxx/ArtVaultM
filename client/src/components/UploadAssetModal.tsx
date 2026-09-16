import { useEffect, useState } from 'react'
import { Button, Form, Input, Modal, Select, Upload, message } from 'antd'
import { InboxOutlined } from '@ant-design/icons'
import { api } from '../api'
import type { Category } from '../types'

const normFile = (e: any) => (Array.isArray(e) ? e : e?.fileList)

interface Props {
  open: boolean
  projectId: number
  categories: Category[]
  /** 当前所在文件夹（0 = 根目录），上传时预填 */
  defaultCategoryId?: number
  onClose: () => void
  onSuccess: () => void
}

export default function UploadAssetModal({
  open,
  projectId,
  categories,
  defaultCategoryId = 0,
  onClose,
  onSuccess,
}: Props) {
  const [form] = Form.useForm()
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      form.setFieldValue('category_id', defaultCategoryId)
    }
  }, [open, defaultCategoryId, form])

  const onOk = async () => {
    const values = await form.validateFields()
    const fd = new FormData()
    fd.append('project_id', String(projectId))
    fd.append('category_id', String(values.category_id ?? 0))
    fd.append('name', values.name)
    if (values.description) fd.append('description', values.description)
    if (values.tags) fd.append('tags', values.tags)
    if (values.changelog) fd.append('changelog', values.changelog)
    fd.append('file', values.file[0].originFileObj)
    if (values.thumbnail?.[0]?.originFileObj) fd.append('thumbnail', values.thumbnail[0].originFileObj)

    setSubmitting(true)
    try {
      await api.createAsset(fd)
      message.success('上传成功')
      form.resetFields()
      onSuccess()
      onClose()
    } catch (e: any) {
      message.error(e.response?.data?.detail || '上传失败')
    } finally {
      setSubmitting(false)
    }
  }

  const categoryOptions = [
    { value: 0, label: '根目录' },
    ...categories.map((c) => ({ value: c.id, label: c.name })),
  ]

  return (
    <Modal
      title="上传资产"
      open={open}
      onOk={onOk}
      onCancel={onClose}
      confirmLoading={submitting}
      width={560}
    >
      <Form form={form} layout="vertical">
        <Form.Item name="category_id" label="文件夹" rules={[{ required: true, message: '请选择文件夹' }]}>
          <Select placeholder="选择文件夹" options={categoryOptions} />
        </Form.Item>
        <Form.Item name="name" label="资产名称" rules={[{ required: true, message: '请输入资产名称' }]}>
          <Input placeholder="如：英雄模型" />
        </Form.Item>
        <Form.Item name="description" label="描述">
          <Input.TextArea rows={2} placeholder="资产说明" />
        </Form.Item>
        <Form.Item name="tags" label="标签（逗号分隔）">
          <Input placeholder="角色,主角" />
        </Form.Item>
        <Form.Item name="changelog" label="版本说明">
          <Input placeholder="初版" />
        </Form.Item>
        <Form.Item
          name="file"
          label="资产文件"
          rules={[{ required: true, message: '请选择文件' }]}
          valuePropName="fileList"
          getValueFromEvent={normFile}
        >
          <Upload.Dragger beforeUpload={() => false} maxCount={1}>
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">点击或拖拽文件到此处上传</p>
          </Upload.Dragger>
        </Form.Item>
        <Form.Item name="thumbnail" label="缩略图（可选）" valuePropName="fileList" getValueFromEvent={normFile}>
          <Upload beforeUpload={() => false} maxCount={1} listType="picture">
            <Button>选择图片</Button>
          </Upload>
        </Form.Item>
      </Form>
    </Modal>
  )
}
