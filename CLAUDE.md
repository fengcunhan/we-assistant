# Pi Assistant - VPS 全栈部署

## Architecture

```
WeChat User
    ↕ iLink Bot API (ilinkai.weixin.qq.com)
┌─────────────────────────────────────────┐
│  国内 VPS (<VPS_IP>)               │
│                                         │
│  Node.js + tsx 单进程                    │
│  ├─ iLink long-poll (35s) 收微信消息      │
│  ├─ Pi Agent (LLM function calling)     │
│  │   ├─ store_note → embedding → SQLite │
│  │   ├─ query_knowledge → 向量检索 → RAG │
│  │   └─ search_images → 向量搜图 → 发图  │
│  ├─ 媒体: AES-ECB 解密 → COS 上传       │
│  ├─ HTTP API (:18011)                   │
│  └─ Dashboard 静态文件 (Next.js)         │
│                                         │
│  数据存储:                               │
│  ├─ SQLite (./data/pi.db)              │
│  ├─ 腾讯云 COS (<COS_BUCKET>)      │
│  └─ 本地磁盘 (./data/media/ fallback)   │
└─────────────────────────────────────────┘
    ↕ API calls
┌─────────────────────────────────────────┐
│  External Services                      │
│  ├─ 智谱 GLM-5.1 (LLM)                 │
│  └─ 百炼 DashScope (multimodal embed)   │
└─────────────────────────────────────────┘
```

## VPS Deployment

| Item | Value |
|------|-------|
| Server | `<VPS_IP>` (腾讯云, 上海) |
| SSH | `ssh root@<VPS_IP>` |
| Code | `/opt/pi-assistant/` |
| Dashboard | `http://<VPS_IP>:18011` |
| API | `http://<VPS_IP>:18011/api/*` |
| Service | `systemctl {start|stop|restart|status} pi-assistant` |
| Logs | `journalctl -u pi-assistant -f` |
| Runtime | Node.js 22 + tsx |

## File Structure (VPS: /opt/pi-assistant/)

```
src/
  index.ts        # 入口: iLink 轮询 + HTTP server + Dashboard 静态服务
  config.ts       # 环境变量配置
  db.ts           # SQLite: 凭据、对话历史、向量存储、统计
  llm.ts          # 智谱 GLM-5.1 客户端 (OpenAI 兼容)
  embedding.ts    # 百炼 DashScope 多模态 embedding
  agent.ts        # Pi Agent: store_note / query_knowledge / search_images
  ilink.ts        # iLink 协议: 收发消息、AES-ECB 加解密、CDN 媒体上下载
  cos.ts          # 腾讯云 COS 上传
public/           # Next.js 静态导出 (dashboard)
data/
  pi.db           # SQLite 数据库
  media/          # 本地媒体文件 (fallback)
.env              # 环境变量 (secrets)
package.json
```

## Environment Variables (.env)

```
LLM_BASE_URL=https://open.bigmodel.cn/api/coding/paas/v4
LLM_MODEL=GLM-5.1
LLM_API_KEY=<智谱 API Key>
DASHSCOPE_API_KEY=<百炼 API Key>
EMBEDDING_MODEL=tongyi-embedding-vision-plus-2026-03-06
COS_SECRET_ID=<腾讯云 COS SecretId>
COS_SECRET_KEY=<腾讯云 COS SecretKey>
JWT_SECRET=<JWT_SECRET>
ADMIN_PASSWORD=<ADMIN_PASSWORD>
DATA_DIR=./data
MEDIA_DIR=./data/media
API_PORT=18011
```

## API Endpoints

### Public
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/health` | GET | 服务状态 + bot ID |
| `/api/auth/login` | POST | 登录 `{username, password}` → JWT |
| `/api/auth/me` | GET | 验证 token |

### Protected (需 JWT Bearer token)
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/wechat/qrcode` | POST | 获取微信扫码登录二维码 |
| `/api/wechat/qrcode/:token/status` | GET | 轮询扫码状态 |
| `/api/wechat/bindings` | GET | 已绑定的微信账号列表 |
| `/api/wechat/bindings/:id` | DELETE | 解绑微信 |
| `/api/stats` | GET | Dashboard 统计数据 |
| `/api/notes` | GET | 知识库笔记列表 `?q=&category=` |
| `/api/notes/:id` | DELETE | 删除笔记 |
| `/api/gateway/status` | GET | 网关运行状态 |
| `/api/gateway/send` | POST | 主动推送消息 `{to, text}` |
| `/api/messages` | GET | 消息日志 `?limit=50` |

