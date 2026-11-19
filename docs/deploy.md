# 前端部署说明（GitHub Actions）

前端（`bokee-web`）通过 `.github/workflows/ci.yml` 自动构建并部署到服务器
`43.166.22.152` 的 `/home/kim/composes/nginx`，与 `bokee-server` 的后端流水线同构：
**VERSION 版本号 → 构建产物 → 按版本号备份到 MinIO → SSH 按版本号部署 → 自检 → 留存历史版本**。

## 版本号

版本号唯一来源是仓库根目录的 `VERSION` 文件（当前 `v1.0.0`）。
每次发版改这一行再推送即可，CI 会用它作为镜像/产物的标签与部署目标：

```
VERSION            →  v1.0.0
产物               →  bokee-web-v1.0.0.tar.gz
MinIO 路径          →  bokee-artifacts/web/v1.0.0/bokee-web.tar.gz
releases 目录       →  /home/kim/composes/nginx/releases/v1.0.0/
```

> 同一个版本号重复推送会覆盖 MinIO 里同名的产物（与后端 `v1.0.x` 镜像 tag 行为一致），
> 需要留痕时请递增 `VERSION`。

## 如何确认服务器上跑的是哪个版本

后端靠 `docker images` 的 tag 就能看出镜像版本；前端是静态文件，解压进 `dist/` 后就没有版本信息了，
所以用四层标识来保证"可追踪、可校验"：

| 层级 | 位置 | 作用 |
| --- | --- | --- |
| 拉取来源 | MinIO `web/<版本>/bokee-web.tar.gz` | 部署只从这个路径拉，"路径即版本" |
| 包内清单 | 产物里的 `version.json` | 构建时写入 `version`/`commit`/`builtAt`；部署前校验与请求版本是否一致，不一致直接失败 |
| 部署记录 | `/home/kim/composes/nginx/current.json` | 记录本次部署的版本、产物路径、包 sha256、部署时间 |
| 线上自检 | `https://bokee.online/version.json` | 部署后回源请求，确认线上确实切换到了该版本 |

任何一层都能独立回答"线上是什么版本"：

```bash
# 一条命令看全：dist 版本、最近部署记录、本地留档、MinIO 已有版本
/home/kim/composes/nginx/deploy.sh status

# 从外网看线上版本（version.json 随站点一起发布）
curl -s https://bokee.online/version.json
```

包内清单长这样（CI 每次构建自动生成）：

```json
{ "version": "v1.0.0", "commit": "1dd79ce", "builtAt": "2026-11-19 14:39:52" }
```

如果 MinIO 里某个版本路径下的包内容和路径对不上（比如手工传错文件），部署脚本会在解压后立刻报
`版本不匹配：请求 vX，但产物里写的是 vY` 并以非 0 退出，`script_stop` 会让流水线红灯，不会把错误产物发布出去。

## 流水线结构

```
push main/develop ─┬─ build-web-job
                   │    checkout → setup-node(24) → npm ci → npm run build
                   │    → 读 VERSION → tar 打包 dist → upload-artifact
                   ├─ push-minio-job（needs: build-web-job）
                   │    download-artifact → mc alias set → 上传
                   │      web/<版本>/bokee-web.tar.gz  +  web/bokee-web.tar.gz（latest）
                   └─ deploy-job（needs: build + push-minio）
                        scp deploy/deploy.sh 到 incoming/deploy/
                        → ssh: deploy.sh deploy <版本>
                             ├ 从 MinIO 拉取 web/<版本>/bokee-web.tar.gz
                             ├ 解压校验 index.html
                             ├ 复制到 releases/<版本>（回滚用）
                             ├ rsync 同步进 dist/（先写新文件，再清理旧文件）
                             ├ curl 自检首页与首页引用的首个 JS 资源
                             └ 清理超过 5 个的旧版本
```

- 静态文件由 `bokee-nginx` 容器通过 bind mount 直接读取 `dist/`，替换文件即时生效，**不需要重启容器**。
- 部署脚本随每次构建上传，服务端执行的一定是仓库里的最新版本，不会与代码脱节。
- 部署以 MinIO 中的产物为准：`deploy-job` 依赖 `push-minio-job`，凡是能部署的版本一定已在 MinIO 留档。

## 一次性准备（GitHub 仓库 Secrets / Variables）

在 `MyJin520/bokee-web` → Settings → Secrets and variables → Actions 中添加：

