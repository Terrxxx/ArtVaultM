import { useEffect, useState } from 'react'
import { Avatar, Card, Col, Empty, Row, Space, Spin, Statistic, Tag, Typography, message } from 'antd'
import { GithubOutlined, UserOutlined } from '@ant-design/icons'
import { Link, useParams } from 'react-router-dom'
import { api, uploadUrl } from '../api'
import type { UserProfile } from '../types'
import AssetCard from '../components/AssetCard'

export default function UserProfilePage() {
  const { id } = useParams()
  const userId = Number(id)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    const load = async () => {
      setLoading(true)
      try {
        const p = await api.getUserProfile(userId)
        if (alive) setProfile(p)
      } catch (e: any) {
        message.error(e.response?.data?.detail || '加载失败')
      } finally {
        if (alive) setLoading(false)
      }
    }
    load()
    return () => {
      alive = false
    }
  }, [userId])

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Spin size="large" />
      </div>
    )
  }
  if (!profile) return <Empty />

  const { user, stats, projects } = profile

  return (
    <div>
      <Card style={{ marginBottom: 20 }}>
        <Space size={24} align="center" wrap>
          <Avatar size={72} icon={<UserOutlined />} src={uploadUrl(user.avatar) || undefined} />
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

      {projects.length === 0 ? (
        <Empty description="该用户还没有上传过资产" style={{ marginTop: 60 }} />
      ) : (
        <Space direction="vertical" size={20} style={{ width: '100%' }}>
          {projects.map((p) => (
            <Card
              key={p.project_id}
              title={
                <Space size={10}>
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
          ))}
        </Space>
      )}
    </div>
  )
}
