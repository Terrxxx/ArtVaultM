import { useEffect, useRef, useState } from 'react'
import { Avatar, Button, Empty, Input, List, Popconfirm, Select, Space, Tag, Typography, message } from 'antd'
import { UserOutlined } from '@ant-design/icons'
import { api } from '../api'
import type { Comment, UserBrief, Version } from '../types'
import { useAuthStore } from '../store'

// 0 作为「全部版本 / 不指定版本」的哨兵值
const ALL = 0

/** 把正文里的 @提及 高亮显示 */
function renderContent(text: string) {
  const parts = text.split(/(@[^\s@，。,.!！?？、]+)/g)
  return parts.map((p, i) =>
    p.startsWith('@') ? (
      <Typography.Text key={i} style={{ color: '#6c5ce7', fontWeight: 500 }}>
        {p}
      </Typography.Text>
    ) : (
      <span key={i}>{p}</span>
    ),
  )
}

/** 带 @联想 的输入框 */
function MentionInput({
  value,
  onChange,
  rows = 3,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  rows?: number
  placeholder?: string
}) {
  const [options, setOptions] = useState<UserBrief[]>([])
  const [query, setQuery] = useState<string | null>(null)
  const timer = useRef<number | undefined>(undefined)

  const handleChange = (val: string) => {
    onChange(val)
    const m = val.match(/@([^\s@]*)$/)
    setQuery(m ? m[1] : null)
  }

  useEffect(() => {
    if (query === null) {
      setOptions([])
      return
    }
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(async () => {
      try {
        setOptions(await api.searchUsers(query))
      } catch {
        setOptions([])
      }
    }, 250)
    return () => window.clearTimeout(timer.current)
  }, [query])

  const insert = (u: UserBrief) => {
    const label = u.nickname || u.username
    onChange(value.replace(/@([^\s@]*)$/, `@${label} `))
    setQuery(null)
    setOptions([])
  }

  return (
    <div>
      <Input.TextArea
        rows={rows}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={placeholder}
      />
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        输入 @ 可以提及他人，被提及的人会收到消息
      </Typography.Text>
      {query !== null && options.length > 0 && (
        <List
          size="small"
          style={{ marginTop: 6, border: '1px solid #eee', borderRadius: 4, maxHeight: 180, overflow: 'auto' }}
          dataSource={options}
          renderItem={(u) => (
            <List.Item style={{ cursor: 'pointer', padding: '6px 10px' }} onClick={() => insert(u)}>
              <Space>
                <Avatar size="small" icon={<UserOutlined />} src={u.avatar_url || undefined} />
                {u.nickname || u.username}
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  @{u.username}
                </Typography.Text>
              </Space>
            </List.Item>
          )}
        />
      )}
    </div>
  )
}

interface Props {
  assetId: number
  versions: Version[]
}

