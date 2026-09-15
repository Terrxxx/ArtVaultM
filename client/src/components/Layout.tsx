import { useEffect, useState } from 'react'
import { Avatar, Badge, Dropdown, Layout as AntLayout, Space } from 'antd'
import { BellOutlined, DatabaseOutlined, SettingOutlined, UserOutlined } from '@ant-design/icons'
import { Link, Outlet, useNavigate } from 'react-router-dom'
import { api, uploadUrl } from '../api'
import { isAdminLike } from '../types'
import { useAuthStore } from '../store'

export default function Layout() {
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const setUser = useAuthStore((s) => s.setUser)
  const navigate = useNavigate()
  const [unread, setUnread] = useState(0)
  const isAdmin = isAdminLike(user?.role)

  // 登录态是持久化的，角色/昵称可能已被管理员改动，进入应用时拉一次最新资料
  useEffect(() => {
    let alive = true
    api
      .me()
      .then((fresh) => {
        if (alive) setUser(fresh)
      })
      .catch(() => {
        /* 401 已由拦截器处理 */
      })
    return () => {
      alive = false
    }
  }, [setUser])

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const { count } = await api.unreadCount()
        if (alive) setUnread(count)
      } catch {
        /* ignore */
      }
    }
    load()
    const timer = setInterval(load, 30000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])

  return (
    <AntLayout style={{ minHeight: '100vh' }}>
      <AntLayout.Header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: '#fff',
          borderBottom: '1px solid #eee',
          paddingInline: 24,
          height: 56,
          lineHeight: '56px',
        }}
      >
        <Space size={28} align="center">
          <Link to="/" style={{ fontSize: 20, fontWeight: 700, color: '#6c5ce7' }}>
            <DatabaseOutlined /> 艺库{' '}
            <span style={{ fontSize: 13, fontWeight: 400, color: '#999' }}>ArtVault</span>
          </Link>
          <nav style={{ display: 'flex', gap: 20, fontSize: 15 }}>
            <Link to="/">项目</Link>
            {isAdmin && <Link to="/admin">管理后台</Link>}
          </nav>
        </Space>

        <Space size={20} align="center">
          <Link to="/notifications">
            <Badge count={unread} size="small">
              <BellOutlined style={{ fontSize: 18, color: '#555' }} />
            </Badge>
          </Link>

          <Dropdown
            menu={{
              items: [
                { key: 'profile', label: '我的资料', icon: <UserOutlined /> },
                { key: 'settings', label: '个人设置', icon: <SettingOutlined /> },
                { type: 'divider' },
                { key: 'logout', label: '退出登录' },
              ],
              onClick: ({ key }) => {
                if (key === 'profile' && user) navigate(`/users/${user.id}`)
                if (key === 'settings') navigate('/settings')
                if (key === 'logout') {
                  logout()
                  navigate('/login')
                }
              },
            }}
          >
            <Space style={{ cursor: 'pointer' }}>
              <Avatar size="small" icon={<UserOutlined />} src={uploadUrl(user?.avatar) || undefined} />
              <span>{user?.nickname || user?.username}</span>
            </Space>
          </Dropdown>
        </Space>
      </AntLayout.Header>

      <AntLayout.Content style={{ padding: 24, width: '100%', maxWidth: 1200, margin: '0 auto' }}>
        <Outlet />
      </AntLayout.Content>
    </AntLayout>
  )
}
