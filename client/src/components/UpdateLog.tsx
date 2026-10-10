import { Avatar, Button, Empty, Space, Tag, Typography } from 'antd'
import { ArrowRightOutlined, UserOutlined } from '@ant-design/icons'
import { Link } from 'react-router-dom'
import { userPath } from '../api'
import { fmtShort } from '../timefmt'
import type { UpdateItem, UserBrief } from '../types'
import ArtSpin from './ArtSpin'

/** 行为说明：v1 是这条资产第一次上传，之后都是新版本 */
function actionOf(it: UpdateItem): string {
  return it.version === 1 ? '新建资产' : '更新资产'
}

interface Group {
  key: number
  uploader: UserBrief | null
  items: UpdateItem[]
}

/**
 * 整条列表本身是时间倒序的，这里只把**紧挨着的同一个人的**几条并成一组，
 * 头像和用户名每组只出现一次；中间夹了别人的记录就另起一组，时间序不会被打乱。
 */
function groupByUploader(items: UpdateItem[]): Group[] {
  const groups: Group[] = []
  for (const it of items) {
    const uploader = it.uploader || null
    const last = groups[groups.length - 1]
    if (last && uploader && last.uploader && last.uploader.id === uploader.id) {
      last.items.push(it)
    } else {
      groups.push({ key: it.version_id, uploader, items: [it] })
    }
  }
  return groups
}

/** 一条更新：动作 + 资产名 + 资产类型 + 时间，右侧是版本号和跳转 */
function Entry({ it, showProject }: { it: UpdateItem; showProject: boolean }) {
  if (it.restricted) {
    // 私有项目：不暴露资产名与项目名
    return (
      <Space size={8} wrap>
        <Tag>私有</Tag>
        <Typography.Text type="secondary">该更新为私有仓库</Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {fmtShort(it.created_at)}
        </Typography.Text>
      </Space>
    )
  }

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Space size={8} wrap>
          {showProject && it.project_name && (
            <Typography.Text strong style={{ color: 'var(--av-primary)' }}>
              {it.project_name}
            </Typography.Text>
          )}
          <Tag>{actionOf(it)}</Tag>
          <Typography.Text strong>{it.asset_name || '资产'}</Typography.Text>
          {it.category_name && <Tag color="geekblue">{it.category_name}</Tag>}
        </Space>
        <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
          {fmtShort(it.created_at)}
        </Typography.Text>
      </div>
      <Space size={8} align="center">
        <Tag color="green">v{it.version}</Tag>
        <Link to={`/assets/${it.asset_id}`} title="查看资产">
          <Button size="small" icon={<ArrowRightOutlined />} />
        </Link>
      </Space>
    </div>
  )
}

interface Props {
  items: UpdateItem[]
  /** 当前只看某一天时，显示该日期并提供「查看全部」 */
  date?: string | null
  onClearDate?: () => void
  /** 右侧那个按钮的文案。项目页里它是退出当天视图、回资产列表，所以换个说法 */
  clearText?: string
  loading?: boolean
  /** 展示项目名（个人主页跨项目时有用） */
  showProject?: boolean
}

export default function UpdateLog({
  items,
  date,
  onClearDate,
  clearText = '查看全部',
  loading,
  showProject = false,
}: Props) {
  // 只有「只看某一天」时才需要这行（日期 + 查看全部）；平时的标题由外层 Card 提供，避免重复
  const title = date ? `${date} 的更新（${items.length}）` : null
  const groups = groupByUploader(items)

  return (
    <div>
      {title && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 8,
          }}
        >
          <Typography.Text strong>{title}</Typography.Text>
          <Button type="link" size="small" onClick={onClearDate}>
            {clearText}
          </Button>
        </div>
      )}

      {loading ? (
        <ArtSpin padding={40} />
      ) : groups.length === 0 ? (
        <Empty
          description={date ? '这一天风平浪静' : '还没有更新记录'}
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      ) : (
        <div>
          {groups.map((g, i) => (
            <div
              key={g.key}
              style={{
                display: 'flex',
                gap: 12,
                padding: '12px 0',
                borderTop: i ? '1px solid var(--av-border)' : undefined,
              }}
            >
              {/* 左栏只放头像：一组里重复的东西都省略掉 */}
              <div style={{ flexShrink: 0, paddingTop: 2 }}>
                {g.uploader ? (
                  <Link
                    to={userPath(g.uploader)}
                    title={g.uploader.nickname || g.uploader.username}
                  >
                    <Avatar
                      size={32}
                      icon={<UserOutlined />}
                      src={g.uploader.avatar_url || undefined}
                    />
                  </Link>
                ) : (
                  <Avatar size={32} icon={<UserOutlined />} />
                )}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <Space size={6} align="center" style={{ marginBottom: 6 }}>
                  {g.uploader && (
                    <Link to={userPath(g.uploader)}>
                      <Typography.Text strong>
                        {g.uploader.nickname || g.uploader.username}
                      </Typography.Text>
                    </Link>
                  )}
                  {g.items.length > 1 && (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {g.items.length} 次更新
                    </Typography.Text>
                  )}
                </Space>

                <Space direction="vertical" size={10} style={{ width: '100%' }}>
                  {g.items.map((it) => (
                    <Entry key={it.version_id} it={it} showProject={showProject} />
                  ))}
                </Space>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
