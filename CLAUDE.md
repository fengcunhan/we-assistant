# Pi Assistant - VPS 全栈部署

## Architecture

```
WeChat User
    ↕ iLink Bot API (ilinkai.weixin.qq.com)
┌─────────────────────────────────────────┐
│  国内 VPS (<YOUR_VPS_IP>)               │
│                                         │
│  Node.js + tsx 单进程                    │
│  ├─ iLink long-poll (35s) 收微信消息      │
│  ├─ Pi Agent (multi-turn tool calling)  │
│  │   ├─ store_note → embedding → SQLite │
│  │   ├─ query_knowledge → 向量检索 → RAG │
│  │   ├─ search_images → 向量搜图 → 发图  │
│  │   └─ reminder → 定时提醒 (cron_jobs)  │
│  ├─ Scheduler (30s tick → 到期发微信)    │
│  ├─ 媒体: AES-ECB 解密 → COS 上传       │
│  ├─ HTTP API (:18011)                   │
│  └─ Dashboard 静态文件 (Next.js)         │
│                                         │
│  数据存储:                               │
│  ├─ SQLite (./data/pi.db)              │
│  ├─ 腾讯云 COS (<COS_BUCKET>)           │
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
| Server | `<YOUR_VPS_IP>` (腾讯云, 上海) |
| SSH | `ssh root@<YOUR_VPS_IP>` |
| Code | `/opt/pi-assistant/` |
| Dashboard | `http://<YOUR_VPS_IP>:18011` |
| API | `http://<YOUR_VPS_IP>:18011/api/*` |
| Service | `systemctl {start|stop|restart|status} pi-assistant` |
| Logs | `journalctl -u pi-assistant -f` |
| Runtime | Node.js 22 + tsx |

## File Structure (VPS: /opt/pi-assistant/)

```
src/
  index.ts        # 入口: iLink 轮询 + HTTP server + Dashboard 静态服务
  config.ts       # 环境变量配置
  db.ts           # SQLite: 凭据、对话历史、向量存储、统计
  llm.ts          # LLM 客户端 (OpenAI 兼容，支持多轮 tool 消息)
  embedding.ts    # 百炼 DashScope 多模态 embedding
  agent.ts        # Agent 引擎: 多轮 tool-calling loop + skill 加载 + 时间注入
  ilink.ts        # iLink 协议: 收发消息、AES-ECB 加解密、CDN 媒体上下载
  cos.ts          # 腾讯云 COS 上传 + 签名 URL
  scheduler.ts    # 定时任务调度器 (30s interval, cron_jobs 表)
  skills/
    types.ts      # Skill / ToolDef / ToolResult 接口定义
    store-note.ts       # 存储笔记技能
    query-knowledge.ts  # 知识检索技能
    search-images.ts    # 图片搜索技能
    reminder.ts         # 定时提醒技能 (create/list/delete)
public/           # Next.js 静态导出 (dashboard)
data/
  pi.db           # SQLite 数据库
  media/          # 本地媒体文件 (fallback)
.env              # 环境变量 (secrets)
package.json
```

## Agent + Skill 架构 (借鉴 OpenClaw)

### 核心设计

```
用户消息 (文本/语音转写) → Agent Loop (最多 5 轮)
  ├─ 1. buildSystemPrompt() — base + 当前时间 + skill descriptions 动态注入
  ├─ 2. chatWithTools(messages, allTools) — LLM 决策
  ├─ 3. 无 tool_calls → 返回最终回复
  └─ 4. 有 tool_calls → 分发到 Skill.execute() → tool result 追加到 messages → 回到 2
```

### System Prompt 动态内容

- **当前时间**: 每次调用注入 `Asia/Shanghai` 时区的完整日期时间，确保 LLM 能正确理解"明天"、"下周一"等相对时间
- **Skill 描述**: 从 skills 数组自动组装
- **Memory Recall**: 要求 LLM 在回答历史相关问题前必须先调 query_knowledge

### Skill 接口

每个 Skill 是自包含模块 (`src/skills/*.ts`)，包含:
- `name` + `description` — 元数据，注入 system prompt 帮助 LLM 决策
- `tools: ToolDef[]` — OpenAI function-calling 格式的工具定义
- `execute(toolName, args, context) → ToolResult` — 工具执行器

