import { useCallback, useEffect, useState } from 'react'
import { Avatar, Card, Col, Empty, Row, Space, Spin, Statistic, Tag, Typography } from 'antd'
import { GithubOutlined, UserOutlined } from '@ant-design/icons'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api'
import type { ActivityResponse, UpdateItem, UserProfile } from '../types'
import AssetCard from '../components/AssetCard'
import Heatmap, { RECENT } from '../components/Heatmap'
import UpdateLog from '../components/UpdateLog'

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

  // 更新日志：选中某天看当天，否则看最近若干条
  const loadUpdates = useCallback(async () => {
    setLoadingUpdates(true)
    try {
      const r = await api.getUserUpdates(key, selectedDate, 20)
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

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Spin size="large" />
      </div>
    )
  }
  if (error || !profile) {
    return <Empty description={error || '用户不存在'} style={{ marginTop: 80 }} />
  }

  const { user, stats, projects } = profile

  return (
    <div>
      <Card style={{ marginBottom: 20 }}>
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

      <Card title="更新热力图" style={{ marginBottom: 20 }}>
        <Heatmap
          days={activity?.days || []}
          years={activity?.years || []}
          value={year}
          onChange={(v) => {
            setYear(v)
            setSelectedDate(null)
          }}
          selectedDate={selectedDate}
          onSelectDay={(d) => setSelectedDate((prev) => (prev === d ? null : d))}
          loading={loading}
        />
        <div style={{ marginTop: 20, borderTop: '1px solid #f0f0f0', paddingTop: 16 }}>
          <UpdateLog
            items={updates}
            date={selectedDate}
            onClearDate={() => setSelectedDate(null)}
            loading={loadingUpdates}
            showProject
          />
        </div>
      </Card>

      {projects.length === 0 ? (
        <Empty description="该用户还没有上传过资产（或你没有查看权限）" style={{ marginTop: 40 }} />
      ) : (
        <Space direction="vertical" size={20} style={{ width: '100%' }}>
          {projects.map((p, idx) =>
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
          )}
        </Space>
      )}
    </div>
  )
}
