# 艺库 ArtVault

面向游戏开发团队的美术资产管理与版本协作平台。绑定 GitHub 仓库，覆盖 **上传 → 分类 → 版本管理 → 在线预览 → 评论协作 → 下载分发** 全流程。

完整产品与技术规格见 [`docs/DESIGN.md`](docs/DESIGN.md)。

## 技术栈

| 层 | 选型 |
|---|---|
| 前端 | React 18 + Vite + TypeScript + Ant Design + Zustand + React Router + axios + three.js（3D 预览） |
| 后端 | Python 3.9+ + FastAPI + SQLAlchemy 2.0 + Pydantic v2 + JWT + bcrypt + pypinyin（项目 slug） |
| 数据库 | SQLite（开发，零配置） |
| 文件存储 | 本地磁盘 `server/uploads/` 或 **腾讯云 COS**（`cos-python-sdk-v5`，高级管理员在后台切换） |

## 目录结构

```
ArtVaultM/
├── docs/DESIGN.md        # 产品与技术规格
├── client/               # 前端（React + Vite + TS）
│   └── src/
│       ├── components/   # Layout / AssetCard / 上传弹窗 / 评论
│       ├── pages/        # Login / ProjectList / ProjectDetail / AssetDetail / Admin
│       ├── api.ts        # axios 封装 + API 方法
│       ├── store.ts      # zustand 登录态
│       └── types.ts      # 类型定义
└── server/               # 后端（FastAPI）
    ├── app/
    │   ├── main.py       # 入口 + 路由 + 静态文件挂载
    │   ├── models.py     # SQLAlchemy 模型
    │   ├── schemas.py    # Pydantic schema
    │   ├── serializers.py
    │   ├── core/security.py
    │   ├── services/storage.py
    │   └── api/          # auth / admin / projects / categories / assets / versions / comments
    ├── smoke_test.py     # 后端冒烟测试
    └── requirements.txt
```

## 快速开始

### 1. 启动后端（端口 130）

```bash
cd server
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt
.venv/Scripts/python -m uvicorn app.main:app --host 127.0.0.1 --port 130 --reload
```

首次启动会自动建表并创建一个默认管理员（**高级管理员**）：

| 用户名 | 密码 | 角色 |
|---|---|---|
| `admin` | `admin123` | 高级管理员 |

（登录后请尽快到「管理后台」修改/注册账号。）

### 2. 启动前端（端口 5173）

```bash
cd client
npm install --include=dev   # 注意 --include=dev，见下方说明
npm run dev
```

浏览器打开 http://localhost:5173 ，登录后即可使用。

### 3. 冒烟测试（可选）

```bash
cd server
.venv/Scripts/python smoke_test.py
```

## 注意事项

- **`--include=dev`**：若本机设置了 `NODE_ENV=production`，npm 会默认跳过 devDependencies，导致 vite/ts 缺失。安装时务必加 `--include=dev`。
- **Python 3.9**：依赖已固定到有 Windows cp39 预编译 wheel 的版本（`greenlet==3.0.3`、`bcrypt==4.0.1`）。
- 前端通过 Vite 代理把 `/api` 和 `/uploads` 转发到 `http://127.0.0.1:8000`，无需额外跨域配置。

## 当前进度

- ✅ M1 后端骨架 + 数据模型 + JWT 认证 + 管理员注册账号
- ✅ M2 项目/分类/资产/版本 CRUD + 文件上传下载 + 评论
- ✅ P0 前端：登录 / 项目列表 / 项目详情 / 资产详情 / 管理后台 / 个人设置
- ✅ 版本历史最新在上；评论可关联版本并按版本筛选
- ✅ 缩略图按版本独立存储（每个版本有自己的缩略图，详情页可切换预览）
- ✅ 项目编辑、项目归档
- ✅ 创建项目时可选「系统默认分类」或「自定义分类」
- ✅ 项目成员邀请（输入昵称实时搜索，**需对方同意后**才成为成员）
- ✅ 项目订阅 / 资产订阅 + 消息提醒中心（评论 / @提及 / 邀请 / 订阅更新）
- ✅ 评论 @ 提及（输入 @ 联想、正文高亮、被提及者收到消息）
- ✅ 版本历史显示各版本下载数；版本列表默认展示最新 4 个，可展开（容器固定 4 项高度、可滚动）
- ✅ 资产点赞、用户个人资料页（含 GitHub 主页）
- ✅ 上传文件 SHA256 哈希去重（同项目内同内容复用物理文件）
- ✅ 独立的**项目编辑页**与**资产编辑页**（资产关联为只读展示）
- ✅ 项目地址 `/{用户名}/{slug}`（中文转拼音）、资产地址 `/{用户名}/{slug}/{id}`
- ✅ 三级角色：成员 / 管理员 / **高级管理员**
- ✅ **在线预览**：图片、视频、音频、3D 模型（.gltf/.glb，three.js 旋转查看，单独分包按需加载）
- ✅ **腾讯云 COS 对象存储**：高级管理员在后台配置后，**资产文件、缩略图、头像**全部上传到桶内
  （`artvaultm/projects/…`、`artvaultm/thumbnails/…`、`artvaultm/avatars/…`）；
  下载与预览均签发临时链接，临时链接可设置 `Content-Disposition` 直接以附件下载
