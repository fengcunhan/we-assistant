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
│  ├─ Scheduler (30s tick → 到期发微信)    │
│  ├─ 媒体: AES-ECB 解密 → COS 上传       │
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
│   │   ├── llm.ts       # LLM 客户端 (OpenAI 兼容)
│   │   ├── embedding.ts # 百炼 DashScope 多模态 embedding
│   │   ├── ilink.ts     # iLink 协议: 收发消息、AES 加解密
│   │   ├── cos.ts       # 腾讯云 COS 上传 + 签名 URL
│   │   ├── scheduler.ts # 定时任务调度器
│   │   ├── db.ts        # SQLite 数据层
│   │   ├── config.ts    # 环境变量配置
│   │   └── skills/      # 可插拔技能模块
│   │       ├── store-note.ts
│   │       ├── query-knowledge.ts
│   │       ├── search-images.ts
│   │       └── reminder.ts
│   ├── package.json
│   └── env.example
├── dashboard/           # 管理面板 (Next.js 16)
│   ├── app/             # App Router 页面
│   └── package.json
└── CLAUDE.md            # AI 开发上下文
```

## Features

- **多轮对话** — Agent 支持最多 5 轮 tool calling，由 LLM 自然语言总结结果
- **知识库** — 用户消息自动 embedding 存入向量库，支持语义检索 (RAG)
- **图片搜索** — 多模态 embedding，支持以文搜图
- **定时提醒** — 支持一次性 (`at`)、固定间隔 (`every`)、每日定时 (`cron`) 三种模式
- **媒体处理** — 微信语音/图片/文件自动解密并上传至 COS
- **管理面板** — Next.js Dashboard，含统计、知识库管理、微信扫码绑定

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
LLM_BASE_URL=         # LLM API 地址 (OpenAI 兼容)
LLM_MODEL=            # 模型名称
LLM_API_KEY=          # LLM API Key
DASHSCOPE_API_KEY=    # 百炼 API Key (embedding)
COS_SECRET_ID=        # 腾讯云 COS
COS_SECRET_KEY=
COS_BUCKET=
COS_REGION=ap-shanghai
JWT_SECRET=           # Dashboard 鉴权
ADMIN_PASSWORD=       # Dashboard 登录密码
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
2. 在 `vps/src/agent.ts` 中 import 并加入 `skills` 数组
3. Agent 自动注册工具、注入 prompt、处理分发

```typescript
interface Skill {
  name: string
  description: string
  tools: ToolDef[]
  execute: (toolName: string, args: Record<string, unknown>, context: SkillContext) => Promise<ToolResult>
}
```

## License

Private project.
