# PenTou Docker 部署指南

> 本文档面向**部署 PenTou 的最终用户**（管理员）。每一节都给出可复制的命令与可自查的验收点。
>
> PenTou 是本地优先的 AI 对话知识库（多源采集、检索、文档提炼）。Docker 形态适合 NAS / 云主机上的**长期私有服务**；本机单人试用请优先 `npx`（见 [user-guide.md](./user-guide.md)）。产品能力见 [pentou-introduction.md](./pentou-introduction.md)。
>
> 官方镜像：`ghcr.io/startppt/pentou`（注意：ghcr.io 路径全小写，与 GitHub 用户名大小写无关）。
> 支持架构：`linux/amd64` + `linux/arm64`（PC 与群晖 / 极空间 NAS 通用）。

---

## 1. 前置条件

| 项目 | 要求 |
| --- | --- |
| Docker | `>= 20.10`（`docker --version` 检查） |
| Docker Compose | `>= v2`（可选但强烈推荐） |
| 主机内存 | 最低 1 GB（推荐 2 GB） |
| 主机磁盘 | 最少预留 2 GB（镜像 + 数据） |
| 网络 | 容器需可达 `ghcr.io` 完成首次 `pull` |
| 反向代理 | 自备 Nginx / Caddy / Nginx Proxy Manager / Traefik 之一，用来挂域名 + SSL |
| 域名 | 已解析到本机的 A/AAAA 记录（如 `pentou.example.com → 1.2.3.4`） |

> **重要**：PenTou 容器**只暴露 HTTP**（默认 7766 端口），**不应**直接对公网开放。请始终通过反代做 TLS 终止。

---

## 2. 快速开始（5 分钟）

### 2.1 单行命令启动（适合先跑通试试）

```bash
mkdir -p /srv/pentou/data && chown -R 1000:1000 /srv/pentou/data

docker run -d \
  --name pentou \
  --restart unless-stopped \
  -p 127.0.0.1:7766:7766 \
  -e PENTOU_PASSWORD='请改成你自己的强密码' \
  -v /srv/pentou/data:/app/data \
  -m 1g \
  ghcr.io/startppt/pentou:latest
```

> - `127.0.0.1:7766:7766` 表示**只绑定回环口**，容器永远不直接面向公网，必须通过反代才能访问。
> - `-m 1g` 为容器设上限 1 GB 内存，对 1C1G 主机安全。
> - `chown -R 1000:1000` 是因为镜像内以 uid 1000 运行；若你用群晖 / 极空间，宿主机 uid 可能不是 1000，见 §10 Q2 的处理。

### 2.2 自查容器是否健康

```bash
docker logs pentou | head -20
# 应见：
# [info] Pentou listening on :7766, dataDir=/app/data
# （分享链接依赖 /app/bin/obscura；镜像基于 Debian slim/glibc，勿自建 Alpine 变体）

# 自检 obscura 可执行（文件存在但 exec 报 no such file → 多为 musl/glibc 不匹配）
docker exec pentou ls -l /app/bin/obscura
docker exec pentou /app/bin/obscura --version   # 应打印版本，而不是 "no such file or directory"

curl -fsS http://127.0.0.1:7766/healthz
# 应返回 {"ok":true,"version":"x.y.z","uptimeSec":N}
```

如果健康检查与 obscura `--version` 都过，容器健康。下一步配反代。

---

## 3. 推荐方案：docker-compose

放一个 `compose.yml` 在 `/srv/pentou/` 下：

```yaml
# /srv/pentou/compose.yml
services:
  pentou:
    image: ghcr.io/startppt/pentou:latest   # 建议改成 vX.Y.Z 而不是 latest
    container_name: pentou
    restart: unless-stopped
    ports:
      - "127.0.0.1:7766:7766"
    env_file: .env
    volumes:
      - ./data:/app/data
    mem_limit: 1g
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:7766/healthz"]
      interval: 30s
      timeout: 3s
      retries: 3
      start_period: 5s
```

`.env` 文件：

