# Pi Assistant (全域助理)

基于微信的 AI 助理，支持多轮对话、知识库管理、图片搜索和定时提醒。

## Architecture

```
WeChat User
    ↕ iLink Bot API
┌─────────────────────────────────────────┐
│  国内 VPS (Node.js + tsx 单进程)         │
│                                         │
│  ├─ iLink long-poll (35s) 收微信消息      │
│  ├─ Pi Agent (multi-turn tool calling)  │
│  │   ├─ store_note → embedding → SQLite │
│  │   ├─ query_knowledge → 向量检索 → RAG │
│  │   ├─ search_images → 向量搜图 → 发图  │
│  │   └─ reminder → 定时提醒 (cron_jobs)  │
│  ├─ Skill Loader (自动扫描 + 热重载)     │
│  ├─ Scheduler (30s tick → 到期发微信)    │
│  ├─ 媒体: AES-ECB 解密 → COS/本地上传   │
│  ├─ HTTP API (:18011)                   │
│  └─ Dashboard 静态文件 (Next.js)         │
│                                         │
│  数据: SQLite + 腾讯云 COS + 本地磁盘     │
└─────────────────────────────────────────┘
    ↕ API calls
┌─────────────────────────────────────────┐
│  External Services                      │
│  ├─ 智谱 GLM-5.1 (LLM)                 │
│  └─ 百炼 DashScope (multimodal embed)   │
└─────────────────────────────────────────┘
```

## Project Structure

```
pi-assistant/
├── vps/                 # VPS 后端服务
│   ├── src/
│   │   ├── index.ts     # 入口: iLink 轮询 + HTTP server
│   │   ├── agent.ts     # Agent 引擎: 多轮 tool-calling loop
│   │   ├── skill-loader.ts  # 自动扫描 skills/ + fs.watch 热重载
│   │   ├── llm.ts       # LLM 客户端 (OpenAI 兼容)
│   │   ├── embedding.ts # 百炼 DashScope 多模态 embedding
│   │   ├── ilink.ts     # iLink 协议: 收发消息、AES 加解密
│   │   ├── media.ts     # 媒体存储抽象 (COS / 本地模式)
│   │   ├── cos.ts       # 腾讯云 COS 上传 + 签名 URL
│   │   ├── scheduler.ts # 定时任务调度器
│   │   ├── proactive.ts # 主动推送消息
│   │   ├── db.ts        # SQLite 数据层
│   │   ├── config.ts    # 环境变量配置
│   │   ├── reindex-images.ts # 图片向量重建工具
│   │   └── skills/      # 可插拔技能模块 (自动加载)
│   │       ├── types.ts
│   │       ├── store-note.ts
│   │       ├── query-knowledge.ts
│   │       ├── search-images.ts
│   │       ├── reminder.ts
│   │       ├── weather-query.ts
│   │       ├── calculator.ts
│   │       ├── daily-digest.ts
│   │       ├── send-image.ts
│   │       ├── wechat-article-fetcher.ts
│   │       ├── english-vocab-quiz.ts
│   │       ├── vocab-learner.ts
│   │       ├── news-fetch.ts
│   │       ├── file-downloader.ts
│   │       ├── bookkeeping.ts
│   │       └── create-skill.ts
│   ├── package.json
│   └── env.example
├── dashboard/           # 管理面板 (Next.js 16)
│   ├── app/             # App Router 页面
│   │   ├── page.tsx     # 统计概览
│   │   ├── notes/       # 知识库管理
│   │   ├── files/       # 媒体文件
│   │   ├── schedules/   # 定时任务
│   │   ├── wechat/      # 微信扫码绑定
│   │   └── login/       # 登录页
│   └── package.json
└── CLAUDE.md            # AI 开发上下文
```

## Features

- **多轮对话** — Agent 支持最多 5 轮 tool calling，由 LLM 自然语言总结结果
- **知识库** — 用户消息自动 embedding 存入向量库，支持语义检索 (RAG)
- **图片搜索** — 多模态 embedding，支持以文搜图
- **定时提醒** — 支持一次性 (`at`)、固定间隔 (`every`)、每日定时 (`cron`) 三种模式
- **媒体处理** — 微信语音/图片/文件自动解密并上传至 COS（或本地存储）
- **技能热重载** — 新增/修改 skill 文件后自动重载，无需重启
- **管理面板** — Next.js Dashboard，含统计、知识库、媒体、定时任务、微信扫码绑定