export default function CommentSection({ assetId, versions }: Props) {
  const [comments, setComments] = useState<Comment[]>([])
  const [content, setContent] = useState('')
  const [filterVersion, setFilterVersion] = useState<number>(ALL)
  const [formVersion, setFormVersion] = useState<number>(ALL)
  const [replyTo, setReplyTo] = useState<number | null>(null)
  const [replyContent, setReplyContent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const user = useAuthStore((s) => s.user)

  const filterOptions = [
    { value: ALL, label: '全部版本' },
    ...versions.map((v) => ({ value: v.id, label: `v${v.version}` })),
  ]
  const formOptions = [
    { value: ALL, label: '不指定版本（对资产整体）' },
    ...versions.map((v) => ({ value: v.id, label: `v${v.version}` })),
  ]

  const load = async () => {
    try {
      setComments(await api.listComments(assetId, filterVersion === ALL ? undefined : filterVersion))
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId, filterVersion])

  const onFilterChange = (value: number) => {
    setFilterVersion(value)
    setFormVersion(value)
  }

  const onDelete = async (id: number) => {
    try {
      await api.deleteComment(id)
      load()
    } catch (e: any) {
      message.error(e.response?.data?.detail || '删除失败')
    }
  }

  const submit = async (parentId?: number) => {
    const text = parentId != null ? replyContent : content
    if (!text.trim()) return
    setSubmitting(true)
    try {
      if (parentId != null) {
        // 回复不传版本，后端自动跟随被回复评论的版本
        await api.addComment(assetId, text.trim(), parentId)
        setReplyContent('')
        setReplyTo(null)
      } else {
        await api.addComment(
          assetId,
          text.trim(),
          undefined,
          formVersion === ALL ? undefined : formVersion,
        )
        setContent('')
      }
      load()
    } catch (e: any) {
      message.error(e.response?.data?.detail || '评论失败')
    } finally {
      setSubmitting(false)
    }
  }

  const fmtTime = (t?: string) => (t ? new Date(t).toLocaleString() : '')

  const renderItem = (c: Comment) => {
    const replies = comments.filter((r) => r.parent_id === c.id)
    return (
      <div key={c.id} style={{ marginBottom: 14 }}>
        <Space align="start" style={{ width: '100%' }}>
          <Avatar size="small" icon={<UserOutlined />} src={c.user.avatar_url || undefined} />
          <div style={{ flex: 1 }}>
            <Space size={8} wrap>
              <Typography.Text strong>{c.user.nickname || c.user.username}</Typography.Text>
              {c.version != null && <Tag color="blue">v{c.version}</Tag>}
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {fmtTime(c.created_at)}
              </Typography.Text>
            </Space>
            <div>{renderContent(c.content)}</div>
            <Space size={4} style={{ marginTop: 4 }}>
              <Button type="link" size="small" onClick={() => { setReplyTo(c.id); setReplyContent('') }}>
                回复
              </Button>
              {user && (user.id === c.user.id || user.role === 'admin') && (
                <Popconfirm title="删除这条评论？" onConfirm={() => onDelete(c.id)}>
                  <Button type="link" size="small" danger>
                    删除
                  </Button>
                </Popconfirm>
              )}
            </Space>

            {(replies.length > 0 || replyTo === c.id) && (
              <div style={{ marginTop: 8, paddingLeft: 12, borderLeft: '2px solid #eee' }}>
                {replies.map((r) => (
                  <div key={r.id} style={{ marginBottom: 8 }}>
                    <Space size={8} wrap>
                      <Avatar size="small" icon={<UserOutlined />} src={r.user.avatar_url || undefined} />
                      <Typography.Text strong>{r.user.nickname || r.user.username}</Typography.Text>
                      {r.version != null && <Tag color="blue">v{r.version}</Tag>}
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {fmtTime(r.created_at)}
                      </Typography.Text>
                    </Space>
                    <div>{renderContent(r.content)}</div>
                  </div>
                ))}
                {replyTo === c.id && (
                  <div style={{ marginTop: 8 }}>
                    <MentionInput value={replyContent} onChange={setReplyContent} rows={2} placeholder="回复…" />
                    <Space style={{ marginTop: 6 }}>
                      <Button size="small" type="primary" loading={submitting} onClick={() => submit(c.id)}>
                        回复
                      </Button>
                      <Button size="small" onClick={() => setReplyTo(null)}>
                        取消
                      </Button>
                    </Space>
                  </div>
                )}
              </div>
            )}
          </div>
        </Space>
      </div>
    )
  }

  const ids = new Set(comments.map((c) => c.id))
  const roots = comments.filter((c) => !c.parent_id || !ids.has(c.parent_id))

  return (
    <div>
      <Space style={{ marginBottom: 16 }} wrap>
        <Typography.Text type="secondary">查看版本：</Typography.Text>
        <Select style={{ minWidth: 160 }} value={filterVersion} onChange={onFilterChange} options={filterOptions} />
      </Space>

      <div style={{ marginBottom: 20 }}>
        <MentionInput value={content} onChange={setContent} placeholder="写下你的评论…" />
        <Space style={{ marginTop: 8 }} wrap>
          <Select style={{ minWidth: 200 }} value={formVersion} onChange={setFormVersion} options={formOptions} />
          <Button type="primary" loading={submitting} onClick={() => submit()}>
            发表评论
          </Button>
        </Space>
      </div>

      {roots.length === 0 ? (
        <Empty
          description={filterVersion === ALL ? '暂无评论' : '该版本暂无评论'}
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      ) : (
        roots.map(renderItem)
      )}
    </div>
  )
}
