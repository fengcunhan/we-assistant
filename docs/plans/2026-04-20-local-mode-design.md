# 本地模式（无需 COS）改造设计

日期：2026-04-20
状态：已确认，待实现

## 目标

让项目在本地开发环境下无需配置腾讯云 COS 即可启动并完整使用核心能力（收发消息、媒体落盘、VLM 描述、文字→图片搜索）。保留 COS 作为生产路径，改动做成"可选切换"。

## 当前耦合

- `vps/src/cos.ts:6` 在模块加载时 `throw new Error('COS_BUCKET must be set')`，不设 COS 就启动不了
- `vps/src/ilink.ts:216` 下载媒体时已有本地磁盘 fallback（但上下游把返回值当 COS URL 用）
- `vps/src/index.ts:75`（VLM 描述）、`:104`（图片视觉 embedding）、`:456`（`/api/files` 面板）无条件调 `getSignedUrl`
- `vps/src/skills/search-images.ts:54` 对 `mediaUrl` 调 `getSignedUrl`，传给 `ilink.sendImage`
- `vps/src/ilink.ts:363` `sendImage` 用 `fetch(imageUrl)` 下载图片再上传到 iLink CDN——本地路径 fetch 不到

## 模式边界

| 能力 | COS 模式 | 本地模式 |
|---|---|---|
| 启动 | ✅ | ✅ |
| 文本消息 | ✅ | ✅ |
| 媒体落盘（图片/语音/文件/视频） | ✅ COS | ✅ `./data/media/` |
| 定时提醒、对话历史、知识库 | ✅ | ✅ |
| VLM 图片描述（chat/completions） | ✅ 公网 URL | ✅ base64 data URI |
| 文字→图片搜索（基于描述的文本向量） | ✅ | ✅ |
| 图片→图片搜索（视觉向量） | ✅ | ⚠️ **跳过**（DashScope 多模态 embedding 只收公网 URL，本地不可达） |
| Dashboard 预览媒体 | ✅ 签名 URL | ✅ `/media/*` |
| 微信发图回显（`sendImage`） | ✅ fetch(COS) | ✅ 读本地文件 |

## 设计

### 1. 模式检测

`config.ts`：

```ts
cos: {
  enabled: !!(process.env.COS_BUCKET && process.env.COS_SECRET_ID && process.env.COS_SECRET_KEY),
  bucket: process.env.COS_BUCKET ?? '',
  region: process.env.COS_REGION ?? 'ap-shanghai',
  secretId: process.env.COS_SECRET_ID ?? '',
  secretKey: process.env.COS_SECRET_KEY ?? '',
},
```

三字段齐备→COS 模式；否则→本地模式。无显式开关。

`cos.ts` 移除顶层 `throw`；所有函数进入时先检 `config.cos.enabled`，未启用则抛 `throw new Error('COS not configured')`（走新抽象后理论上不应再被意外调用）。

### 2. 新增 `vps/src/media.ts`

集中封装"路径可能是 COS URL 也可能是本地磁盘绝对路径"的分歧：

```ts
isLocalPath(p: string): boolean
  // !/^https?:\/\//i.test(p)

persistMedia(
  bytes: Uint8Array,
  mediaType: 'image' | 'voice' | 'file' | 'video',
  fileName?: string,
): Promise<string>
  // COS 模式 → uploadMediaToCOS
  // 本地模式 → 写 ./data/media/<type>/<date>/<ts>_<id><ext>，返回绝对路径

readMediaBytes(p: string): Promise<Uint8Array>
  // 本地 → readFile(p)
  // 远程 → fetch(getSignedUrl(p)) 或直接 fetch(p)

toBase64DataUri(
  p: string,
  mimeType?: string, // 默认从扩展名推断，兜底 image/jpeg
): Promise<string>
  // 返回 "data:image/jpeg;base64,<...>"

toDisplayUrl(p: string): string
  // 本地 → /media/<relative-from-mediaDir>
  // COS  → getSignedUrl(p, 3600)
```

这五个 API 吸收所有分叉。上层代码不再直接判断模式。

### 3. `GET /media/*` 静态路由

`index.ts` HTTP server 新增：

```
GET /media/<rel>
→ path.resolve(config.mediaDir, <rel>)
→ 白名单校验（防 path traversal：resolved path 必须在 mediaDir 之内）
→ 读文件流式返回，推断 Content-Type
```

