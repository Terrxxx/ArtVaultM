import axios from 'axios'
import { useAuthStore } from './store'
import type {
  ActivityResponse,
  AdminProject,
  Asset,
  AssetRelation,
  Category,
  Comment,
  DownloadStats,
  Invitation,
  LeaderboardResponse,
  Notification,
  Project,
  ProjectMember,
  StorageConfig,
  User,
  UserBrief,
  UserProfile,
  UpdateItem,
  Version,
} from './types'

const client = axios.create({ baseURL: '/api' })

client.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

client.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      useAuthStore.getState().logout()
    }
    return Promise.reject(err)
  },
)

export const api = {
  // ---------- 认证 ----------
  login: (username: string, password: string) =>
    client.post<{ access_token: string }>('/auth/login', { username, password }).then((r) => r.data),
  me: () => client.get<User>('/auth/me').then((r) => r.data),
  updateProfile: (form: FormData) => client.patch<User>('/auth/profile', form).then((r) => r.data),
  changePassword: (old_password: string, new_password: string) =>
    client.post('/auth/change-password', { old_password, new_password }).then((r) => r.data),

  // ---------- 项目 ----------
  listProjects: (archived = false) =>
    client.get<Project[]>('/projects', { params: { archived } }).then((r) => r.data),
  /** 广场：按热度值排序的公开项目（默认排除自己的，避免与「我的项目」重复） */
  listPlaza: (limit = 6, excludeOwn = true) =>
    client
      .get<Project[]>('/projects/plaza', { params: { limit, exclude_own: excludeOwn } })
      .then((r) => r.data),
  getProject: (id: number) => client.get<Project>(`/projects/${id}`).then((r) => r.data),
  getProjectActivity: (id: number, year?: number | string) =>
    client
      .get<ActivityResponse>(`/projects/${id}/activity`, {
        params: year != null ? { year } : {},
      })
      .then((r) => r.data),
  getProjectUpdates: (id: number, date?: string | null, limit = 20) =>
    client
      .get<{ date: string | null; items: UpdateItem[] }>(`/projects/${id}/updates`, {
        params: { ...(date ? { date } : {}), limit },
      })
      .then((r) => r.data),
  getUserActivity: (username: string, year?: number | string) =>
    client
      .get<ActivityResponse>(`/users/by-username/${username}/activity`, {
        params: year != null ? { year } : {},
      })
      .then((r) => r.data),
  getUserUpdates: (username: string, date?: string | null, limit = 20) =>
    client
      .get<{ date: string | null; items: UpdateItem[] }>(
        `/users/by-username/${username}/updates`,
        { params: { ...(date ? { date } : {}), limit } },
      )
      .then((r) => r.data),
  getProjectBySlug: (username: string, slug: string) =>
    client.get<Project>(`/projects/by-slug/${username}/${slug}`).then((r) => r.data),
  createProject: (data: {
    name: string
    description?: string
    github_repo_url?: string
    visibility: string
    category_mode: string
    custom_categories?: string[]
  }) => client.post<Project>('/projects', data).then((r) => r.data),
  updateProject: (id: number, data: Record<string, unknown>) =>
    client.patch<Project>(`/projects/${id}`, data).then((r) => r.data),
  deleteProject: (id: number) => client.delete(`/projects/${id}`).then((r) => r.data),

  // ---------- 项目成员 ----------
  listMembers: (projectId: number) =>
    client
      .get<{ members: ProjectMember[]; pending: ProjectMember[] }>(`/projects/${projectId}/members`)
      .then((r) => r.data),
  inviteMember: (projectId: number, userId: number) =>
    client.post(`/projects/${projectId}/members`, { user_id: userId }).then((r) => r.data),
  removeMember: (projectId: number, memberId: number) =>
    client.delete(`/projects/${projectId}/members/${memberId}`).then((r) => r.data),

  // ---------- 收到的邀请 ----------
  listInvitations: () => client.get<Invitation[]>('/invitations').then((r) => r.data),
  acceptInvitation: (memberId: number) =>
    client.post(`/invitations/${memberId}/accept`).then((r) => r.data),
  declineInvitation: (memberId: number) =>
    client.post(`/invitations/${memberId}/decline`).then((r) => r.data),

  // ---------- 用户 ----------
  searchUsers: (q: string) =>
    client.get<UserBrief[]>('/users/search', { params: { q } }).then((r) => r.data),
  getUserProfile: (id: number) => client.get<UserProfile>(`/users/${id}`).then((r) => r.data),
  getUserProfileByUsername: (username: string) =>
    client.get<UserProfile>(`/users/by-username/${username}`).then((r) => r.data),

  // ---------- 分类 ----------
  listCategories: (projectId: number) =>
    client.get<Category[]>(`/projects/${projectId}/categories`).then((r) => r.data),
  createCategory: (projectId: number, name: string) =>
    client.post<Category>(`/projects/${projectId}/categories`, { name }).then((r) => r.data),
  updateCategory: (categoryId: number, data: { name?: string; sort_order?: number }) =>
    client.patch<Category>(`/categories/${categoryId}`, data).then((r) => r.data),
  deleteCategory: (categoryId: number) =>
    client.delete(`/categories/${categoryId}`).then((r) => r.data),

  // ---------- 资产 ----------
  listAssets: (projectId: number, params?: Record<string, unknown>) =>
    client.get<Asset[]>(`/projects/${projectId}/assets`, { params }).then((r) => r.data),
  getAsset: (id: number) => client.get<Asset>(`/assets/${id}`).then((r) => r.data),
  createAsset: (form: FormData) => client.post<Asset>('/assets', form).then((r) => r.data),
  updateAsset: (id: number, form: FormData) =>
    client.patch<Asset>(`/assets/${id}`, form).then((r) => r.data),
  deleteAsset: (id: number) => client.delete(`/assets/${id}`).then((r) => r.data),

  // ---------- 版本 ----------
  listVersions: (assetId: number) =>
    client.get<Version[]>(`/assets/${assetId}/versions`).then((r) => r.data),
  uploadVersion: (assetId: number, form: FormData) =>
    client.post<Version>(`/assets/${assetId}/versions`, form).then((r) => r.data),
  deleteVersion: (versionId: number) =>
    client.delete(`/versions/${versionId}`).then((r) => r.data),
  downloadStats: (assetId: number) =>
    client.get<DownloadStats>(`/assets/${assetId}/download-stats`).then((r) => r.data),
  /** 预览用：换取某个版本的短期流式地址 */
  streamToken: (versionId: number) =>
    client
      .get<{ token: string; url: string; expires_in: number }>(`/versions/${versionId}/stream-token`)
      .then((r) => r.data),
  /** 下载直链：本地为带令牌的流地址，COS 为签名链接 */
  downloadUrl: (versionId: number) =>
    client
      .get<{ url: string; external: boolean }>(`/versions/${versionId}/download-url`)
      .then((r) => r.data),

  // ---------- 点赞 ----------
  toggleLike: (assetId: number) =>
    client.post<{ liked: boolean; like_count: number }>(`/assets/${assetId}/like`).then((r) => r.data),

  // ---------- 资产关联 ----------
  listRelations: (assetId: number) =>
    client.get<AssetRelation[]>(`/assets/${assetId}/relations`).then((r) => r.data),
  addRelation: (assetId: number, toAssetId: number, relationType = 'related') =>
    client
      .post(`/assets/${assetId}/relations`, { to_asset_id: toAssetId, relation_type: relationType })
      .then((r) => r.data),
  deleteRelation: (relationId: number) =>
    client.delete(`/relations/${relationId}`).then((r) => r.data),

  // ---------- 评论 ----------
  listComments: (assetId: number, versionId?: number) =>
    client
      .get<Comment[]>(`/assets/${assetId}/comments`, {
        params: versionId != null ? { version_id: versionId } : {},
      })
      .then((r) => r.data),
  addComment: (assetId: number, content: string, parent_id?: number, version_id?: number) =>
    client.post<Comment>(`/assets/${assetId}/comments`, { content, parent_id, version_id }).then((r) => r.data),
  deleteComment: (id: number) => client.delete(`/comments/${id}`).then((r) => r.data),

  // ---------- 订阅 ----------
  listSubscriptions: () =>
    client
      .get<{ id: number; target_type: string; target_id: number }[]>('/subscriptions')
      .then((r) => r.data),
  toggleSubscription: (target_type: 'project' | 'asset', target_id: number) =>
    client
      .post<{ subscribed: boolean }>('/subscriptions/toggle', { target_type, target_id })
      .then((r) => r.data),

  // ---------- 消息 ----------
  listNotifications: (unreadOnly = false) =>
    client.get<Notification[]>('/notifications', { params: { unread_only: unreadOnly } }).then((r) => r.data),
  unreadCount: () =>
    client.get<{ count: number }>('/notifications/unread-count').then((r) => r.data),
  markRead: (id: number) => client.patch(`/notifications/${id}/read`).then((r) => r.data),
  markAllRead: () => client.post('/notifications/read-all').then((r) => r.data),

  // ---------- 管理员 ----------
  listUsers: () => client.get<User[]>('/admin/users').then((r) => r.data),
  createUser: (data: { username: string; password: string; nickname?: string; role: string }) =>
    client.post<User>('/admin/users', data).then((r) => r.data),
  updateUser: (id: number, data: { nickname?: string; role?: string }) =>
    client.patch<User>(`/admin/users/${id}`, data).then((r) => r.data),
  setUserStatus: (id: number, status: string) =>
    client.patch<User>(`/admin/users/${id}/status`, { status }).then((r) => r.data),
  /** 软删除：仅打标记，不真删库 */
  deleteUser: (id: number) => client.delete<User>(`/admin/users/${id}`).then((r) => r.data),
  listAllProjects: (archived = false) =>
    client.get<AdminProject[]>('/admin/projects', { params: { archived } }).then((r) => r.data),

  // ---------- 排行榜 ----------
  /** 全局活跃榜：7/30/365 天内上传版本最多的用户 */
  getLeaderboard: (days = 30, limit = 10) =>
    client
      .get<LeaderboardResponse>('/leaderboard', { params: { days, limit } })
      .then((r) => r.data),
  getProjectLeaderboard: (projectId: number, days = 30, limit = 10) =>
    client
      .get<LeaderboardResponse>(`/projects/${projectId}/leaderboard`, {
        params: { days, limit },
      })
      .then((r) => r.data),

  // ---------- 对象存储配置（仅高级管理员） ----------
  getStorageConfig: () =>
    client.get<StorageConfig>('/admin/storage-config').then((r) => r.data),
  updateStorageConfig: (data: Partial<StorageConfig> & { cos_secret_key?: string }) =>
    client.put<StorageConfig>('/admin/storage-config', data).then((r) => r.data),
  testStorageConfig: () =>
    client.post<{ ok: boolean; message: string }>('/admin/storage-config/test').then((r) => r.data),
}