```typescript
interface Skill {
  name: string
  description: string
  tools: ToolDef[]
  execute: (toolName: string, args: Record<string, unknown>, context: SkillContext) => Promise<ToolResult>
}
interface ToolResult {
  content: string                        // 返回给 LLM 的文本
  sideEffects?: Record<string, unknown>  // 副作用 (如 imageUrls)
}
```

### 新增 Skill

1. 创建 `src/skills/my-skill.ts`，export default 一个 `Skill` 对象
2. 在 `src/agent.ts` 顶部 import 并加入 `skills` 数组
3. Agent 自动注册工具、注入 prompt、处理分发

### 关键区别 (vs 旧实现)

| | 旧 | 新 |
|---|---|---|
| Tool 调用 | 单轮，取第一个 tool call | 多轮循环 (最多 5 轮)，支持连续调用 |
| Tool 结果 | 硬编码字符串直接返回用户 | 送回 LLM，由 LLM 自然语言总结 |
| 模块化 | 全部硬编码在 agent.ts | 每个 skill 独立文件，自包含 |
| System Prompt | 手动列举所有工具 | 从 skills 数组自动组装 |
| 新增能力 | 改 agent.ts 多处 (tools/if-else/handler) | 新建 skill 文件 + 1 行 import |

## 定时任务 (Scheduler)

借鉴 OpenClaw 的 cron 系统实现的精简版。

### 调度类型

| Kind | 说明 | schedule_value 示例 |
|------|------|-------------------|
| `at` | 一次性，执行后自动禁用 | `2026-04-02T15:00:00` (ISO) |
| `every` | 固定间隔 (最小 1 分钟) | `3600000` (毫秒) |
| `cron` | 每日定时 | `09:00` (HH:MM, Asia/Shanghai) |

### 工作原理

- `scheduler.ts`: 每 30s 检查 `cron_jobs` 表中 `next_run_at <= now` 的任务
- 到期任务通过 iLink `sendMessage` 发送 `payload` 到对应用户的微信
- 执行后自动计算下次运行时间；`at` 类型执行后自动 `enabled = 0`
- 启动时立即 tick 一次以捕获服务重启期间错过的任务

### 用户交互 (通过 reminder skill)

- "提醒我明天下午3点开会" → `create_reminder(at, 2026-04-02T15:00:00)`
- "每天早上9点提醒我喝水" → `create_reminder(cron, 09:00)`
- "看看我的提醒" → `list_reminders`
- "删除提醒 rem_xxx" → `delete_reminder`

## 消息处理流程

### 入站消息分类

```
iLink 消息 → extractContent() → { text, mediaPaths }
  ├─ 语音: voice_item.text (转写) + 下载 SILK → COS
  ├─ 图片: 下载解密 → COS + multimodal embedding (异步)
  ├─ 文件/视频: 下载解密 → COS
  └─ 文本: 直接提取
```

### 处理逻辑

```
有文本 (含语音转写)? ──yes──→ 交给 Agent 处理 → 回复
                      │
                      no (纯媒体无文字)
                      │
                      └──→ "已收到并存档" 确认
```

### 自动索引

所有 ≥4 字符的用户文本消息异步 embedding 存入向量库 (`intent_type = 'chat'`)，确保对话内容可被语义检索，无需用户手动 `store_note`。

## Environment Variables (.env)

