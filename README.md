# 艺库 ArtVault

> 游戏美术资产管理与版本协作平台 · **v0.1.0（测试版）**  
> 设计与实现：**Claude**（Anthropic）

小型开发团队的美术资产常常散落在网盘、群聊压缩包和本地磁盘里——同一个模型改到第 8 版，谁也说不清哪份是最新，也没人知道上周那张贴图是谁传的。**艺库**把这件事收拢到一处：登录后建项目、把项目和 GitHub 仓库关联、上传资产并用文件夹归类、同一资产换版本、在线预览、评论协作、下载分发。

后端 Python（FastAPI），前端 React，单机可跑，也支持腾讯云 COS 对象存储做文件托管。

---

## 目录

- [技术栈](#技术栈)
- [快速开始](#快速开始)
- [生产部署](#生产部署)
  - [1. 构建前端](#1-构建前端)
  - [2. 以服务方式运行后端](#2-以服务方式运行后端)
  - [3. Nginx 反向代理](#3-nginx-反向代理)
- [配置项](#配置项)
- [对象存储](#对象存储腾讯云-cos)
- [角色与权限](#角色与权限)
- [API 速览](#api-速览)
- [常见问题](#常见问题)
- [项目结构](#项目结构)

---

## 技术栈

| 层 | 选型 |
|---|---|
| 前端 | React 18 · Vite · TypeScript · Ant Design · Zustand · React Router · axios · three.js |
| 后端 | Python 3.9+ · FastAPI · SQLAlchemy 2.0 · Pydantic v2 · PyJWT · bcrypt |
| 数据库 | SQLite（默认，零配置）· 切换 PostgreSQL 只需改 `DATABASE_URL` |
| 文件存储 | 本地磁盘，或腾讯云 COS（`cos-python-sdk-v5`） |
| 图片处理 | Pillow（WebP 转换与压缩） |

---

## 快速开始

需要 **Python 3.9+** 与 **Node 18+**。

### 后端（默认端口 130）

```bash
cd server
python -m venv .venv

# Windows
.venv/Scripts/python -m pip install -r requirements.txt
# macOS / Linux
# .venv/bin/python -m pip install -r requirements.txt

.venv/Scripts/python -m uvicorn app.main:app --host 127.0.0.1 --port 130 --reload
```

首次启动会自动建表，并创建一个管理员账号：

| 用户名 | 密码 | 角色 |
|---|---|---|
| `admin` | `admin123` | 高级管理员 |

> ⚠️ 这是公开的默认口令，**部署到公网前务必修改**。

### 前端（默认端口 5173）

```bash
cd client
npm install --include=dev
npm run build
npx serve -s dist -l 5173
```

打开 http://localhost:5173 ，用 `admin` / `admin123` 登录。

> **为什么要加 `--include=dev`**：若环境变量 `NODE_ENV=production`，npm 会跳过 devDependencies，导致 vite / typescript 缺失、`npm run dev` 直接失败。

开发模式下 Vite 会把 `/api` 与 `/uploads` 代理到 `http://127.0.0.1:130`，前端无需额外跨域配置。

---

## 生产部署

整体拓扑：

```
                    ┌──────────────────────────────┐
   浏览器  ────────▶│  Nginx :80 / :443            │
                    │   /            → 前端静态文件 │
                    │   /api/        → 后端 :130    │
                    │   /uploads/    → 后端 :130    │
                    └──────────────┬───────────────┘
                                   │
                            ┌──────▼───────┐
                            │ uvicorn :130 │
                            └──────┬───────┘
                                   │
                      SQLite/Postgres + 本地磁盘或 COS
```

### 1. 构建前端

```bash
cd client
npm install --include=dev
npm run build
npx serve -s dist -l 5173
```

### 2. 运行后端

```bash
cd server
python -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/Scripts/python -m uvicorn app.main:app --host 127.0.0.1 --port 130 --reload
```

### 3. Nginx 反向代理

```nginx
server {
    listen      443 ssl;
    server_name example.com;

    ssl_certificate      path;      # SSL证书
    ssl_certificate_key  path;      # SSL证书
    ssl_session_cache    shared:SSL:1m;
    ssl_session_timeout  5m;
    ssl_ciphers ECDHE-RSA-AES128-GCM-SHA256:ECDHE:ECDH:AES:HIGH:!NULL:!aNULL:!MD5:!ADH:!RC4;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers  on;

    client_max_body_size 2048m;

    location / {
        proxy_pass         http://127.0.0.1:5173;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }

    location /api/ {
        proxy_pass         http://127.0.0.1:130;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;

        proxy_request_buffering off;
        proxy_read_timeout   3600s;
        proxy_send_timeout   3600s;
    }

    location /uploads/ {
        proxy_pass       http://127.0.0.1:130;
        proxy_set_header Host $host;
        expires 7d;
    }
}
```

## 配置项

后端读取 `server/.env`（可从 `.env.example` 复制），也可直接用环境变量覆盖：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `SECRET_KEY` | `artvault-dev-secret-change-me` | JWT 签名密钥，**生产必须替换** |
| `DATABASE_URL` | `sqlite:///./artvault.db` | 换 PostgreSQL 就改成 `postgresql://user:pass@host/db` |
| `UPLOAD_DIR` | `./uploads` | 本地文件存储目录（缩略图、头像、未启用 COS 时的资产文件） |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `10080`（7 天） | 登录有效期 |
| `CORS_ORIGINS` | `["http://localhost:5173", ...]` | 仅开发环境需要 |

**数据库迁移**：项目未使用 Alembic。启动时会自动建表，并为已有表补齐新增的列（幂等），无需手工执行 SQL。

---

## 对象存储
示例为腾讯云 COS

默认使用本地磁盘。若希望资产文件走对象存储，由**高级管理员**登录后在「管理后台 → 对象存储」填写：

| 字段 | 示例 |
|---|---|
| SecretId / SecretKey | 腾讯云访问密钥（密钥不会明文回传，留空表示不修改） |
| Region | `ap-guangzhou` |
| Bucket | `mybucket-1250000000` |
| 存储目录 | `artvaultm`（资产文件会放到该目录下） |

启用后：

- **资产文件、缩略图、头像**都上传到该桶，形如 `artvaultm/projects/…`、`artvaultm/thumbnails/…`、`artvaultm/avatars/…`
- 下载与预览由服务端**签发临时链接**，不暴露永久密钥
- 保存后可点「测试连接」验证配置是否可用

---

## 角色与权限

| 能力 | 成员 | 管理员 | 高级管理员 |
|---|---|---|---|
| 浏览公开项目 / 下载 / 评论 / 点赞 | ✅ | ✅ | ✅ |
| 上传资产（需先受邀加入项目） | ✅ | ✅ | ✅ |
| 编辑项目 / 资产 | 仅自己创建的 | 仅自己创建的 | **任意**（含后台入口） |
| 管理用户 | ✗ | 仅普通成员 | **所有人** |
| 调整角色 / 配置对象存储 | ✗ | ✗ | ✅ |
| 查看全部项目（含他人私有） | ✗ | 仅后台、**只读** | 后台、**可编辑** |

「我的项目」列表对所有角色一致：只显示自己创建或受邀加入的项目。

---


## API 速览

所有接口前缀 `/api`，除登录外都需要 `Authorization: Bearer <token>`。

| 分组 | 主要接口 |
|---|---|
| 认证 | `POST /auth/login` · `GET /auth/me` · `PATCH /auth/profile` · `POST /auth/change-password` |
| 项目 | `POST/GET /projects` · `GET /projects/plaza` · `GET /projects/by-slug/{username}/{slug}` · `PATCH/DELETE /projects/{id}` |
| 项目成员 | `GET/POST /projects/{id}/members` · `DELETE /projects/{id}/members/{memberId}` |
| 邀请 | `GET /invitations` · `POST /invitations/{id}/accept` · `POST /invitations/{id}/decline` |
| 资产类型 | `GET/POST /projects/{id}/categories` · `PATCH/DELETE /categories/{id}`（项目内平铺的声明式分类） |
| 文件夹 | `GET/POST /projects/{id}/folders` · `PATCH/DELETE /folders/{id}`（层级目录，用于归类资产） |
| 资产 | `GET/POST /projects/{id}/assets` · `GET/PATCH/DELETE /assets/{id}` · `PATCH /assets/{id}/folder` |
| 版本 | `GET/POST /assets/{id}/versions` · `GET /versions/{id}/download-url` · `DELETE /versions/{id}` |
| 预览 | `GET /versions/{id}/stream-token` · `GET /versions/{id}/stream?t=` |
| 评论 | `GET/POST /assets/{id}/comments` · `DELETE /comments/{id}` |
| 订阅 / 消息 | `GET /subscriptions` · `GET /notifications` · `POST /notifications/read-all` |
| 排行榜 | `GET /leaderboard?days=7\|30\|365` · `GET /projects/{id}/leaderboard?days=` |
| 用户 | `GET /users/search?q=` · `GET /users/by-username/{username}` |
| 管理员 | `GET/POST /admin/users` · `PATCH /admin/users/{id}` · `DELETE /admin/users/{id}`（软删除）· `GET/PUT /admin/storage-config` |

启动后可访问 http://127.0.0.1:130/docs 查看自动生成的交互式 API 文档。

---

## 常见问题

**上传大文件返回 413**
Nginx 的 `client_max_body_size` 默认 1MB，调到 `2048m` 或更高（见上文反向代理配置）。

**刷新页面 404**
缺少 SPA 回退，需要在 Nginx 里加 `try_files $uri $uri/ /index.html`。

**只有资产详情页 `/assets/{id}` 打不开**
多半是把构建产物目录写成了 `location /assets/`，它会拦截前端那条同名路由。改用正则限定文件后缀（见上文配置）。

**上传大文件返回 504**
调大 `proxy_read_timeout` / `proxy_send_timeout`，并开启 `proxy_request_buffering off`。

**`npm run dev` 报找不到 vite / tsc**
环境的 `NODE_ENV=production` 会让 npm 跳过 devDependencies，用 `npm install --include=dev` 重装。

**登录后立刻跳回登录页**
前端存的是登录态 token，若该账号被禁用或删除，下一次请求会返回 401 并自动登出。

**后端启动报 `No module named 'app'`**
启动命令必须在 `server/` 目录下执行。

**管理后台地址是 `/console` 而不是 `/admin`**
个人主页路由是 `/{用户名}`，而默认管理员用户名正是 `admin`，`/admin` 需要留给管理员自己的主页。同理 `login` / `settings` / `notifications` / `console` 被列为保留用户名，不能注册。

---

## 项目结构

```
ArtVaultM/
├── docs/DESIGN.md          # 产品与技术规格（数据模型、页面路由、里程碑）
├── client/                 # 前端
│   ├── src/
│   │   ├── components/     # 布局、资产卡片、上传弹窗、评论、热力图、排行榜、3D 预览
│   │   ├── pages/          # 登录 / 项目列表 / 项目详情 / 项目编辑 / 资产详情 / 资产编辑
│   │   │                   # 消息 / 个人主页 / 个人设置 / 管理后台
│   │   ├── api.ts          # axios 封装与接口方法
│   │   ├── store.ts        # 登录态（zustand + localStorage）
│   │   └── types.ts
│   └── vite.config.ts      # 开发代理指向后端 130
└── server/                 # 后端
    ├── app/
    │   ├── main.py         # 入口、路由注册、启动迁移
    │   ├── models.py       # SQLAlchemy 模型
    │   ├── schemas.py      # Pydantic 请求模型
    │   ├── serializers.py  # 出参组装（含图片 URL 解析）
    │   ├── config.py       # 配置项
    │   ├── core/security.py
    │   ├── services/       # 存储、COS 配置、统计、slug、通知
    │   └── api/            # 各业务路由
    └── requirements.txt
```

---