// 后端已在序列化时把存储路径解析成可访问 URL（本地 /uploads，COS 临时签名），
// 前端直接用 *_url 字段即可，无需再自行拼接。

/**
 * 触发浏览器原生下载。
 *
 * 不用 XHR/blob：COS 模式下文件在对象存储上，XHR 会因跨域被 CORS 拦截，
 * 且大文件会整份读进内存。这里只取直链交给浏览器，由它流式下载。
 */
export async function downloadVersion(versionId: number, filename: string) {
  const { url, external } = await api.downloadUrl(versionId)
  const a = document.createElement('a')
  a.href = url
  if (!external) a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/** 项目的规范路径：/用户名/项目slug（缺 slug 时回落到 /projects/{id}） */
export function projectPath(p: {
  id: number
  slug?: string | null
  owner?: UserBrief | null
}): string {
  if (p.owner?.username && p.slug) return `/${p.owner.username}/${p.slug}`
  return `/projects/${p.id}`
}

/** 用户主页路径：/用户名 */
export function userPath(u?: { username?: string | null } | null): string {
  return u?.username ? `/${u.username}` : '/'
}

/** 资产的规范路径：/用户名/项目slug/资产id */
export function assetPath(a: {
  id: number
  project_id: number
  project_slug?: string | null
  project_owner?: UserBrief | null
}): string {
  if (a.project_owner?.username && a.project_slug) {
    return `/${a.project_owner.username}/${a.project_slug}/${a.id}`
  }
  return `/assets/${a.id}`
}

export function formatSize(bytes?: number | null): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let n = bytes
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(1)} ${units[i]}`
}