```ini
# /srv/pentou/.env
PENTOU_PASSWORD=请改成你自己的强密码
# 以下变量都可选，缺省即可
# LOG_LEVEL=info
# SESSION_MAX_AGE_SEC=2592000
# TRUST_PROXY=1
```

启动：

```bash
cd /srv/pentou
docker compose up -d
docker compose logs -f --tail=50
```

---

## 4. 反向代理示例（挂域名 + SSL）

任选一种你已经在用的反代。下面的示例都假设域名 `pentou.example.com` 已解析到本机。

### 4.1 Caddy（最省事，自动签发 Let's Encrypt）

`/etc/caddy/Caddyfile`：

```caddy
pentou.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:7766 {
        header_up X-Forwarded-Proto {scheme}
        header_up X-Forwarded-For {remote_host}
        header_up X-Real-IP {remote_host}
    }
    # 大文件导入需要放宽 body 上限
    request_body {
        max_size 64MB
    }
    # 关闭对 SSE / 长响应的缓冲
    @api path /api/*
    reverse_proxy @api 127.0.0.1:7766 {
        flush_interval -1
    }
}
```

应用：`sudo systemctl reload caddy`。

### 4.2 Nginx

`/etc/nginx/sites-available/pentou.conf`：

```nginx
server {
    listen 80;
    server_name pentou.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name pentou.example.com;

    ssl_certificate     /etc/letsencrypt/live/pentou.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/pentou.example.com/privkey.pem;

    client_max_body_size 64m;

    location / {
        proxy_pass         http://127.0.0.1:7766;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;

        # SSE / 长响应：关闭缓冲
        proxy_buffering off;
        proxy_read_timeout 600s;
    }
}
```

应用：`sudo nginx -t && sudo systemctl reload nginx`。

### 4.3 Nginx Proxy Manager（NPM，UI 操作）

在 NPM 添加 Proxy Host：

1. **Domain Names**: `pentou.example.com`
2. **Scheme**: `http`，**Forward Hostname / IP**: `127.0.0.1`（如 NPM 与 pentou 同主机；如不同主机，填该主机 IP）
3. **Forward Port**: `7766`
4. **Block Common Exploits**: 开
5. **Websockets Support**: 开（为 SSE 留余地，不开也能用）
6. SSL Tab → 选 Let's Encrypt 自动签发并强制 HTTPS

⚠️ NPM 默认 `client_max_body_size` 是 `1m`。需要：

- 进入 NPM 容器 `/data/nginx/proxy_host/<id>.conf` 加上 `client_max_body_size 64m;`，
- 或在「Advanced」标签贴：
  ```
  client_max_body_size 64m;
  proxy_buffering off;
  ```

### 4.4 Traefik（用 compose label 自动接管）

在 §3 的 compose.yml 里 `pentou` 服务下追加：

```yaml
    labels:
      - traefik.enable=true
      - traefik.http.routers.pentou.rule=Host(`pentou.example.com`)
      - traefik.http.routers.pentou.entrypoints=websecure
      - traefik.http.routers.pentou.tls.certresolver=letsencrypt
      - traefik.http.services.pentou.loadbalancer.server.port=7766
```

并把 `ports:` 段删掉（流量走 Traefik 网络），把 Traefik 与 pentou 放在同一个 docker network。

---

## 5. 首次登录

1. 浏览器访问 `https://pentou.example.com/`，应自动跳到 `/login`。
2. 输入 `.env` 中的 `PENTOU_PASSWORD`。
3. 成功后跳转到 PenTou 主界面，与本地 dev 模式完全一致。
4. 30 天内同浏览器无需再登录；换浏览器/设备需重新输密码。

修改密码：

```bash
cd /srv/pentou
# 编辑 .env，把 PENTOU_PASSWORD 改成新的强密码
docker compose up -d   # 重启容器，新密码即时生效
```

> 不提供「应用内修改密码」UI。

---

## 6. （可选）配置 MinerU 以导入 PDF/Office/图片