- ✅ **缩略图与头像自动压缩**：统一转成 WebP 并压到 10KB 以内（按质量迭代，必要时再缩尺寸）
- ✅ 项目卡片与详情展示**创建者头像与主页链接**；评论、版本、上传者、成员、后台用户列表等
  所有出现用户的地方都带头像
- ✅ 下载改为**浏览器原生直链**（不再用 XHR 取 blob），避免跨域访问 COS 被 CORS 拦截，大文件也不占内存
- ✅ 管理后台：用户管理（昵称/角色/启停）、全部项目管理（含私有项目）、对象存储配置

## 角色与权限

| 能力 | 成员 | 管理员 | 高级管理员 |
|---|---|---|---|
| 浏览公开项目 / 下载 / 评论 / 点赞 | ✅ | ✅ | ✅ |
| 上传资产（需先受邀加入项目） | ✅ | ✅ | ✅ |
| 编辑项目/资产 | 仅自己创建的 | 仅自己创建的 | **任意**（含后台入口） |
| 管理用户 | ✗ | 仅普通成员 | **所有人** |
| 调整用户角色 / 配置对象存储 | ✗ | ✗ | ✅ |
| 查看全部项目（含他人私有） | ✗ | 仅后台、**只读** | 后台、**可编辑** |

> 「我的项目」列表对所有角色一致：只显示自己创建或受邀加入的项目。

## 接口速查（前缀 `/api`）

| 分组 | 主要接口 |
|---|---|
| 认证 | `POST /auth/login` · `GET /auth/me` · `PATCH /auth/profile`（昵称/GitHub/头像）· `POST /auth/change-password` |
| 用户 | `GET /users/search?q=` · `GET /users/{id}`（个人资料） |
| 项目 | `POST/GET /projects` · `GET /projects/{id}` · `GET /projects/by-slug/{username}/{slug}` · `PATCH/DELETE /projects/{id}` |
| 项目成员 | `GET/POST /projects/{id}/members` · `DELETE /projects/{id}/members/{memberId}` |
| 邀请 | `GET /invitations` · `POST /invitations/{id}/accept` · `POST /invitations/{id}/decline` |
| 分类 | `GET/POST /projects/{id}/categories` · `PATCH/DELETE /categories/{id}` |
| 资产 | `GET/POST /projects/{id}/assets`（`q` 全局搜索）· `GET/PATCH/DELETE /assets/{id}` |
| 版本 | `GET/POST /assets/{id}/versions` · `GET /versions/{id}/download` · `DELETE /versions/{id}` |
| 预览 | `GET /versions/{id}/stream-token`（换取短期令牌）· `GET /versions/{id}/stream?t=` |
| 下载 | `GET /versions/{id}/download-url`（返回浏览器可直连的链接）· `GET /versions/{id}/download`（旧接口，保持兼容） |
| 点赞 | `POST /assets/{id}/like`（切换） |
| 资产关联 | `GET/POST /assets/{id}/relations` · `DELETE /relations/{id}` |
| 评论 | `GET/POST /assets/{id}/comments`（`version_id` 筛选）· `DELETE /comments/{id}` |
| 订阅 | `GET /subscriptions` · `POST /subscriptions/toggle` |
| 消息 | `GET /notifications` · `GET /notifications/unread-count` · `PATCH /notifications/{id}/read` · `POST /notifications/read-all` |
| 管理员 | `POST/GET /admin/users` · `PATCH /admin/users/{id}`（昵称/角色）· `PATCH /admin/users/{id}/status` · `GET /admin/projects`（含私有，带 `can_edit`） |
| 对象存储 | `GET/PUT /admin/storage-config` · `POST /admin/storage-config/test`（仅高级管理员） |

## 在线预览与下载

`<img>/<video>/<audio>` 无法携带 Authorization 头，因此预览走「短期令牌」：
前端先向 `stream-token` 换取一个**只对当前版本有效、10 分钟过期**的令牌，
再用它访问 `stream` 接口（不计入下载次数）。

**下载不走 XHR/blob**：`download-url` 返回一个可直连的链接（本地为带令牌的流地址、
COS 为签名 URL），由前端交给浏览器原生下载。原因是 COS 模式下 XHR 会跨域访问对象存储
而被 CORS 拦截，且大文件会被整份读进内存。

支持的格式：图片 `png/jpg/jpeg/gif/webp/bmp/svg/avif`；视频 `mp4/webm/mov/m4v/ogv`；
音频 `mp3/wav/ogg/m4a/flac/aac`；3D 模型 `gltf/glb`（three.js，按需加载）。其余格式回落到缩略图。

## 图片处理

上传的缩略图与头像统一由 Pillow 转成 **WebP 并压到 10KB 以内**：先按质量 82→20 迭代编码，
仍超标则把最长边减半再来一轮。

## 数据库迁移

项目未使用 Alembic。新表由 `Base.metadata.create_all` 自动创建；已存在的表新增列由
[main.py](server/app/main.py) 的 `ensure_columns()` 在启动时幂等 `ALTER TABLE` 补齐，
历史项目缺少的 slug 由 `backfill_slugs()` 按拼音补全。