**不加 JWT**。理由：
- Dashboard `<img src="/media/...">` 简单
- 与 `public/` 静态目录一致（也是 unauth）
- 默认只监听 `:18011`，用户决定是否公网暴露

README 补风险提示。

### 4. 调用点改造

| 文件 | 旧 | 新 |
|---|---|---|
| `index.ts:75`（VLM caption） | `getSignedUrl(url, 600)` → `image_url: {url: signedUrl}` | `await toBase64DataUri(url)` → `image_url: {url: dataUri}` |
| `index.ts:104`（image_visual embedding） | `getMultimodalEmbedding([{image: signedUrl}])` | 若 `isLocalPath(url)` → 跳过并打印日志；否则保留 |
| `index.ts:143`（回复文本签名） | `replace(COS_URL_RE, ...)` | 保持——正则只命中 COS 域，本地路径天然不命中 |
| `index.ts:456`（`/api/files`） | `getSignedUrl(f.media_path)` | `toDisplayUrl(f.media_path)` |
| `skills/search-images.ts:54` | `getSignedUrl(r.mediaUrl!, 3600)` | 直接透传 `r.mediaUrl!` |
| `ilink.ts:downloadMedia:216` | 手写 if/else 分叉 | `await persistMedia(decrypted, mediaType, fileName)` |
| `ilink.ts:sendImage:363` | `fetch(imageUrl)` | `await readMediaBytes(imageUrl)` |

### 5. 文档

- `.env.example`：COS 块加 `# Optional (omit to use local disk)` 注释
- `README.md`：新增"本地开发（无需 COS）"章节，列最小启动变量（`LLM_API_KEY` + `DASHSCOPE_API_KEY` + `ADMIN_PASSWORD` + `JWT_SECRET`）；提示 `/media/*` 未鉴权
- `CLAUDE.md`：在 Known Issues 前增 "Storage modes" 一节（本地/COS 差异表）

### 6. 不改的事

- DB schema 不动（`media_path` 字段本就兼容两种值）
- iLink 协议 / AES 解密 / scheduler / agent loop / skills 接口 不动
- COS 代码保留并可切换
- Dashboard 代码无需修改（`signed_url` 字段语义从"签名 URL"变成"可访问 URL"，前端用法不变）

## 验证（只在本地）

**范围**：全部在本机（Mac）跑。**不** `scp` / **不** `ssh` / **不** 碰 VPS。

- **本地启动**：`cd vps && pnpm install && node --import tsx src/index.ts`（或项目现有的 dev 命令）
  - `.env` 里 **不设** `COS_BUCKET` / `COS_SECRET_ID` / `COS_SECRET_KEY`
  - 进程起来无异常，HTTP `:18011` 可访问
- **冒烟**：
  - `curl http://localhost:18011/health` 返回 ok
  - Dashboard `http://localhost:18011` 能打开，登录用 `ADMIN_PASSWORD`
  - 扫码登录微信机器人（如不方便扫码，这一步跳过，只验证 HTTP 层）
- **媒体路径**：如完成扫码并发过图 → 查 `./data/media/image/<date>/...` 有文件；日志出现 "本地模式跳过 image_visual"
- **静态路由**：`curl http://localhost:18011/media/<rel>` 能拿到字节；尝试 `../etc/passwd` 应返回 404
- **单元测试**：`media.ts` 四个纯函数（`isLocalPath` / `readMediaBytes` / `toBase64DataUri` / `toDisplayUrl`），path traversal 用例必须覆盖
- **回归**（若有 COS 测试凭据）：保留 `COS_*` 启动，`/api/files` 返回签名 URL 与改造前一致。**无凭据就跳过此项**。

部署到 VPS 不在本次范围内，留给下一次动作。

## 改动清单

新增：
- `vps/src/media.ts`
- `docs/plans/2026-04-20-local-mode-design.md`（本文）

修改：
- `vps/src/config.ts`
- `vps/src/cos.ts`
- `vps/src/ilink.ts`
- `vps/src/index.ts`
- `vps/src/skills/search-images.ts`
- `vps/.env.example`
- `README.md`
- `CLAUDE.md`

预计 diff 规模：~200 行增、~40 行删。
