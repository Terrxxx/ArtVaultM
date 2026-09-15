# ArtVault / 艺库 — 产品与技术规格

> 游戏美术资产管理器 · 客户端 Web + 服务端 Python
> 本文档为开发基准，所有功能以本文档为准。状态：**已敲定**

---

## 1. 项目概述

| 项 | 内容 |
|---|---|
| 英文名 | **ArtVault** |
| 中文名 | **艺库** |
| 定位 | 面向游戏开发团队的美术资产管理与版本协作平台 |
| 核心链路 | 上传 → 分类 → 版本管理 → 在线预览 → 评论协作 → 下载分发 |
| 关联 | 每个项目绑定一个 GitHub 仓库地址 |

---

## 2. 技术栈

| 层 | 选型 |
|---|---|
| 前端 | React 18 + Vite + TypeScript + Ant Design + Zustand + React Router v6 + axios |
| 3D 预览 | three.js（.gltf/.glb 在线旋转查看） |
| 后端 | Python 3.11 + FastAPI + SQLAlchemy 2.0 + Pydantic v2 + Alembic |
| 认证 | JWT（PyJWT）+ passlib(bcrypt) |
| 数据库 | SQLite（开发，零配置）→ PostgreSQL（生产，可平滑切换） |
| 文件存储 | 本地磁盘 + 结构化目录（预留 S3/OSS 抽象接口） |
| 部署 | Docker + docker-compose |

---

## 3. 角色与权限

| 角色 | 说明 | 权限 |
|---|---|---|
| **管理员 admin** | 后台注册的超级账号 | 注册/停用用户、管理所有项目、删除违规资产、查看审计日志 |
| **项目所有者 owner** | 创建项目的用户 | 管理项目设置、上传/编辑/删除资产、管理分类、邀请成员 |
| **普通成员 member** | 其他登录用户 | 浏览公开项目、在线预览、下载、评论、收藏、点赞 |

- 项目可见性：**公开**（所有登录用户可见，默认）/ **私有**（仅项目成员可见）。
- 上传权限：默认仅项目所有者 + 被授权的成员。

---

## 4. 数据模型

### User 用户
`id, username(唯一), password_hash, nickname, avatar, role(admin/owner/member), status(active/disabled), created_at`

### Project 项目
`id, name, description, github_repo_url, cover_url, visibility(public/private), owner_id, created_at`

### Category 分类
`id, project_id, name, sort_order, is_system(是否系统预置)`

### Asset 资产
`id, project_id, category_id, name, description, tags, cover_thumbnail, status, created_by, created_at`

### AssetVersion 资产版本
`id, asset_id, version(整型递增), file_path, file_name, file_size, file_format, changelog, uploader_id, is_latest, created_at`

### Comment 评论
`id, asset_id, user_id, parent_id(楼层回复), content, created_at`

### Favorite / Like / DownloadLog
- Favorite：`user_id, asset_id`
- Like：`user_id, asset_id`
- DownloadLog：`asset_version_id, user_id, created_at`

---

## 5. 系统分类（创建项目时自动生成）

| 分类 | 常见格式 |
|---|---|
| 模型 Models | .fbx .obj .gltf .glb .blend .3ds |
| 贴图与材质 Textures | .png .jpg .tga .psd .hdr |
| 动画 Animation | .fbx .anim |
| 特效 VFX | 粒子/序列帧 |
| 音频 Audio | .wav .mp3 .ogg |
| UI 与图标 UI/Icons | .png .svg |
| 场景 Scene | .unity .unreal .gltf |
| 概念设计 Concept Art | .psd .png |
| 其他 Other | 任意 |

所有者可增删改、自定义分类（系统分类可重命名/排序，保留几个默认兜底）。

---

## 6. 功能清单（按优先级）

### P0 — MVP（先做，跑通主链路）
1. 账号登录（JWT）、首次登录改密码
2. 管理员后台创建账号
3. 创建项目（绑定 GitHub 地址、可见性、封面）
4. 创建项目后自动生成系统分类
5. 上传资产（选分类、名称/描述/标签、文件、缩略图、版本说明）
6. 版本管理：同资产再上传自动 version+1，列表默认显示最新版，可下载任意历史版本
7. 资产列表浏览 + 分类筛选 + 关键词搜索

