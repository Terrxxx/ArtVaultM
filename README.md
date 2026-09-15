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
- ✅ 项目地址 `/{用户名}/{slug}`（中文转拼音）、资产地址 `/{用户名}/{slug}/{id}`、用户主页 `/{用户名}`
- ✅ 三级角色：成员 / 管理员 / **高级管理员**
- ✅ **在线预览**：图片、视频、音频、3D 模型（.gltf/.glb，three.js 旋转查看，单独分包按需加载）
- ✅ **腾讯云 COS 对象存储**：高级管理员在后台配置后，**资产文件、缩略图、头像**全部上传到桶内
  （`artvaultm/projects/…`、`artvaultm/thumbnails/…`、`artvaultm/avatars/…`）；
  下载与预览均签发临时链接，临时链接可设置 `Content-Disposition` 直接以附件下载
- ✅ **两档缩略图**：主图（最长边 512、<10KB WebP）用于预览与卡片；
  另有 **56×56 正方形小图**（约 0.4KB）专供版本历史这类列表，省流量也省内存
- ✅ 项目卡片与详情展示**创建者头像与主页链接**；评论、版本、上传者、成员、后台用户列表等
  所有出现用户的地方都带头像
- ✅ 下载改为**浏览器原生直链**（不再用 XHR 取 blob），避免跨域访问 COS 被 CORS 拦截，大文件也不占内存
- ✅ 主页**广场**：按热度值推荐 6 个公开项目（默认排除自己的项目，避免与「我的项目」重复）
- ✅ **更新热力图**：个人主页与项目主页各一张，GitHub 风格展示最近一年，
  右侧可切换到具体年份、点击某天可看当天全部更新（个人主页带更新日志列表）
- ✅ **排行榜**：主页「活跃排行」（全局用户按上传版本数）与项目页「贡献排行」（项目内成员），
  均可切换 **7 天 / 30 天 / 365 天**
- ✅ 管理后台：用户管理（昵称/角色/启停/软删除）、全部项目管理（含私有项目）、对象存储配置

## 热度值算法

「广场」按热度值排序，权重集中在 [stats.py](server/app/services/stats.py)：

```
热度 = 2 × 资产数 + 1 × 分类数 + 4 × log2(1 + 下载数) + 10 × 近30天新增版本数
```

- 下载数取 `log2` 是为了避免个别大项目刷榜
- 近 30 天更新权重最高，「热」体现在近期活跃
- 只统计**公开且未归档**的项目

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

## 前端路由一览

| 路径 | 页面 |
|---|---|
| `/` | 我的项目 + 广场 |
| `/{用户名}` | 用户个人主页（含更新热力图） |
| `/{用户名}/{slug}` | 项目主页 |
| `/{用户名}/{slug}/{id}` | 资产详情（在线预览 / 版本历史 / 评论） |
| `/projects/{id}` · `/projects/{id}/edit` | 旧链接重定向 · 项目编辑页 |
| `/assets/{id}` · `/assets/{id}/edit` | 资产页 · 资产编辑页 |
| `/console` | **管理后台**（用户管理 / 全部项目 / 对象存储） |
| `/settings` · `/notifications` · `/login` | 个人设置 · 消息 · 登录 |

> ⚠️ 管理后台用 `/console` 而不是 `/admin`：个人主页是 `/{用户名}`，
> 而默认管理员用户名正是 `admin`，占用 `/admin` 会让管理员自己的主页打不开。
>
> 同理，`login` / `settings` / `notifications` / `console` 这几个名字被列为**保留用户名**，
> 创建账号时会被拒绝，避免新用户的个人主页被同级静态路由挡住。
> 用户名还限制为字母、数字、下划线、短横线，长度 3–32 位。

## 接口速查（前缀 `/api`）