```
LLM_BASE_URL=https://open.bigmodel.cn/api/coding/paas/v4
LLM_MODEL=GLM-5.1
LLM_API_KEY=<智谱 API Key>
DASHSCOPE_API_KEY=<百炼 API Key>
EMBEDDING_MODEL=tongyi-embedding-vision-plus-2026-03-06
COS_SECRET_ID=<腾讯云 COS SecretId>
COS_SECRET_KEY=<腾讯云 COS SecretKey>
JWT_SECRET=<your-jwt-secret>
ADMIN_PASSWORD=<your-admin-password>
COS_BUCKET=<your-cos-bucket>
COS_REGION=ap-shanghai
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
| `/api/files` | GET | 媒体文件列表 (含 COS 签名 URL) |
| `/api/cron` | GET | 定时任务列表 |
| `/api/cron/:id` | DELETE | 删除定时任务 |

## Dashboard

- Framework: Next.js 16, React 19, Tailwind CSS v4
- 静态导出到 `public/` 目录，VPS 的 HTTP server 直接 serve
- 登录: admin / <ADMIN_PASSWORD from .env>
- Pages: `/` (统计), `/notes` (知识库), `/files` (媒体文件), `/wechat` (扫码绑定), `/login`
- `NEXT_PUBLIC_API_BASE=""` (同源请求)

### 重新构建 Dashboard
```bash
# 本地构建
cd dashboard && NEXT_PUBLIC_API_BASE="" npx next build
# 上传到 VPS
scp -r dashboard/out root@<YOUR_VPS_IP>:/opt/pi-assistant/public
systemctl restart pi-assistant
```

## iLink Bot Protocol

- Base URL: `https://ilinkai.weixin.qq.com`
- Auth: `Authorization: Bearer {bot_token}`, `AuthorizationType: ilink_bot_token`
- `X-WECHAT-UIN`: `btoa(String(randomUint32()))` 每次随机
- `getupdates`: POST, 35s long-poll, 返回 `msgs` + `get_updates_buf` 游标
- `sendmessage`: POST, 必须包含 `from_user_id` (bot ID) + `client_id` (UUID) + `context_token`
- 媒体字段: AES key 有两个位置 (需都检查):
  - `item.image_item.aeskey` — hex string (旧格式)
  - `item.image_item.media.aes_key` — base64 编码的 hex string (新格式)
  - 解析: `resolveAesKeyHex()` 统一处理两种格式
- 语音转写: `voice_item.text` (不是 `voice_text`)
- CDN 下载: `GET https://novac2c.cdn.weixin.qq.com/c2c/download?encrypted_query_param=<urlencoded>`
- AES key: hex string → hexToBytes → 16 字节 AES-128 key

## COS Storage

- Bucket: `<COS_BUCKET>` (环境变量)
- Region: `<COS_REGION>` (默认 ap-shanghai)
- Domain: `https://<COS_BUCKET>.cos.<COS_REGION>.myqcloud.com`
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
scp -r vps/src/* root@<YOUR_VPS_IP>:/opt/pi-assistant/src/
ssh root@<YOUR_VPS_IP> "systemctl restart pi-assistant"

# 查看日志
ssh root@<YOUR_VPS_IP> "journalctl -u pi-assistant -f"

# 重建 Dashboard 并部署
cd dashboard && NEXT_PUBLIC_API_BASE="" npx next build
scp -r dashboard/out root@<YOUR_VPS_IP>:/opt/pi-assistant/public
ssh root@<YOUR_VPS_IP> "systemctl restart pi-assistant"
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

## Storage Modes

自动检测：`COS_BUCKET` + `COS_SECRET_ID` + `COS_SECRET_KEY` 三者齐备 → COS 模式；否则 → 本地模式。

| 能力 | COS | 本地 |
|---|---|---|
| 媒体落盘 | COS Bucket | `./data/media/<type>/<date>/` |
| 对外访问 | 签名 URL (`getSignedUrl`) | `GET /media/<rel>` (未鉴权) |
| VLM 描述 | 公网 URL | base64 data URI (≤4MB) |
| 图片→图片搜索 | ✅ | ⚠️ 跳过 |
| `sendImage` | fetch(COS) | 本地读文件 |

路径/URL 统一抽象在 `src/media.ts`：`isLocalPath`、`persistMedia`、`readMediaBytes`、`toBase64DataUri`、`toDisplayUrl`、`resolveLocalMedia`。

## Known Issues

1. **iLink 屏蔽海外 IP**: Cloudflare Workers 无法直接调用 iLink API (403 error 1003)，必须从国内 VPS 发起请求
2. **sendMessage 必须含 from_user_id + client_id**: 缺少这两个字段消息会静默发送失败 (返回空 `{}` 但不送达)
3. **AES key 两种格式**: `item.aeskey` 是直接 hex string；`item.media.aes_key` 是 base64(hex string)，需 base64 decode 后得到 hex
4. **CDN URL 格式**: 下载用 `/download?encrypted_query_param=<urlencoded>`，上传用 `/upload?encrypted_query_param=<urlencoded>&filekey=<hex>`
5. **语音转写字段**: iLink 返回的是 `voice_item.text`，不是 `voice_item.voice_text`
6. **语音消息应走 Agent**: 有转写文本的语音消息要交给 Agent 处理，不能当纯媒体只存档