## Account Model

当前为**单管理员**架构：

- Dashboard 唯一登录用户 `admin`，密码由 `ADMIN_PASSWORD` 环境变量控制
- 同一时间只支持绑定一个微信机器人
- 所有数据（笔记、向量、定时任务）全局共享，无多用户隔离

## Storage Modes

自动检测：`COS_BUCKET` + `COS_SECRET_ID` + `COS_SECRET_KEY` 三者齐备 → COS 模式；否则 → 本地模式。

| 能力 | COS | 本地 |
|---|---|---|
| 媒体落盘 | COS Bucket | `./data/media/<type>/<date>/` |
| 对外访问 | 签名 URL | `GET /media/<rel>` (未鉴权) |
| VLM 描述 | 公网 URL | base64 data URI (≤4MB) |
| 图片→图片搜索 | ✅ | ⚠️ 跳过 |

## Quick Start

### Prerequisites

- Node.js 22+
- 国内 VPS (iLink API 屏蔽海外 IP)

### VPS Backend

```bash
cd vps
cp env.example .env     # 填写 API Key 等配置
npm install
npx tsx src/index.ts
```

### Dashboard

```bash
cd dashboard
npm install
NEXT_PUBLIC_API_BASE="" npx next build
# 将 out/ 目录部署到 VPS 的 public/ 下
```

### Environment Variables

```
# 必填
LLM_BASE_URL=          # LLM API 地址 (OpenAI 兼容)
LLM_MODEL=             # 模型名称
LLM_API_KEY=           # LLM API Key
DASHSCOPE_API_KEY=     # 百炼 API Key (embedding)
JWT_SECRET=            # Dashboard 鉴权
ADMIN_PASSWORD=        # Dashboard 登录密码

# 可选 (不填则使用本地存储)
COS_SECRET_ID=         # 腾讯云 COS
COS_SECRET_KEY=
COS_BUCKET=
COS_REGION=ap-shanghai

API_PORT=18011
```

## Deployment

```bash
# 上传代码并重启
scp -r vps/src/* root@<VPS_IP>:/opt/pi-assistant/src/
ssh root@<VPS_IP> "systemctl restart pi-assistant"

# 重建 Dashboard 并部署
cd dashboard && NEXT_PUBLIC_API_BASE="" npx next build
scp -r dashboard/out root@<VPS_IP>:/opt/pi-assistant/public
ssh root@<VPS_IP> "systemctl restart pi-assistant"

# 查看日志
ssh root@<VPS_IP> "journalctl -u pi-assistant -f"
```

## Adding a New Skill

1. 创建 `vps/src/skills/my-skill.ts`，export default 一个 `Skill` 对象
2. 重启服务（或等待热重载自动生效）

Skill Loader 会自动扫描 `skills/` 目录并注册工具，无需手动 import。

```typescript
interface Skill {
  name: string
  description: string
  tools: ToolDef[]
  execute: (toolName: string, args: Record<string, unknown>, context: SkillContext) => Promise<ToolResult>
}
```

## Local Development (无需 COS)

最小 `.env`（放在 `vps/.env`）：

```
LLM_API_KEY=<智谱 API Key>
DASHSCOPE_API_KEY=<百炼 API Key>
JWT_SECRET=<任意长字符串>
ADMIN_PASSWORD=<你设的面板密码>
```

启动：

```bash
cd vps
npm install
npm run dev
```

- Dashboard: `http://localhost:18011`
- 媒体文件落到 `vps/data/media/<type>/<date>/`
- 媒体通过 `GET /media/<rel>` 对外可读（**未鉴权**，勿暴露到公网）
- 图片 VLM 描述正常工作（≤4MB 时 base64 内联给 DashScope）
- 文字→图片搜索正常工作（基于 VLM 描述的文本向量）
- **图片→图片搜索在本地模式下不可用**（DashScope 多模态 embedding 只收公网 URL）

切换到 COS 模式：在 `.env` 补齐 `COS_SECRET_ID` / `COS_SECRET_KEY` / `COS_BUCKET`，重启即可。

## License

Private project.