## Dashboard

- Framework: Next.js 16, React 19, Tailwind CSS v4
- 静态导出到 `public/` 目录，VPS 的 HTTP server 直接 serve
- 登录: admin / <ADMIN_PASSWORD>
- Pages: `/` (统计), `/wechat` (扫码绑定), `/notes` (知识库), `/login`
- `NEXT_PUBLIC_API_BASE=""` (同源请求)

### 重新构建 Dashboard
```bash
# 本地构建
cd dashboard && NEXT_PUBLIC_API_BASE="" npx next build
# 上传到 VPS
scp -r dashboard/out root@<VPS_IP>:/opt/pi-assistant/public
systemctl restart pi-assistant
```

## iLink Bot Protocol

- Base URL: `https://ilinkai.weixin.qq.com`
- Auth: `Authorization: Bearer {bot_token}`, `AuthorizationType: ilink_bot_token`
- `X-WECHAT-UIN`: `btoa(String(randomUint32()))` 每次随机
- `getupdates`: POST, 35s long-poll, 返回 `msgs` + `get_updates_buf` 游标
- `sendmessage`: POST, 必须包含 `from_user_id` (bot ID) + `client_id` (UUID) + `context_token`
- 媒体字段: `item.image_item.aeskey` (hex string) + `item.image_item.media.encrypt_query_param`
- CDN 下载: `GET https://novac2c.cdn.weixin.qq.com/c2c/download?encrypted_query_param=<urlencoded>`
- AES key: hex string → hexToBytes → 16 字节 AES-128 key

## COS Storage

- Bucket: `<COS_BUCKET>`
- Region: `ap-shanghai`
- Domain: `https://<COS_BUCKET>.cos.ap-shanghai.myqcloud.com`
- 路径格式: `media/{image|voice|file|video}/{date}/{timestamp}_{id}.{ext}`

## Embedding

- Provider: 百炼 DashScope (阿里云)
- Model: `tongyi-embedding-vision-plus-2026-03-06` (多模态: 文本+图片)
- Dimension: 1024
- API: `POST https://dashscope.aliyuncs.com/api/v1/services/embeddings/multimodal-embedding/multimodal-embedding`
- 注意: 多模态 embedding 不支持 OpenAI 兼容接口，必须用 DashScope API

## Deploy Commands

```bash
# 上传代码并重启
scp -r vps/src/* root@<VPS_IP>:/opt/pi-assistant/src/
ssh root@<VPS_IP> "systemctl restart pi-assistant"

# 查看日志
ssh root@<VPS_IP> "journalctl -u pi-assistant -f"

# 重建 Dashboard 并部署
cd dashboard && NEXT_PUBLIC_API_BASE="" npx next build
scp -r dashboard/out root@<VPS_IP>:/opt/pi-assistant/public
ssh root@<VPS_IP> "systemctl restart pi-assistant"
```

## Systemd Service

File: `/etc/systemd/system/pi-assistant.service`
```ini
[Unit]
Description=Pi Assistant WeChat Gateway
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/pi-assistant
ExecStart=/usr/local/bin/node --import tsx src/index.ts
Restart=always
RestartSec=5
EnvironmentFile=/opt/pi-assistant/.env

[Install]
WantedBy=multi-user.target
```

## Known Issues

1. **iLink 屏蔽海外 IP**: Cloudflare Workers 无法直接调用 iLink API (403 error 1003)，必须从国内 VPS 发起请求
2. **sendMessage 必须含 from_user_id + client_id**: 缺少这两个字段消息会静默发送失败 (返回空 `{}` 但不送达)
3. **AES key 是 hex 字符串**: iLink 消息中的 `aeskey` 字段是 hex 编码的 16 字节 key，不是 base64
4. **CDN URL 格式**: 下载用 `/download?encrypted_query_param=<urlencoded>`，上传用 `/upload?encrypted_query_param=<urlencoded>&filekey=<hex>`