| 类型 | 名称 | 说明 | 取值 |
| --- | --- | --- | --- |
| Secret | `DEPLOY_HOST` | 服务器地址 | `43.166.22.152` |
| Secret | `DEPLOY_PORT` | SSH 端口（可留空，默认 22） | `22` |
| Secret | `DEPLOY_USER` | SSH 用户 | `kim` |
| Secret | `DEPLOY_KEY` | 私钥完整内容 | 与 `bokee-server` 中同一把专用部署密钥 |
| Secret | `MINIO_ENDPOINT` | MinIO 地址 | 与 `bokee-server` 相同 |
| Secret | `MINIO_ACCESS_KEY` | MinIO Access Key | 与 `bokee-server` 相同 |
| Secret | `MINIO_SECRET_KEY` | MinIO Secret Key | 与 `bokee-server` 相同 |
| Variable | `MINIO_BUCKET` | 桶名（可留空，默认 `bokee-artifacts`） | `bokee-artifacts`（与后端一致） |

> 服务器 `~/.ssh/authorized_keys` 中已装好部署密钥对应的公钥（备注 `github-actions-deploy`），
> 直接复用后端仓库里同一份私钥即可，无需再生成新密钥。

## 服务器目录与 MinIO 约定

```
/home/kim/composes/nginx/
├─ dist/                       nginx 对外提供的站点目录（容器挂载为只读），内含 version.json
├─ incoming/deploy/deploy.sh   CI 每次上传的部署脚本
├─ releases/<版本>/            每次部署留存的副本，供快速回滚
├─ current.json               最近一次部署记录（版本 / 产物路径 / sha256 / 时间）
├─ deploy.sh                   部署脚本（本机副本，也可手工执行）
├─ nginx.conf / docker-compose.yaml / ssl/
└─ .staging-<版本>/、.download-<版本>.tar.gz   临时目录，部署结束自动清理

MinIO（bokee-artifacts 桶）
├─ web/<版本>/bokee-web.tar.gz   每个版本的产物留档
├─ web/bokee-web.tar.gz          固定指向最后一次成功上传的产物
└─ server/…                      后端镜像的对应结构
```

服务器上不额外保存 MinIO 凭据：部署脚本通过 `docker exec bokee-minio mc`，
复用容器内自带的 `mc` 与 `local` 别名（`http://localhost:9000`）读取产物。

`dist/` 属主已改为 `kim`，保证 CI 用户可以直接写入。

## 触发方式

- 推送到 `main` 或 `develop` 分支自动执行；
- 或在 Actions 页面手动触发（`workflow_dispatch`）；
- 同一分支的部署串行执行（`concurrency`），避免两次构建同时替换 `dist/`。

## 手工操作（在服务器上）

```bash
# 查看线上当前版本、最近部署记录、本地留档与 MinIO 已有版本
/home/kim/composes/nginx/deploy.sh status

# 查看本地保留的历史版本
/home/kim/composes/nginx/deploy.sh list

# 部署 MinIO 里的某个版本
/home/kim/composes/nginx/deploy.sh deploy v1.0.0

# 回滚（本地有 releases 副本就用本地，没有就从 MinIO 拉取）
/home/kim/composes/nginx/deploy.sh rollback v0.9.0

# 应急：直接用本地压缩包部署
/home/kim/composes/nginx/deploy.sh deploy v1.0.1 /tmp/bokee-web.tar.gz
```

可调环境变量：`WEB_ROOT`（默认 `/home/kim/composes/nginx`）、`KEEP`（保留版本数，默认 5）、
`SITE_HOST`（自检域名，默认 `bokee.online`）、`MINIO_BUCKET` / `MINIO_PREFIX` / `MINIO_OBJECT`
（默认 `bokee-artifacts` / `web` / `bokee-web.tar.gz`）。

## 与后端流水线的对应关系

| 环节 | bokee-server | bokee-web |
| --- | --- | --- |
| 版本号 | `VERSION` 文件（`v1.0.1`） | `VERSION` 文件（`v1.0.0`） |
| 构建 | `docker build` 打镜像 | `npm ci && npm run build` 生成静态产物 |
| 产物 | 镜像 tar 包 | `dist` 压缩包 |
| 版本化备份 | MinIO `server/<版本>/` + `server/bokee-server.tar` | MinIO `web/<版本>/` + `web/bokee-web.tar.gz` |
| 分发 | 推 Zot 私有镜像仓库 | MinIO（部署时直接拉取产物） |
| 部署 | 拉对应 tag 镜像并滚动重建容器 | 拉对应版本产物替换 `dist/`，无需重启容器 |
| 回滚 | 换回旧 tag 重新 `docker compose up -d` | `deploy.sh rollback <版本>` |