### P1 — 核心体验
8. 在线预览：图片大图、3D 模型(three.js)、视频、音频
9. 评论协作：评论 + 楼层回复 + @ 提及
10. 下载计数统计
11. 资产详情页（版本列表、changelog、切换下载）

### P2 — 扩展增强
12. 收藏 / 点赞
13. 用户个人主页（查看某用户上传的资产）
14. 项目活动动态
15. 通知系统（被评论 / 被 @）
16. 管理员后台：用户管理、项目审计、审计日志
17. 批量上传
18. GitHub 仓库信息卡片展示

---

## 7. 页面结构（客户端路由）

| 路由 | 页面 |
|---|---|
| `/login` | 登录 |
| `/` | 项目列表（资产墙） |
| `/projects/:id` | 项目主页：分类 + 资产墙 + 搜索筛选 |
| `/assets/:id` | 资产详情：预览 + 版本列表 + 下载 + 评论 |
| `/upload` | 上传资产 |
| `/users/:id` | 用户个人主页 |
| `/notifications` | 通知 |
| `/admin` | 管理员后台（用户管理 / 审计日志） |
| `/settings` | 个人设置（改密码等） |

---

## 8. API 概览（服务端，前缀 `/api`）

### 认证
- `POST /auth/login` · `GET /auth/me` · `POST /auth/change-password`

### 管理员
- `POST /admin/users`（创建账号）· `GET /admin/users` · `PATCH /admin/users/{id}/status` · `GET /admin/logs`

### 项目与分类
- `POST /projects` · `GET /projects` · `GET /projects/{id}` · `PATCH /projects/{id}` · `DELETE /projects/{id}`
- `GET /projects/{id}/categories` · `POST /projects/{id}/categories` · `PATCH /categories/{id}` · `DELETE /categories/{id}`

### 资产与版本
- `GET /projects/{id}/assets`（含筛选/搜索/分页）
- `POST /assets`（multipart 上传，创建资产 + 首个版本）
- `GET /assets/{id}` · `PATCH /assets/{id}` · `DELETE /assets/{id}`
- `POST /assets/{id}/versions`（上传新版本）
- `GET /assets/{id}/versions` · `GET /versions/{id}/download` · `DELETE /versions/{id}`

### 评论与社交
- `GET /assets/{id}/comments` · `POST /assets/{id}/comments` · `DELETE /comments/{id}`
- `POST /assets/{id}/favorite` · `POST /assets/{id}/like`（toggle）
- `GET /users/{id}` · `GET /notifications`

### 搜索
- `GET /search?q=&category=&tag=&format=&uploader=`

---

## 9. 文件存储布局

```
uploads/
  projects/{project_id}/assets/{asset_id}/v1/模型.fbx
                                            v2/模型.fbx
  thumbnails/{asset_id}.png
```

---

## 10. 目录结构

```
ArtVaultM/
├── docs/
│   └── DESIGN.md            # 本文档
├── client/                  # React + Vite + TS 前端
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── api/
│   │   ├── store/
│   │   └── main.tsx
│   └── package.json
├── server/                  # Python FastAPI 后端
│   ├── app/
│   │   ├── main.py
│   │   ├── config.py
│   │   ├── models/
│   │   ├── schemas/
│   │   ├── api/
│   │   ├── core/            # 认证/依赖
│   │   └── services/        # 文件/存储抽象
│   ├── uploads/             # 文件存储（gitignore）
│   ├── alembic/
│   └── requirements.txt
├── docker-compose.yml
└── README.md
```

---

## 11. 开发里程碑

| 阶段 | 内容 | 状态 |
|---|---|---|
| M1 | 后端骨架 + 数据模型 + 认证 + 用户注册 | 待开发 |
| M2 | 项目/分类/资产/版本 CRUD + 文件上传下载 | 待开发 |
| M3 | 前端骨架 + 登录 + 项目列表 + 资产墙 | 待开发 |
| M4 | 资产详情 + 版本切换 + 在线预览 | 待开发 |
| M5 | 评论 + 搜索筛选 + 下载统计 | 待开发 |
| M6 | 收藏/点赞/动态/通知/管理员后台/批量上传 | 待开发 |

---

## 12. 待后续确认（不影响开工）

- [ ] 3D 预览首版范围（仅 .gltf/.glb，.fbx 是否需要转换）
- [ ] 是否需要私有项目 + 成员邀请的完整权限模型（首版先做"公开项目"）
- [ ] 生产环境的 PostgreSQL 与对象存储是否首期接入