| 分组 | 主要接口 |
|---|---|
| 认证 | `POST /auth/login` · `GET /auth/me` · `PATCH /auth/profile`（昵称/GitHub/头像）· `POST /auth/change-password` |
| 用户 | `GET /users/search?q=` · `GET /users/by-username/{username}`（个人主页）· `.../activity`（热力图，可带 `year`）· `.../updates`（更新日志，可带 `date`）· `GET /users/{id}` |
| 排行榜 | `GET /leaderboard?days=7\|30\|365`（全局活跃榜）· `GET /projects/{id}/leaderboard?days=`（项目贡献榜） |
| 项目 | `POST/GET /projects` · `GET /projects/plaza`（广场热度榜）· `GET /projects/{id}/activity`（热力图）· `GET /projects/{id}` · `GET /projects/by-slug/{username}/{slug}` · `PATCH/DELETE /projects/{id}` |
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
| 管理员 | `POST/GET /admin/users` · `PATCH /admin/users/{id}`（昵称/角色）· `PATCH /admin/users/{id}/status` · `DELETE /admin/users/{id}`（软删除）· `GET /admin/projects`（含私有，带 `can_edit`） |
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

预览**不是自动播放**：版本历史里点「预览」才在弹窗中打开，内容限制在 `70vh` 以内。

## 图片处理

| 用途 | 规格 |
|---|---|
| **资产封面** | **保持原始尺寸**、只转成 WebP（quality 95，不做缩放/压缩） |
| 版本列表小图 | 该版本文件派生的 **42×42** WebP，约 80 字节 |
| 头像 | 最长边 512，WebP，压到 10KB 以内 |

作为封面/缩略图/头像上传的图片**上限 5MB**，超出返回 400。

**封面是资产级字段**：

- 创建资产时会用上传的缩略图作为封面；**没传缩略图但资产文件本身就是图片**时，直接用文件派生封面
- 上传新版本**不会**覆盖封面
- 在「编辑资产」里换封面只影响封面，不会动任何版本的缩略图

**版本列表的缩略图**显示的是**该版本自己的文件**（图片版本才有，自动派生，不用重复上传），
所以同一资产的不同图片版本会显示各自的画面。

> 「上传新版本」不再提供缩略图选项——图片版本会自动派生，非图片格式的预览则回落到资产封面。
> 后端接口仍保留可选的 `thumbnail` 字段（旧数据与 API 兼容）。

## 主页的可见性规则

别人看某个用户的个人主页时：

- **统计数字是完整的**（上传资产 / 涉及项目 / 版本总数），不因访问者权限而缩水
- **公开项目正常展示**（含其中的资产卡片）
- **私有项目**：若访问者不是所有者/成员，只显示一条「私有 · 该更新为私有仓库」占位，
  不暴露项目名与资产；更新日志里对应的记录同样只给占位
- **热力图**：按天的时间分布照常展示（与「统计完整」一致），点进某天看到的日志里私有部分仍是占位

同样地，全局「活跃排行」只统计访问者有权看到的项目，避免把别人私有项目里的活跃度暴露出来。

## 数据库迁移

项目未使用 Alembic。新表由 `Base.metadata.create_all` 自动创建；已存在的表新增列由
[main.py](server/app/main.py) 的 `ensure_columns()` 在启动时幂等 `ALTER TABLE` 补齐，
历史项目缺少的 slug 由 `backfill_slugs()` 按拼音补全。

## 删除用户是软删除
`DELETE /admin/users/{id}` **不会真的删库**，只在 `users.deleted_at` 打一个时间戳
（同时把 `status` 置为 `disabled`）。原因是资产、评论、版本等都外键引用用户，
真删会破坏历史数据的可读性。

标记后的效果：

- 无法登录（提示「该账号已被删除」）
- 不出现在用户搜索与项目成员候选里
- 个人主页 `/{用户名}` 视为不存在（404）
- 历史数据里仍能看到他上传的资产、评论等（名字与头像照常显示）
- 管理后台的用户列表仍会列出，状态显示「已删除」且不再提供操作

需要恢复的话，把 `deleted_at` 置空即可（目前没有做恢复入口，按需再加）。
