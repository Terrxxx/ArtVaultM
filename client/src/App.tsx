import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom'
import { Spin } from 'antd'
import Layout from './components/Layout'
import { api } from './api'
import Admin from './pages/Admin'
import AssetDetail from './pages/AssetDetail'
import AssetEdit from './pages/AssetEdit'
import Login from './pages/Login'
import Notifications from './pages/Notifications'
import ProjectDetail, { ProjectDetailBySlug } from './pages/ProjectDetail'
import ProjectEdit from './pages/ProjectEdit'
import ProjectList from './pages/ProjectList'
import Settings from './pages/Settings'
import UserProfile from './pages/UserProfile'
import { useAuthStore } from './store'

function RequireAuth({ children }: { children: ReactNode }) {
  const token = useAuthStore((s) => s.token)
  if (!token) return <Navigate to="/login" replace />
  return <>{children}</>
}

/** 兼容旧链接 /users/:id → 规范地址 /{用户名} */
function RedirectUserById() {
  const { id } = useParams()
  const [to, setTo] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    api
      .getUserProfile(Number(id))
      .then((p) => {
        if (alive) setTo(`/${p.user.username}`)
      })
      .catch(() => {
        if (alive) setTo('/')
      })
    return () => {
      alive = false
    }
  }, [id])

  if (!to) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Spin />
      </div>
    )
  }
  return <Navigate to={to} replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route path="/" element={<ProjectList />} />
          {/* 旧的 /projects/:id 会自动跳到规范地址 /用户名/slug */}
          <Route path="/projects/:id" element={<ProjectDetail />} />
          <Route path="/projects/:id/edit" element={<ProjectEdit />} />
          <Route path="/assets/:id" element={<AssetDetail />} />
          <Route path="/assets/:id/edit" element={<AssetEdit />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/users/:id" element={<RedirectUserById />} />
          <Route path="/admin" element={<Admin />} />
          {/* 规范地址：/用户名/项目slug（中文已转拼音） */}
          <Route path="/:username/:slug" element={<ProjectDetailBySlug />} />
          {/* 规范地址：/用户名/项目slug/资产id */}
          <Route path="/:username/:slug/:id" element={<AssetDetail />} />
          {/* 规范地址：/用户名（个人主页） */}
          <Route path="/:username" element={<UserProfile />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
