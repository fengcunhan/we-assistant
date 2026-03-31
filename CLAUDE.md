# Pi Assistant - Project Context

## Architecture

```
WeChat User → WeClaw (HTTP mode) → Cloudflare Worker (/v1/chat/completions)
                                        ├─ Pi Agent (LLM function calling)
                                        ├─ store_note → SiliconFlow BGE-M3 → Vectorize
                                        ├─ query_knowledge → Vectorize → LLM RAG
                                        └─ /api/* → Dashboard APIs

Next.js Dashboard (Cloudflare Pages) → Worker /api/*
```

## Deployed Instances

| Service | URL |
|---------|-----|
| Worker API | `https://<WORKERS_DOMAIN>` |
| Dashboard | `https://pi-dashboard-c75.pages.dev` |
| Cloudflare Account | `725e6fc9869cb664c3943de3fcad8733` (fengcunhan@gmail.com) |

## Secrets (already set via `wrangler secret put`)

| Secret | Provider | Notes |
|--------|----------|-------|
| `SILICONFLOW_API_KEY` | SiliconFlow | For BGE-M3 embedding only |
| `LLM_API_KEY` | Zhipu (智谱) | `70736da...` format, for GLM-5.1 |
| `AUTH_TOKEN` | Self-defined | `<AUTH_TOKEN>`, WeClaw uses this as Bearer token |

Local dev secrets in `worker/.dev.vars` (gitignored).

## Environment Variables (in wrangler.toml)

| Var | Value |
|-----|-------|
| `LLM_BASE_URL` | `https://open.bigmodel.cn/api/coding/paas/v4` |
| `LLM_MODEL` | `GLM-5.1` |
| `EMBEDDING_MODEL` | `BAAI/bge-m3` |

## Vectorize Index

- Name: `pi-notes`
- Dimensions: 1024 (BGE-M3)
- Metric: cosine
- Binding: `PI_VECTORS`
- **Max topK with `returnMetadata=all`: 50** (not 100)

## Deployment Pitfalls

### 1. `.workers.dev` domain blocked in China
Local machine cannot directly access `*.workers.dev`. Must use proxy:
```bash
curl --proxy http://127.0.0.1:7897 https://<WORKERS_DOMAIN>/
```
System proxy at `127.0.0.1:7897` (configured in macOS Wi-Fi settings).

### 2. SiliconFlow free models are not actually free
`Qwen/Qwen2.5-7B-Instruct` requires balance. Error: `{"code":30001,"message":"Sorry, your account balance is insufficient"}`. Switched LLM to Zhipu GLM-5.1 which has generous free tier. SiliconFlow still used for embedding (BGE-M3 is free).

### 3. Vectorize topK limit
`returnMetadata=all` caps topK at 50. Using topK=100 throws:
```
VECTOR_QUERY_ERROR (code = 40025): with returnValues=true or returnMetadata=all, max top K is 50
```
Fix: use topK=50 in stats route.

### 4. Secrets vs vars conflict in wrangler
Cannot `wrangler secret put X` if `X` already exists as `[vars]` in wrangler.toml. Error: `Binding name already in use`. Must remove from `[vars]` first, deploy, then set as secret.

### 5. create-next-app creates nested git repo
`npx create-next-app` runs `git init` inside the new directory. Must `rm -rf dashboard/.git` before committing from parent repo, otherwise git treats it as a submodule.

### 6. Next.js static export for Cloudflare Pages
Default Next.js build outputs to `.next/`, not `out/`. Must set `output: "export"` in `next.config.ts` for Cloudflare Pages deployment:
```ts
const nextConfig: NextConfig = { output: "export" }
```
Then deploy with `wrangler pages deploy out`.

### 7. Hono swallows error details
Default Hono error handler returns `Internal Server Error` with no details. Add global error handler:
```ts
app.onError((err, c) => c.json({ error: err.message }, 500))
```

## WeClaw Config

WeClaw is a Go-based WeChat AI bridge at `weclaw/`. HTTP mode config (`~/.weclaw/config.json`):
```json
{
  "default_agent": "pi",
  "agents": {
    "pi": {
      "type": "http",
      "endpoint": "https://<WORKERS_DOMAIN>/v1/chat/completions",
      "api_key": "<AUTH_TOKEN>",
      "model": "pi-agent",
      "max_history": 10
    }
  }
}
```

Key facts:
- Sends standard OpenAI chat completions requests
- Local API at `127.0.0.1:18011/api/send` for proactive messaging
- Voice messages auto-transcribed by WeChat
- Markdown auto-converted to plain text for WeChat
- Max history default 20 pairs (40 messages)

## Deploy Commands

```bash
# Worker
cd worker && npx wrangler deploy

# Dashboard
cd dashboard && npx next build && npx wrangler pages deploy out --project-name pi-dashboard --commit-dirty=true

# Set a secret
cd worker && npx wrangler secret put SECRET_NAME
```