文档导入分两条路：

| 类型 | 扩展名 | 处理方式 |
| --- | --- | --- |
| 本地格式 | `.md` `.txt` `.json` `.csv` `.xml` | 容器内直接解析，**开箱即用，无需任何配置** |
| MinerU 格式 | `.pdf` `.doc(x)` `.ppt(x)` `.xls(x)` `.html`、常见图片 | 调用 MinerU 云端解析，需配置 API Token |

MinerU 是**托管服务**（`https://mineru.net`），**不需要在容器里安装任何东西**。配置方式：

1. 到 [mineru.net](https://mineru.net) 申请 API Token；
2. 浏览器打开 PenTou → 「导入」→「文档导入」抽屉 → 填入 Token 并保存。

Token 存于数据卷的 `.config/mineru.json`（权限 `0600`），因此**容器重建、镜像升级后都不会丢**，整卷备份也会带上它。

> 注意：**一键迁移不会搬运 Token**。迁移只覆盖 `conversations` / `documents` / `ai-chats` / `assets` 四个目录，
> 换实例后需要在新实例重新填一次 —— 这是刻意的，避免凭据跟着数据到处跑。

> ⚠️ **隐私边界**：PDF、Office、图片、HTML 会**上传到 MinerU 云端**解析；本地格式（`.md` / `.txt` / `.json` / `.csv` / `.xml`）不出本机。
> 不希望任何内容离开本机时，不要配置 Token —— 此时本地格式照常可用，MinerU 格式会提示未配置。

> 📌 容器需要能**出站访问** `mineru.net`。若部署在只出不进的隔离网络里，需要放行该域名，否则解析会超时失败。

单次导入限制：单文件 ≤ 30 MB，最多 30 个文件，合计 ≤ 150 MB。

---

## 7. 升级与回滚

### 7.1 升级到新版本

```bash
cd /srv/pentou
# 编辑 compose.yml，把 image 改成新的 tag，比如 vX.Y.Z
docker compose pull
docker compose up -d
docker compose logs -f --tail=50
```

整个过程不会动 `./data`。预期不可用时间 `< 10s`。

### 7.2 回滚

```bash
# 把 compose.yml 的 image tag 改回原来的版本
docker compose up -d
```

数据卷与登录态都不会丢（只要 `.session-secret` 还在）。

### 7.3 关于 `latest` 标签

**不建议**在生产用 `latest`。固定到 `vX.Y` 或 `vX.Y.Z` 才能保证可控升级。

---

## 8. 备份与恢复

### 8.1 备份

PenTou 所有持久化都在 `./data` 目录。备份就是打包它：

```bash
# 推荐：先停容器以拿到一致快照
cd /srv/pentou
docker compose stop pentou
tar czf /backup/pentou-$(date +%F).tar.gz -C /srv/pentou data
docker compose start pentou
```

如果不愿意停服（接受可能丢最后几秒的写入）：

```bash
tar czf /backup/pentou-$(date +%F).tar.gz -C /srv/pentou data
```

### 8.2 恢复到另一台主机

```bash
mkdir -p /srv/pentou
tar xzf pentou-2026-05-11.tar.gz -C /srv/pentou
# 复制原主机的 compose.yml 和 .env（含相同 PENTOU_PASSWORD）
chown -R 1000:1000 /srv/pentou/data
docker compose up -d
```

成功后用原密码直接登录，无需重新登录任何浏览器（前提：相同 `.session-secret` 跟随数据卷一起恢复）。

### 8.3 增量备份

`./data/` 全是普通文件（无随机 tmp 残留、文件名稳定），`rsync` 即可：

```bash
rsync -avh --delete /srv/pentou/data/ user@backup-host:/backup/pentou/data/
```

---

## 9. 验证清单（部署完成后逐项打钩）

### 9.1 启动与健康

- [ ] `docker ps` 看到容器 `STATUS=Up (healthy)`。
- [ ] `docker logs pentou | head` 输出包含 `Pentou listening on :7766`。
- [ ] `curl -fsS http://127.0.0.1:7766/healthz` → `200 {"ok":true,...}`。
- [ ] 不设 `PENTOU_PASSWORD` 启动 → 容器立即退出，日志 `FATAL: PENTOU_PASSWORD env var is required`。
- [ ] 容器空闲 60s 后 `docker stats --no-stream pentou` → `MEM USAGE ≤ 250 MB`。

### 9.2 登录与会话

- [ ] 清空 cookie 后访问 `https://<domain>/` → 跳转到 `/login`。
- [ ] 输错密码 5 次后第 6 次提交 → 收到 `429`，UI 显示倒计时。
- [ ] 错误密码响应耗时与正确密码相近（均在 300-500 ms，**不要**比正确的快很多）。
- [ ] 登录成功后浏览器 DevTools 看到 `pentou_session=...; HttpOnly; SameSite=Lax`，且**有 `Secure`**（如果反代正确传了 `X-Forwarded-Proto: https`）。
- [ ] 退出登录后访问 `/api/conversations` → `401`。

### 9.3 反代与 HTTPS

- [ ] 浏览器地址栏 `https://<domain>` 带🔒，无证书错误。
- [ ] DevTools Network 看到对 `/api/conversations` 请求 status 200，未 CORS 报错。
- [ ] 在反代日志或应用日志里看到客户端真实 IP（不是反代自身 IP）。
- [ ] 上传一个 ~10 MB 的 .md 文档 → 成功；上传 ~70 MB 文档 → 反代返回 413（说明限制生效）。

### 9.4 数据持久化

- [ ] 在 PenTou 内创建一条对话 + 一条文档 + 一个文件夹。
- [ ] `docker compose down && docker compose up -d` 后所有数据仍在。
- [ ] `ls -la /srv/pentou/data/conversations/` 看到对应 `.md` 文件，权限 `0644`、owner `1000:1000`。
- [ ] `cat /srv/pentou/data/.session-secret` 存在且权限 `0600`。

### 9.5 性能

- [ ] 在 500 条对话规模下，Sidebar 加载 P95 `< 800 ms`（DevTools Network）。
- [ ] 切换对话 P95 `< 100 ms`。
- [ ] 24 小时后再看 `docker stats`，RSS 中位数仍 `≤ 220 MB`。
- [ ] `docker image inspect ghcr.io/startppt/pentou:latest` → `Size ≤ 350 MB`（解压）。

### 9.6 升级

- [ ] 改 image tag → `docker compose up -d` → 不可用时间 `< 10s`。
- [ ] 升级后所有数据仍在，无需重新登录。
- [ ] 改回旧 tag → 数据/登录态依然可用。

### 9.7 备份恢复

- [ ] 在另一台机器 `tar xzf` 备份 → 启动新容器 → 用同密码可直接登录。

### 9.8 可观察性

- [ ] 默认日志一行一条，格式 `<ISO 时间> <level> <method> <path> <status> <duration_ms>`。
- [ ] 日志里**没有**密码、cookie value、对话/文档正文。
- [ ] `LOG_LEVEL=debug` 重启后能看到 auth 中间件的校验细节。

### 9.9 MinerU（可选）

- [ ] 未配置 Token 时：`.md/.txt/.json/.csv/.xml` 仍能上传成功；PDF 提示需要配置 MinerU。
- [ ] 配置 Token 后：PDF 上传并解析成功（**无需重启容器**）。
- [ ] `docker rm` 后按同一 compose 重建：Token 仍在（存于数据卷），无需重新填。

### 9.10 多架构

- [ ] `docker buildx imagetools inspect ghcr.io/startppt/pentou:latest` 输出 2 个 Platform（amd64 + arm64）。
- [ ] 在 NAS（arm64）上 `docker pull` 同 tag → 直接可用。

---

## 10. 故障排查 FAQ

### Q1. 容器一启动就退出，日志 `FATAL: PENTOU_PASSWORD env var is required`

`.env` 没找到或没传进容器。检查：
- `docker compose config` 查看实际生效的环境变量；
- 或单次 `docker run` 时是否把 `-e PENTOU_PASSWORD=...` 写在了 image 名之后（应放在 image 名之前）。

### Q2. 启动失败 `FATAL: cannot write to /app/data`

宿主机卷目录的 owner 不是 `1000:1000`：

```bash
chown -R 1000:1000 /srv/pentou/data
```

群晖等 NAS 默认 docker 目录的 uid 可能是其他值（如 1026），可在 compose 中追加：

```yaml
    user: "1026:100"
```

替代默认的 1000:1000；但这会要求 `/srv/pentou/data` 也是这个 owner。

### Q3. 浏览器登录成功但刷新页面又被踢回 `/login`

最常见原因：反代没传 `X-Forwarded-Proto: https`，应用看到非 HTTPS 又不愿给 `Secure` Cookie，但浏览器把它当 HTTPS-only 处理 → 永远拿不到 cookie。

- 查应用日志，看是否有 `WARN: missing X-Forwarded-Proto`；
- 按 §4 的反代示例补 `proxy_set_header X-Forwarded-Proto $scheme;`（Nginx）或 `header_up X-Forwarded-Proto {scheme}`（Caddy）；
- 必要时关掉浏览器的 HSTS 缓存（不同浏览器路径不一）。

### Q4. 反代后 `client_max_body_size` 报 413

`§4` 的所有示例都把上限放到 `64m`。如果你的反代是 NPM、宝塔、1Panel 等 UI 工具，需要在「自定义/高级」里追加这一条。

### Q5. 容器 OOM 被反复 kill（`docker logs` 看到 `Exited (137)`）

可能在导入超大对话（数百 MB）。

- 检查 `/app/data/.bak` 或 obscura 子进程内存；
- 暂时给容器 `-m 2g`；
- 把超大文件先在本地拆分再上传；
- 反馈 issue 时附 `docker stats` 截图和导入文件大小。

### Q6. 群晖 / 极空间界面上看不到 docker stats 的内存数字

NAS 厂商定制的 Docker UI 经常隐藏这些。推荐 `ssh` 进 NAS 后用原生 `docker stats pentou`。

### Q7. 想从公网直接访问（不挂域名/反代），靠谱吗？

**不靠谱**。HTTP 明文 → 密码 + Cookie 都可被嗅探。如果你只是临时调试，可以 `-p 7766:7766` 暴露公网，**但请用极强密码且尽快关闭**。生产部署一定要走反代 + HTTPS。

### Q8. 怎么完全卸载并清掉所有数据？

```bash
cd /srv/pentou
docker compose down
rm -rf /srv/pentou/data    # ⚠️ 不可逆，先确认备份
docker image rm ghcr.io/startppt/pentou:<tag>
```

### Q9. 把 PenTou 跟其他服务都丢一个 compose 里，端口冲突怎么处理？

把 §3 的 `ports:` 改成：

```yaml
    ports:
      - "127.0.0.1:<新端口>:7766"
```

容器内部仍然是 7766，仅改宿主机映射端口；反代里同步改 upstream。

### Q10. 反代生效后，应用日志里客户端 IP 都是 `172.x.x.x`（容器网关 IP）

`TRUST_PROXY=1`（默认）下应用会读 `X-Forwarded-For` 链最左侧；如果还是看到网关 IP，说明反代没传这个头。补上 `X-Forwarded-For` 即可（见 §4 示例）。

---

## 11. 附录：最小 compose.yml 模板（复制即用）

```yaml
services:
  pentou:
    image: ghcr.io/startppt/pentou:v1.0.0
    container_name: pentou
    restart: unless-stopped
    ports:
      - "127.0.0.1:7766:7766"
    env_file: .env
    volumes:
      - ./data:/app/data
    mem_limit: 1g
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:7766/healthz"]
      interval: 30s
      timeout: 3s
      retries: 3
      start_period: 5s
```

```ini
# .env
PENTOU_PASSWORD=
```
