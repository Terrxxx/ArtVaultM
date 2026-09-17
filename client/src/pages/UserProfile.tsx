import { useCallback, useEffect, useState } from 'react'
import { Avatar, Card, Col, Empty, Pagination, Row, Space, Spin, Statistic, Tag, Typography } from 'antd'
import { GithubOutlined, UserOutlined } from '@ant-design/icons'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api'
import { fmtDay } from '../timefmt'
import type { ActivityResponse, UpdateItem, UserProfile } from '../types'
import AssetCard from '../components/AssetCard'
import Heatmap, { RECENT } from '../components/Heatmap'
import UpdateLog from '../components/UpdateLog'
import ArtSpin from '../components/ArtSpin'

// 成就一页放几个；成就多了左栏会很长，所以做成分页
const BADGES_PER_PAGE = 8

export default function UserProfilePage() {
  // 路由为 /{用户名}
  const { username } = useParams()
  const key = String(username)

  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [activity, setActivity] = useState<ActivityResponse | null>(null)
  const [year, setYear] = useState<string | number>(RECENT)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [updates, setUpdates] = useState<UpdateItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingUpdates, setLoadingUpdates] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // 成就栏一页 8 个，从第一页开始
  const [badgePage, setBadgePage] = useState(1)

  // 资料 + 热力图
  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    Promise.all([
      api.getUserProfileByUsername(key),
      api.getUserActivity(key, year).catch(() => null),
    ])
      .then(([p, act]) => {
        if (!alive) return
        setProfile(p)
        setActivity(act)
        setBadgePage(1)
      })
      .catch((e) => {
        if (alive) setError(e.response?.data?.detail || '用户不存在')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [key, year])

  // 更新日志：选中某天看当天，否则看最近若干条（最多 10 条）
  const loadUpdates = useCallback(async () => {
    setLoadingUpdates(true)
    try {
      const r = await api.getUserUpdates(key, selectedDate, 10)
      setUpdates(r.items)
    } catch {
      setUpdates([])
    } finally {
      setLoadingUpdates(false)
    }
  }, [key, selectedDate])

  useEffect(() => {
    loadUpdates()
  }, [loadUpdates])

  // 右栏要放热力图，让外层容器撑满屏幕（否则内容被 1200 卡住、没有侧边空间）
  useEffect(() => {
    document.body.classList.add('av-wide')
    return () => document.body.classList.remove('av-wide')
  }, [])

  if (loading) {
    return (
      <ArtSpin />
    )
  }
  if (error || !profile) {
    return <Empty description={error || '用户不存在'} style={{ marginTop: 80 }} />
  }

  const { user, stats, projects, badges } = profile

  // 成就分页：一页 8 个，页码越界时收敛回最后一页
  const badgePages = Math.max(1, Math.ceil(badges.length / BADGES_PER_PAGE))
  const currentPage = Math.min(badgePage, badgePages)
  const pageBadges = badges.slice(
    (currentPage - 1) * BADGES_PER_PAGE,
    currentPage * BADGES_PER_PAGE,
  )

  return (
    <div className="av-center-layout">
      {/* 左栏：成就（不做卡片底，直接浮在页面底色上） */}
      <div className="av-rail-left av-rail-plain">
        <Typography.Title level={5} style={{ marginTop: 0, marginBottom: 12 }}>
          成就
        </Typography.Title>
        {/* 窄屏时左栏会占满整行，这里跟着铺成多列；260px 的侧栏里只有一列 */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: 10,
          }}
        >
          {pageBadges.map((b) => (
            <div
              key={b.key}
              title={b.desc}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid var(--av-border)',
                background: b.unlocked ? 'var(--av-accent-bg)' : undefined,
                opacity: b.unlocked ? 1 : 0.5,
              }}
            >
              <span style={{ fontSize: 22, filter: b.unlocked ? undefined : 'grayscale(1)' }}>
                {b.icon}
              </span>
              <div style={{ minWidth: 0 }}>
                <Typography.Text strong={b.unlocked} style={{ fontSize: 13, display: 'block' }}>
                  {b.name}
                  {/* 隐藏成就解锁前后端不会返回，这里标一下让玩家知道自己挖到了彩蛋 */}
                  {b.hidden && (
                    <span className="av-shine" style={{ fontSize: 11, marginLeft: 6, fontWeight: 400 }}>
                      隐藏
                    </span>
                  )}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {b.unlocked
                    ? b.unlocked_at
                      ? `解锁于 ${fmtDay(b.unlocked_at)}`
                      : '已解锁'
                    : `${b.desc}（${b.value}/${b.target}）`}
                </Typography.Text>
              </div>
            </div>
          ))}
        </div>
        {badgePages > 1 && (
          <Pagination
            simple
            current={currentPage}
            pageSize={BADGES_PER_PAGE}
            total={badges.length}
            onChange={setBadgePage}
            style={{ marginTop: 12, justifyContent: 'center' }}
          />
        )}
      </div>

      {/* 主内容 */}
      <div className="av-center-main">
        <Space direction="vertical" size={20} style={{ width: '100%' }}>
          <Card>
            <Space size={24} align="center" wrap>
              <Avatar size={72} icon={<UserOutlined />} src={user.avatar_url || undefined} />
              <div>
                <Typography.Title level={4} style={{ margin: 0 }}>
                  {user.nickname || user.username}
                </Typography.Title>
                <Space size={12}>
                  <Typography.Text type="secondary">@{user.username}</Typography.Text>
                  {user.github_url && (
                    <a href={user.github_url} target="_blank" rel="noreferrer">
                      <GithubOutlined /> GitHub
                    </a>
                  )}
                </Space>
              </div>
              <Space size={40} style={{ marginLeft: 'auto' }}>
                <Statistic title="上传资产" value={stats.asset_count} />
                <Statistic title="涉及项目" value={stats.project_count} />
                <Statistic title="版本总数" value={stats.version_count} />
              </Space>
            </Space>
          </Card>

          <Card title="更新日志">
            <UpdateLog
              items={updates}
              date={selectedDate}
              onClearDate={() => setSelectedDate(null)}
              loading={loadingUpdates}
              showProject
            />
          </Card>

          {projects.length === 0 ? (
            <Empty description="这里还没有资产——要么还没传，要么是私有项目你看不到" style={{ marginTop: 40 }} />
          ) : (
            projects.map((p, idx) =>
              p.restricted ? (
                // 私有项目且访问者无权查看：只提示，不暴露项目名与资产
                <Card key={`restricted-${idx}`} size="small">
                  <Space size={8}>
                    <Tag>私有</Tag>
                    <Typography.Text type="secondary">该更新为私有仓库</Typography.Text>
                  </Space>
                </Card>
              ) : (
                <Card
                  key={p.project_id ?? idx}
                  title={
                    <Space size={10}>
                      {/* /projects/:id 会自动重定向到规范地址 */}
                      <Link to={`/projects/${p.project_id}`}>{p.project_name}</Link>
                      <Tag>{p.assets.length} 个资产</Tag>
                      {p.github_repo_url && (
                        <a href={p.github_repo_url} target="_blank" rel="noreferrer">
                          <GithubOutlined />
                        </a>
                      )}
                    </Space>
                  }
                >
                  <Row gutter={[16, 16]}>
                    {p.assets.map((a) => (
                      <Col xs={24} sm={12} lg={6} key={a.id}>
                        <AssetCard asset={a} />
                      </Col>
                    ))}
                  </Row>
                </Card>
              ),
            )
          )}
        </Space>
      </div>

      {/* 右栏：竖向热力图，和项目页一致 */}
      <div className="av-rail-right av-rail-plain">
        <Typography.Title level={5} style={{ marginTop: 0, marginBottom: 12 }}>
          更新热力图
        </Typography.Title>
        <Heatmap
          vertical
          days={activity?.days || []}
          years={activity?.years || []}
          today={activity?.today}
          value={year}
          onChange={(v) => {
            setYear(v)
            setSelectedDate(null)
          }}
          selectedDate={selectedDate}
          onSelectDay={(d) => setSelectedDate((prev) => (prev === d ? null : d))}
          loading={loading}
        />
      </div>
    </div>
  )
}
