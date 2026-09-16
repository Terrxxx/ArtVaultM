import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Avatar, Badge, Button, Dropdown, Layout as AntLayout, Space } from 'antd'
import {
  BellOutlined,
  DatabaseOutlined,
  DesktopOutlined,
  GithubOutlined,
  MoonOutlined,
  SettingOutlined,
  SunOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { Link, Outlet, useNavigate } from 'react-router-dom'
import { api, userPath } from '../api'
import { isAdminLike } from '../types'
import { useAuthStore } from '../store'
import { useThemeStore } from '../theme'
import type { ThemeMode } from '../theme'

// 头部主题切换按钮：显示当前选中项对应的图标
const THEME_ICONS: Record<ThemeMode, ReactNode> = {
  light: <SunOutlined />,
  dark: <MoonOutlined />,
  system: <DesktopOutlined />,
}

export default function Layout() {
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const setUser = useAuthStore((s) => s.setUser)
  const themeMode = useThemeStore((s) => s.mode)
  const setThemeMode = useThemeStore((s) => s.setMode)
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
          background: 'var(--av-header-bg)',
          borderBottom: '1px solid var(--av-border)',
          paddingInline: 24,
          height: 56,
          lineHeight: '56px',
        }}
      >
        <Space size={28} align="center">
          <Link to="/" style={{ fontSize: 20, fontWeight: 700, color: 'var(--av-primary)' }}>
            <DatabaseOutlined /> 艺库{' '}
            <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--av-text-3)' }}>ArtVault</span>
          </Link>
          <a
            href="https://github.com/Terrxxx/ArtVaultM"
            target="_blank"
            rel="noreferrer"
            title="GitHub 仓库"
            style={{ fontSize: 20, color: 'var(--av-text-2)', lineHeight: 1 }}
          >
            <GithubOutlined />
          </a>
          <nav style={{ display: 'flex', gap: 20, fontSize: 15 }}>
            <Link to="/">项目</Link>
            {isAdmin && <Link to="/console">管理后台</Link>}
          </nav>
        </Space>

        <Space size={20} align="center">
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                { key: 'light', label: '白色', icon: <SunOutlined /> },
                { key: 'dark', label: '黑色', icon: <MoonOutlined /> },
                { key: 'system', label: '跟随系统', icon: <DesktopOutlined /> },
              ],
              selectable: true,
              selectedKeys: [themeMode],
              onClick: ({ key }) => setThemeMode(key as ThemeMode),
            }}
          >
            <Button type="text" title="界面风格" icon={THEME_ICONS[themeMode]} />
          </Dropdown>

          <Link to="/notifications">
            <Badge count={unread} size="small">
              <BellOutlined style={{ fontSize: 18, color: 'var(--av-text-2)' }} />
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
                if (key === 'profile' && user) navigate(userPath(user))
                if (key === 'settings') navigate('/settings')
                if (key === 'logout') {
                  logout()
                  navigate('/login')
                }
              },
            }}
          >
            <Space style={{ cursor: 'pointer' }}>
              <Avatar size="small" icon={<UserOutlined />} src={user?.avatar_url || undefined} />
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
