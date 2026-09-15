import type { ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
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
          <Route path="/users/:id" element={<UserProfile />} />
          <Route path="/admin" element={<Admin />} />
          {/* 项目规范地址：/用户名/项目slug（中文已转拼音） */}
          <Route path="/:username/:slug" element={<ProjectDetailBySlug />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
