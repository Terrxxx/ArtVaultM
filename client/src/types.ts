export interface UserBrief {
  id: number
  username: string
  nickname?: string | null
  avatar?: string | null
  github_url?: string | null
}

export interface User extends UserBrief {
  role: string
  status: string
  created_at: string
}

export interface Version {
  id: number
  asset_id: number
  version: number
  file_name: string
  file_size: number
  file_format?: string | null
  file_hash?: string | null
  thumbnail?: string | null
  changelog?: string | null
  is_latest: boolean
  download_count: number
  uploader?: UserBrief | null
  created_at?: string
}

export interface Category {
  id: number
  project_id: number
  name: string
  sort_order: number
  is_system: boolean
  asset_count: number
}

export interface Asset {
  id: number
  project_id: number
  category_id: number
  name: string
  description?: string | null
  tags: string[]
  cover_thumbnail?: string | null
  status: string
  created_by: number
  creator?: UserBrief | null
  category_name?: string | null
  project_name?: string | null
  project_slug?: string | null
  project_owner?: UserBrief | null
  created_at?: string
  version_count: number
  latest_version?: Version | null
  versions?: Version[]
  like_count: number
  liked_by_me: boolean
}

export interface ProjectMember {
  id: number
  user: UserBrief
  status: string
  created_at?: string
}

export interface Project {
  id: number
  name: string
  slug?: string | null
  description?: string | null
  github_repo_url?: string | null
  cover_url?: string | null
  visibility: string
  is_archived: boolean
  owner_id: number
  owner?: UserBrief | null
  created_at?: string
  asset_count: number
  category_count: number
  member_count: number
  pending_count: number
  categories?: Category[]
  members?: ProjectMember[]
  pending_members?: ProjectMember[]
}

export interface Invitation {
  member_id: number
  project: {
    id: number
    name: string
    slug?: string | null
    visibility: string
    owner?: UserBrief | null
  }
}

export interface Comment {
  id: number
  asset_id: number
  parent_id?: number | null
  version_id?: number | null
  version?: number | null
  content: string
  user: UserBrief
  created_at?: string
}

export interface Notification {
  id: number
  type: string
  is_read: boolean
  content?: string | null
  project_id?: number | null
  asset_id?: number | null
  comment_id?: number | null
  actor?: UserBrief | null
  created_at?: string
}

export interface AssetRelation {
  id: number
  relation_type: string
  direction: 'in' | 'out'
  asset: Asset
}

export interface DownloadStats {
  total: number
  by_version: { version: number; version_id: number; count: number }[]
  recent: { user: UserBrief; version: number; created_at?: string }[]
}

export interface UserProfile {
  user: UserBrief
  stats: { asset_count: number; project_count: number; version_count: number }
  projects: {
    project_id: number
    project_name: string
    github_repo_url?: string | null
    assets: Asset[]
  }[]
}

/** 管理后台项目列表项：多一个 can_edit 标记（仅高级管理员为 true） */
export interface AdminProject extends Project {
  can_edit?: boolean
}

export interface StorageConfig {
  provider: 'local' | 'cos'
  cos_secret_id?: string | null
  cos_secret_key_set: boolean
  cos_region?: string | null
  cos_bucket?: string | null
  cos_app_id?: string | null
  cos_prefix: string
  updated_at?: string | null
}

export type Role = 'member' | 'admin' | 'super_admin'

export const ROLE_LABEL: Record<string, string> = {
  member: '成员',
  admin: '管理员',
  super_admin: '高级管理员',
}

export function isSuperAdmin(role?: string | null): boolean {
  return role === 'super_admin'
}

export function isAdminLike(role?: string | null): boolean {
  return role === 'admin' || role === 'super_admin'
}
