import { useState } from 'react'
import { Button, Form, Input, Modal, Select, Space, Tag, Typography, Upload, message } from 'antd'
import type { UploadFile } from 'antd'
import { DeleteOutlined, InboxOutlined } from '@ant-design/icons'
import { api } from '../api'
import { clearUploadSession, needsChunkedUpload, uploadFileInChunks } from '../uploader'
import type { Category } from '../types'

const normFile = (e: any) => (Array.isArray(e) ? e : e?.fileList)

/** 文件名去掉扩展名，作为默认资产名 */
function defaultAssetName(filename: string): string {
  const i = filename.lastIndexOf('.')
  return i > 0 ? filename.slice(0, i) : filename
}

type RowStatus = 'pending' | 'uploading' | 'done' | 'error'

interface Row {
  uid: string
  file: File
  name: string
  status: RowStatus
  error?: string
  /** 大文件分片上传的进度 0~1 */
  progress?: number
}

interface Props {
  open: boolean
  projectId: number
  /** 可选的资产类型（声明用，可以留空） */
  categories: Category[]
  /** 上传到哪个文件夹（0 = 项目根目录），就是当前浏览到的目录 */
  folderId: number
  onClose: () => void
  onSuccess: () => void
}

export default function UploadAssetModal({
  open,
  projectId,
  categories,
  folderId,
  onClose,
  onSuccess,
}: Props) {
  const [form] = Form.useForm()
  const [rows, setRows] = useState<Row[]>([])
  // Upload 自己的文件列表要由我们托管：否则关掉弹窗后它内部还留着旧文件，
  // 再次打开时一选文件就会把上次取消的那些一起带回来
  const [fileList, setFileList] = useState<UploadFile[]>([])
  const [submitting, setSubmitting] = useState(false)

  // 只有一个文件时，才让填描述和单独传缩略图
  const single = rows.length === 1

  const close = () => {
    form.resetFields()
    setRows([])
    setFileList([])
    onClose()
  }

  // 选完文件后按 uid 保留已填的名字，去掉的文件直接丢掉
  const onFilesChange = (list: UploadFile[]) => {
    setFileList(list)
    setRows((prev) => {
      const byUid = new Map(prev.map((r) => [r.uid, r]))
      return list
        .filter((f) => f.originFileObj)
        .map(
          (f) =>
            byUid.get(f.uid) ?? {
              uid: f.uid,
              file: f.originFileObj as File,
              name: defaultAssetName(f.name || (f.originFileObj as File).name),
              status: 'pending' as const,
            },
        )
    })
  }

  /** 这一条不传了：文件列表和行一起摘掉 */
  const removeRow = (uid: string) => {
    setFileList((prev) => prev.filter((f) => f.uid !== uid))
    setRows((prev) => prev.filter((r) => r.uid !== uid))
  }

  const setName = (uid: string, name: string) =>
    setRows((prev) => prev.map((r) => (r.uid === uid ? { ...r, name } : r)))

  const onOk = async () => {
    const values = await form.validateFields()
    if (rows.length === 0) {
      message.warning('请先选择文件')
      return
    }
    if (rows.some((r) => !r.name.trim())) {
      message.warning('每个文件的资产名称都不能为空')
      return
    }

    setSubmitting(true)
    const next = rows.map((r) => ({ ...r }))
    let doneCount = 0

    for (let i = 0; i < next.length; i++) {
      if (next[i].status === 'done') {
        doneCount += 1
        continue
      }
      next[i] = { ...next[i], status: 'uploading', error: undefined, progress: undefined }
      const paint = () => setRows(next.map((r) => ({ ...r })))
      paint()

      const fd = new FormData()
      fd.append('project_id', String(projectId))
      // 落在当前所在目录，不需要用户选
      fd.append('folder_id', String(folderId))
      if (values.category_id) fd.append('category_id', String(values.category_id))
      if (values.tags) fd.append('tags', values.tags)
      if (values.changelog) fd.append('changelog', values.changelog)
      if (single && values.description) fd.append('description', values.description)
      fd.append('name', next[i].name.trim())
      const thumb = single ? values.thumbnail?.[0]?.originFileObj : null
      if (thumb) fd.append('thumbnail', thumb)

      try {
        // 大文件先分片传，传完把 upload_id 交给后端合并；小文件仍旧一次性 POST
        if (needsChunkedUpload(next[i].file)) {
          const uploadId = await uploadFileInChunks(next[i].file, projectId, (prog) => {
            next[i] = { ...next[i], progress: prog.ratio }
            paint()
          })
          fd.append('upload_id', uploadId)
        } else {
          fd.append('file', next[i].file)
        }
        await api.createAsset(fd)
        clearUploadSession(next[i].file)
        next[i] = { ...next[i], status: 'done', progress: undefined }
        doneCount += 1
      } catch (e: any) {
        next[i] = {
          ...next[i],
          status: 'error',
          error: e.response?.data?.detail || '上传失败',
        }
      }
      paint()
    }

    setSubmitting(false)
    onSuccess()

    if (doneCount === next.length) {
      message.success(next.length === 1 ? '上传成功' : `已上传 ${doneCount} 个资产`)
      close()
    } else {
      // 失败的留在弹窗里，改完可以直接重试（已成功的会跳过）
      message.warning(`成功 ${doneCount} 个，失败 ${next.length - doneCount} 个`)
    }
  }

  return (
    <Modal
      title="新建资产"
      open={open}
      onOk={onOk}
      onCancel={close}
      confirmLoading={submitting}
      okText={rows.length > 1 ? `上传 ${rows.length} 个` : '上传'}
      cancelText="取消"
      width={620}
    >
      <Form form={form} layout="vertical">
        <Form.Item name="category_id" label="资产类型">
          <Select
            allowClear
            placeholder="未分类"
            options={categories.map((c) => ({ value: c.id, label: c.name }))}
          />
        </Form.Item>

        {single && (
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} placeholder="资产说明" />
          </Form.Item>
        )}

        <Form.Item name="tags" label="标签（逗号分隔）">
          <Input placeholder="角色,主角" />
        </Form.Item>
        <Form.Item name="changelog" label="版本说明">
          <Input placeholder="初版" />
        </Form.Item>

        <Form.Item label="资产文件" extra="可一次选多个文件，每个文件生成一个资产">
          <Upload.Dragger
            multiple
            showUploadList={false}
            fileList={fileList}
            beforeUpload={() => false}
            onChange={({ fileList: list }) => onFilesChange(list)}
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">点击或拖拽文件到此处，支持一次选多个</p>
          </Upload.Dragger>
        </Form.Item>

        {rows.length > 0 && (
          <div style={{ maxHeight: 260, overflowY: 'auto', marginBottom: 16 }}>
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              {rows.map((r) => (
                // 窄屏放不下时让文件名换到下一行，别把名称输入框挤成一条缝
                <div
                  key={r.uid}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
                >
                  <Input
                    value={r.name}
                    onChange={(e) => setName(r.uid, e.target.value)}
                    placeholder="资产名称"
                    status={r.status === 'error' ? 'error' : undefined}
                    disabled={r.status === 'done' || submitting}
                    style={{ flex: '1 1 160px', minWidth: 0 }}
                  />
                  <Typography.Text
                    type="secondary"
                    style={{ fontSize: 12, flex: '0 1 auto', maxWidth: 160, textAlign: 'right' }}
                    ellipsis={{ tooltip: r.file.name }}
                  >
                    {r.file.name}
                  </Typography.Text>
                  <div style={{ width: 64, flexShrink: 0, textAlign: 'right' }}>
                    {r.status === 'uploading' && (
                      <Tag color="processing">
                        {r.progress != null ? `${Math.round(r.progress * 100)}%` : '上传中'}
                      </Tag>
                    )}
                    {r.status === 'done' && <Tag color="green">完成</Tag>}
                    {r.status === 'error' && (
                      <Tag color="red" title={r.error}>
                        失败
                      </Tag>
                    )}
                  </div>
                  {/* 已完成的留着（重试时跳过），不然「上传 N 个」的计数会对不上 */}
                  <Button
                    type="text"
                    size="small"
                    icon={<DeleteOutlined />}
                    title="这个不传了"
                    disabled={submitting || r.status === 'done'}
                    onClick={() => removeRow(r.uid)}
                  />
                </div>
              ))}
            </Space>
          </div>
        )}

        {single && (
          <Form.Item name="thumbnail" label="缩略图（可选）" valuePropName="fileList" getValueFromEvent={normFile}>
            <Upload beforeUpload={() => false} maxCount={1} listType="picture">
              <Button>选择图片</Button>
            </Upload>
          </Form.Item>
        )}
      </Form>
    </Modal>
  )
}
