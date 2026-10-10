import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Avatar, Badge, Button, Dropdown, Grid, Layout as AntLayout, Space } from 'antd'
import {
  BellOutlined,
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
  // 窄屏（<768）收起文字：顶栏在手机上塞不下 logo 文字 + 昵称，留着会被压成竖排
  // （初值是 {}，所以用 === false 判断，免得宽屏首帧抖一下）
  const screens = Grid.useBreakpoint()
  const narrow = screens.md === false

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
          paddingInline: narrow ? 12 : 24,
          height: 56,
          lineHeight: '56px',
        }}
      >
        <Space size={narrow ? 14 : 28} align="center">
          <Link to="/" style={{ fontSize: 20, fontWeight: 700, color: 'var(--av-primary)' }}>
            {/* 内联而不是引用 /logo.svg：外链 SVG 继承不到 color，logo 就跟不了主题色了 */}
            <svg
              viewBox="64 64 896 896"
              width="1em"
              height="1em"
              fill="currentColor"
              aria-hidden="true"
              style={{ verticalAlign: '-0.125em' }}
            >
              <path d="M832 64H192c-17.7 0-32 14.3-32 32v832c0 17.7 14.3 32 32 32h640c17.7 0 32-14.3 32-32V96c0-17.7-14.3-32-32-32zm-600 72h560v208H232V136zm560 480H232V408h560v208zm0 272H232V680h560v208zM304 240a40 40 0 1080 0 40 40 0 10-80 0zm0 272a40 40 0 1080 0 40 40 0 10-80 0zm0 272a40 40 0 1080 0 40 40 0 10-80 0z" />
            </svg>
            {!narrow && (
              <>
                {' '}
                艺库{' '}
                <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--av-text-3)' }}>
                  ArtVault
                </span>
              </>
            )}
          </Link>
          <a
            href="https://github.com/Terrxxx/ArtVaultM"
            target="_blank"
            rel="noreferrer"
            title="GitHub 仓库"
            style={{ fontSize: 20, color: 'var(--av-text-2)', lineHeight: 1, flexShrink: 0 }}
          >
            <GithubOutlined />
          </a>
          {/* nowrap + 不收缩：flex 子项被压缩时文字会自己换行，手机上会变成竖排 */}
          <nav style={{ display: 'flex', gap: narrow ? 14 : 20, fontSize: 15, whiteSpace: 'nowrap', flexShrink: 0 }}>
            <Link to="/">项目</Link>
            {isAdmin && <Link to="/console">管理后台</Link>}
          </nav>
        </Space>

        <Space size={narrow ? 12 : 20} align="center" style={{ flexShrink: 0 }}>
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
              {!narrow && <span>{user?.nickname || user?.username}</span>}
            </Space>
          </Dropdown>
        </Space>
      </AntLayout.Header>

      {/* 宽度交给 index.css 的 .av-content：项目详情页会给自己挂 av-wide 撑满屏幕 */}
      <AntLayout.Content className="av-content">
        <Outlet />
      </AntLayout.Content>
    </AntLayout>
  )
}
