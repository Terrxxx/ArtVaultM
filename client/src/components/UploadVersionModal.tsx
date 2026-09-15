import { useState } from 'react'
import { Form, Input, Modal, Upload, message } from 'antd'
import { InboxOutlined } from '@ant-design/icons'
import { api } from '../api'

const normFile = (e: any) => (Array.isArray(e) ? e : e?.fileList)

interface Props {
  open: boolean
  assetId: number
  onClose: () => void
  onSuccess: () => void
}

export default function UploadVersionModal({ open, assetId, onClose, onSuccess }: Props) {
  const [form] = Form.useForm()
  const [submitting, setSubmitting] = useState(false)

  const onOk = async () => {
    const values = await form.validateFields()
    const fd = new FormData()
    fd.append('file', values.file[0].originFileObj)
    if (values.changelog) fd.append('changelog', values.changelog)

    setSubmitting(true)
    try {
      await api.uploadVersion(assetId, fd)
      message.success('新版本上传成功')
      form.resetFields()
      onSuccess()
      onClose()
    } catch (e: any) {
      message.error(e.response?.data?.detail || '上传失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal title="上传新版本" open={open} onOk={onOk} onCancel={onClose} confirmLoading={submitting}>
      <Form form={form} layout="vertical">
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
        <Form.Item name="changelog" label="版本说明">
          <Input.TextArea rows={2} placeholder="这一版改了什么" />
        </Form.Item>
      </Form>
    </Modal>
  )
}
