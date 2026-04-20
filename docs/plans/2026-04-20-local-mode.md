# Local Mode (No-COS) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow the project to start and run core features (text + VLM + text→image search) on a local machine without any COS configuration. Production COS path remains intact.

**Architecture:** Introduce a thin `media.ts` abstraction that hides the "local path vs COS URL" split. All storage/retrieval/display sites go through it. Defer COS requirement from module-load time to call time. Add an unauthenticated `/media/*` static route so Dashboard and `sendImage` can read local files.

**Tech Stack:** Node.js 22 + tsx, native `http`, `node:test` (built-in) for unit tests, better-sqlite3 (unchanged).

**Reference design:** `docs/plans/2026-04-20-local-mode-design.md`

**Scope:** Local-only verification. No VPS deployment in this plan.

---

### Ground rules (read before every task)

- **Commit after every task** (tests + implementation together). Use `git add <specific files>` — never `git add .` or `git add -A`.
- **TDD where testable** (pure functions in `media.ts`). Other glue code verified by type-check + manual smoke.
- **Imports:** source uses `./foo.js` specifiers even though files are `.ts` (ESM + tsx convention in this repo). Follow existing style.
- **Keep diffs minimal.** No drive-by refactors.
- **Skip a test run if prerequisites missing.** Don't invent mocks for iLink / DashScope.

---

### Task 0: Prep — add `test` script and `node:test` runner

**Files:**
- Modify: `vps/package.json`

**Step 1: Edit `vps/package.json`** — add to `"scripts"`:

```json
"test": "node --import tsx --test src/**/*.test.ts"
```

Full updated `scripts`:

```json
"scripts": {
  "start": "node --import tsx src/index.ts",
  "dev": "node --watch --import tsx src/index.ts",
  "test": "node --import tsx --test 'src/**/*.test.ts'"
}
```

**Step 2: Sanity-check the runner**

```bash
cd vps && npm test
```
Expected: either "no test files found" or a clean exit (since no tests exist yet). Not a hard failure.

**Step 3: Commit**

```bash
git add vps/package.json
git commit -m "chore(vps): add test script using node:test"
```

---

### Task 1: Add `config.cos.enabled` flag

**Files:**
- Modify: `vps/src/config.ts`

**Step 1: Edit `vps/src/config.ts`**

Replace the `cos` block:

```ts
cos: {
  enabled: !!(process.env.COS_BUCKET && process.env.COS_SECRET_ID && process.env.COS_SECRET_KEY),
  bucket: process.env.COS_BUCKET ?? '',
  region: process.env.COS_REGION ?? 'ap-shanghai',
  secretId: process.env.COS_SECRET_ID ?? '',
  secretKey: process.env.COS_SECRET_KEY ?? '',
},
```

**Step 2: Type-check**

```bash
cd vps && npx tsc --noEmit
```
Expected: no new errors (pre-existing errors acceptable, document them if encountered).

**Step 3: Commit**

```bash
git add vps/src/config.ts
git commit -m "feat(config): add cos.enabled derived flag"
```

---

### Task 2: Remove module-level throw in `cos.ts`; guard each exported function

**Files:**
- Modify: `vps/src/cos.ts`

**Step 1: Edit `vps/src/cos.ts`**

- Delete lines 4-8 (the `BUCKET` / `REGION` constants + `throw` + `COS_HOST` + `COS_BASE`)
- Replace with lazy accessors:

```ts
function cosHost(): string {
  if (!config.cos.enabled) {
    throw new Error('COS is not configured (set COS_BUCKET/COS_SECRET_ID/COS_SECRET_KEY)')
  }
  return `${config.cos.bucket}.cos.${config.cos.region}.myqcloud.com`
}

function cosBase(): string {
  return `https://${cosHost()}`
}
```

- Update `sign`, `getSignedUrl`, `uploadToCOS`, `uploadMediaToCOS` to call `cosHost()` / `cosBase()` where `COS_HOST` / `COS_BASE` were used. (Each function thereby asserts enablement on entry.)

**Step 2: Verify no module-load throw**

```bash
cd vps && unset COS_BUCKET COS_SECRET_ID COS_SECRET_KEY && node --import tsx -e "import('./src/cos.js').then(() => console.log('OK'))"
```
Expected: prints `OK`. (Previously this would have thrown.)

**Step 3: Verify eager error still happens on function call**

```bash
cd vps && node --import tsx -e "import('./src/cos.js').then(m => { try { m.getSignedUrl('https://foo.cos.ap-shanghai.myqcloud.com/x'); console.log('UNEXPECTED OK') } catch (e) { console.log('EXPECTED:', e.message) } })"
```
Expected: prints `EXPECTED: COS is not configured...`.

**Step 4: Commit**

```bash
git add vps/src/cos.ts
git commit -m "refactor(cos): defer configuration check to call site"
```

---

### Task 3: Create `media.ts` — `isLocalPath` (TDD)

**Files:**
- Create: `vps/src/media.ts`
- Create: `vps/src/media.test.ts`

**Step 1: Write the failing test** — `vps/src/media.test.ts`

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isLocalPath } from './media.js'

test('isLocalPath: http URL → false', () => {
  assert.equal(isLocalPath('http://example.com/foo.jpg'), false)
})

test('isLocalPath: https URL → false', () => {
  assert.equal(isLocalPath('https://example.com/foo.jpg'), false)
})

test('isLocalPath: absolute unix path → true', () => {
  assert.equal(isLocalPath('/opt/pi-assistant/data/media/image/x.jpg'), true)
})

test('isLocalPath: relative path → true', () => {
  assert.equal(isLocalPath('./data/media/image/x.jpg'), true)
})

test('isLocalPath: case-insensitive protocol → false', () => {
  assert.equal(isLocalPath('HTTPS://example.com/foo.jpg'), false)
})
```

**Step 2: Run test, expect failure**

```bash
cd vps && npm test -- --test-name-pattern='isLocalPath'
```
Expected: FAIL (module not found).

**Step 3: Create minimal `vps/src/media.ts`**

```ts
export function isLocalPath(p: string): boolean {
  return !/^https?:\/\//i.test(p)
}
```

**Step 4: Run test, expect pass**

```bash
cd vps && npm test -- --test-name-pattern='isLocalPath'
```
Expected: 5 passing.

**Step 5: Commit**

```bash
git add vps/src/media.ts vps/src/media.test.ts
git commit -m "feat(media): add isLocalPath helper"
```

---

### Task 4: `media.ts` — `persistMedia` (TDD, local branch only)

**Files:**
- Modify: `vps/src/media.ts`
- Modify: `vps/src/media.test.ts`

**Step 1: Append failing test**

```ts
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { persistMedia } from './media.js'

test('persistMedia: local mode writes file under MEDIA_DIR and returns absolute path', async () => {
  // config.ts reads env at import; must be set before module load. Assume COS disabled in test env.
  const bytes = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0]) // JPEG magic
  const absPath = await persistMedia(bytes, 'image')
  assert.ok(absPath.includes('/data/media/image/'), `got: ${absPath}`)
  assert.ok(existsSync(absPath), 'file should exist on disk')
  const read = readFileSync(absPath)
  assert.deepEqual(Uint8Array.from(read), bytes)
  rmSync(absPath)
})
```

**Step 2: Run, expect failure**

```bash
cd vps && npm test -- --test-name-pattern='persistMedia'
```
Expected: FAIL (`persistMedia` not exported).

**Step 3: Implement in `vps/src/media.ts`**

Append:

```ts
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { config } from './config.js'

const EXT_MAP: Record<'image' | 'voice' | 'file' | 'video', string> = {
  image: '.jpg', voice: '.silk', video: '.mp4', file: '',
}

export async function persistMedia(
  bytes: Uint8Array,
  mediaType: 'image' | 'voice' | 'file' | 'video',
  fileName?: string,
): Promise<string> {
  if (config.cos.enabled) {
    const { uploadMediaToCOS } = await import('./cos.js')
    return uploadMediaToCOS(bytes, mediaType, fileName)
  }
  const date = new Date().toISOString().slice(0, 10)
  const id = Math.random().toString(36).slice(2, 8)
  const ext = fileName ? fileName.slice(fileName.lastIndexOf('.')) : EXT_MAP[mediaType]
  const dir = join(config.mediaDir, mediaType, date)
  mkdirSync(dir, { recursive: true })
  const abs = resolve(dir, `${Date.now()}_${id}${ext}`)
  writeFileSync(abs, bytes)
  return abs
}
```

**Step 4: Run, expect pass**

```bash
cd vps && npm test -- --test-name-pattern='persistMedia'
```
Expected: passing.

**Step 5: Commit**

```bash
git add vps/src/media.ts vps/src/media.test.ts
git commit -m "feat(media): add persistMedia with local-disk + COS branches"
```

---

### Task 5: `media.ts` — `readMediaBytes` (TDD)

**Files:**
- Modify: `vps/src/media.ts`
- Modify: `vps/src/media.test.ts`

**Step 1: Append failing test**

```ts
import { mkdtempSync, writeFileSync as wf } from 'node:fs'
import { tmpdir } from 'node:os'
import { readMediaBytes } from './media.js'

test('readMediaBytes: reads local file from absolute path', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'pi-'))
  const p = join(tmp, 'x.bin')
  wf(p, Buffer.from([1, 2, 3, 4]))
  const bytes = await readMediaBytes(p)
  assert.deepEqual(Array.from(bytes), [1, 2, 3, 4])
})
```

(Remote fetch branch intentionally not unit-tested; covered by existing COS integration paths.)

**Step 2: Run, expect failure**

```bash
cd vps && npm test -- --test-name-pattern='readMediaBytes'
```
Expected: FAIL.

**Step 3: Implement**

Append to `vps/src/media.ts`:

```ts
import { readFile } from 'node:fs/promises'

export async function readMediaBytes(pathOrUrl: string): Promise<Uint8Array> {
  if (isLocalPath(pathOrUrl)) {
    const buf = await readFile(pathOrUrl)
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
  }
  // Remote: sign if COS URL, else fetch directly
  let url = pathOrUrl
  if (config.cos.enabled && url.includes('.cos.') && url.includes('.myqcloud.com')) {
    const { getSignedUrl } = await import('./cos.js')
    url = getSignedUrl(pathOrUrl, 600)
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`readMediaBytes fetch failed: ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}
```

**Step 4: Run, expect pass**

```bash
cd vps && npm test -- --test-name-pattern='readMediaBytes'
```

**Step 5: Commit**

```bash
git add vps/src/media.ts vps/src/media.test.ts
git commit -m "feat(media): add readMediaBytes (local + remote)"
```

---

### Task 6: `media.ts` — `toBase64DataUri` (TDD)

**Files:**
- Modify: `vps/src/media.ts`
- Modify: `vps/src/media.test.ts`

**Step 1: Append failing test**

```ts
import { toBase64DataUri } from './media.js'

test('toBase64DataUri: local file → data URI with correct mime by extension', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'pi-'))
  const p = join(tmp, 'x.png')
  wf(p, Buffer.from([1, 2, 3]))
  const uri = await toBase64DataUri(p)
  assert.match(uri, /^data:image\/png;base64,/)
  assert.equal(uri.split(',')[1], Buffer.from([1, 2, 3]).toString('base64'))
})

test('toBase64DataUri: explicit mime override', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'pi-'))
  const p = join(tmp, 'x.bin')
  wf(p, Buffer.from([9]))
  const uri = await toBase64DataUri(p, 'image/webp')
  assert.match(uri, /^data:image\/webp;base64,/)
})
```

**Step 2: Run, expect failure**

**Step 3: Implement** in `vps/src/media.ts`:

```ts
import { extname } from 'node:path'

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.gif': 'image/gif',
  '.webp': 'image/webp', '.bmp': 'image/bmp',
}

export async function toBase64DataUri(pathOrUrl: string, mimeType?: string): Promise<string> {
  const bytes = await readMediaBytes(pathOrUrl)
  const mime = mimeType ?? MIME_BY_EXT[extname(pathOrUrl).toLowerCase()] ?? 'image/jpeg'
  const b64 = Buffer.from(bytes).toString('base64')
  return `data:${mime};base64,${b64}`
}
```

**Step 4: Run, expect pass**

**Step 5: Commit**

```bash
git add vps/src/media.ts vps/src/media.test.ts
git commit -m "feat(media): add toBase64DataUri"
```

---

### Task 7: `media.ts` — `toDisplayUrl` (TDD, with path-traversal guard helper)

**Files:**
- Modify: `vps/src/media.ts`
- Modify: `vps/src/media.test.ts`

**Step 1: Append failing test**

```ts
import { toDisplayUrl, resolveLocalMedia } from './media.js'

test('toDisplayUrl: http URL passes through (COS disabled path)', () => {
  assert.equal(toDisplayUrl('http://example.com/a.jpg'), 'http://example.com/a.jpg')
})

test('toDisplayUrl: local abs path → /media/<rel>', () => {
  const abs = resolve(config.mediaDir, 'image/2026-04-20/x.jpg')
  assert.equal(toDisplayUrl(abs), '/media/image/2026-04-20/x.jpg')
})

test('resolveLocalMedia: rejects path traversal', () => {
  assert.equal(resolveLocalMedia('../etc/passwd'), null)
  assert.equal(resolveLocalMedia('image/../../../../etc/passwd'), null)
})

test('resolveLocalMedia: accepts legit nested path', () => {
  const p = resolveLocalMedia('image/2026-04-20/x.jpg')
  assert.ok(p && p.startsWith(resolve(config.mediaDir)))
})
```

**Step 2: Run, expect failure**

**Step 3: Implement**

```ts
import { relative, sep } from 'node:path'

export function toDisplayUrl(pathOrUrl: string): string {
  if (!isLocalPath(pathOrUrl)) {
    if (config.cos.enabled && pathOrUrl.includes('.cos.') && pathOrUrl.includes('.myqcloud.com')) {
      // Lazy import to avoid top-level cos dependency when disabled
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { getSignedUrl } = require('./cos.js')
      return getSignedUrl(pathOrUrl, 3600)
    }
    return pathOrUrl
  }
  const mediaRoot = resolve(config.mediaDir)
  const rel = relative(mediaRoot, pathOrUrl).split(sep).join('/')
  return `/media/${rel}`
}

/** Given a `/media/<rel>` suffix, return absolute path if safe, else null. */
export function resolveLocalMedia(rel: string): string | null {
  const mediaRoot = resolve(config.mediaDir)
  const abs = resolve(mediaRoot, rel)
  if (abs !== mediaRoot && !abs.startsWith(mediaRoot + sep)) return null
  return abs
}
```

Note on `require`: if `require` is unavailable in pure-ESM mode, replace with a synchronous static import (acceptable because `cos.ts` is safe to import now that it has no top-level throw). Prefer:

```ts
import { getSignedUrl } from './cos.js'
// ... then inside toDisplayUrl just call getSignedUrl directly
```

If that pulls `cos.ts` into the bundle even for local users, that is fine (its functions just throw when called without config).

**Step 4: Run, expect pass**

**Step 5: Commit**

```bash
git add vps/src/media.ts vps/src/media.test.ts
git commit -m "feat(media): add toDisplayUrl and resolveLocalMedia guard"
```

---

### Task 8: Refactor `ilink.ts:downloadMedia` to use `persistMedia`

**Files:**
- Modify: `vps/src/ilink.ts:200-230`

**Step 1: Replace the body after `decryptAesEcb`**

Delete the `if (config.cos.secretId && config.cos.secretKey) { ... } else { local-disk }` block. Replace with:

```ts
const { persistMedia } = await import('./media.js')
const stored = await persistMedia(decrypted, mediaType, fileName)
console.log(`📦 media stored: ${stored}`)
return stored
```

Remove the now-unused imports (`uploadMediaToCOS`, `writeFile`, `join`, `mkdirSync`, `EXT_MAP` if unused elsewhere). Leave what's still used.

**Step 2: Type-check**

```bash
cd vps && npx tsc --noEmit
```
Expected: no new errors.

**Step 3: Manual import smoke**

```bash
cd vps && unset COS_BUCKET COS_SECRET_ID COS_SECRET_KEY && node --import tsx -e "import('./src/ilink.js').then(() => console.log('OK'))"
```
Expected: `OK`.

**Step 4: Commit**

```bash
git add vps/src/ilink.ts
git commit -m "refactor(ilink): route downloadMedia through persistMedia"
```

---

### Task 9: Refactor `ilink.ts:sendImage` to use `readMediaBytes`

**Files:**
- Modify: `vps/src/ilink.ts:361-365`

**Step 1: Replace step 1 of `sendImage`**

Old:
```ts
const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(15000) })
if (!imgRes.ok) throw new Error(`Failed to download image: ${imgRes.status}`)
const raw = new Uint8Array(await imgRes.arrayBuffer())
```

New:
```ts
const { readMediaBytes } = await import('./media.js')
const raw = await readMediaBytes(imageUrl)
```

**Step 2: Type-check**

```bash
cd vps && npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add vps/src/ilink.ts
git commit -m "refactor(ilink): sendImage reads via readMediaBytes"
```

---

### Task 10: Wire VLM caption to base64 data URI + skip visual embedding locally

**Files:**
- Modify: `vps/src/index.ts:71-113`

**Step 1: Replace the image embedding block**

Inside the `for (const url of mediaPaths)` loop, inside the async IIFE:

Old:
```ts
const signedUrl = getSignedUrl(url, 600)
// ... VLM captioning using signedUrl
// ... getMultimodalEmbedding([{ image: signedUrl }])
```

New:
```ts
const { toBase64DataUri, isLocalPath } = await import('./media.js')
const dataUri = await toBase64DataUri(url)

// 1. VLM caption — accepts data URI
// ... same chat/completions call, but image_url.url = dataUri

// 3. Image visual embedding — DashScope multimodal needs public URL; skip locally
if (isLocalPath(url)) {
  console.log('🖼️ 本地模式：跳过图片视觉 embedding（仅保留文本描述检索）')
} else {
  const { getSignedUrl } = await import('./cos.js')
  const signedUrl = getSignedUrl(url, 600)
  const imgEmbedding = await getMultimodalEmbedding([{ image: signedUrl }])
  const imgId = `imgv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  insertVector(imgId, imgEmbedding, caption, 'image_visual', contactId, 'store', url)
  console.log(`🧠 图片视觉embedding已存库: ${imgId}`)
}
```

Remove the now-unused top-level `import { getSignedUrl } from './cos'` if no other caller remains (check `index.ts:143` — it uses its own regex-scoped import; and `:453` uses dynamic import). If a top-level reference still exists elsewhere in `index.ts`, keep the import.

**Step 2: Type-check**

```bash
cd vps && npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add vps/src/index.ts
git commit -m "feat(index): VLM via base64 + skip visual embedding in local mode"
```

---

### Task 11: Refactor `/api/files` to use `toDisplayUrl`

**Files:**
- Modify: `vps/src/index.ts:450-459`

**Step 1: Replace**

Old:
```ts
const { getSignedUrl } = await import('./cos.js')
const files = (getFiles() as any[]).map((f) => ({
  ...f,
  signed_url: f.media_path ? getSignedUrl(f.media_path) : null,
}))
```

New:
```ts
const { toDisplayUrl } = await import('./media.js')
const files = (getFiles() as any[]).map((f) => ({
  ...f,
  signed_url: f.media_path ? toDisplayUrl(f.media_path) : null,
}))
```

**Step 2: Type-check**

**Step 3: Commit**

```bash
git add vps/src/index.ts
git commit -m "refactor(api/files): use toDisplayUrl for cross-mode URLs"
```

---

### Task 12: Remove `getSignedUrl` from `search-images` skill

**Files:**
- Modify: `vps/src/skills/search-images.ts:3, 54`

**Step 1: Remove the import and unwrap call**

- Delete `import { getSignedUrl } from '../cos.js'`
- Change `sideEffects: { imageUrls: matched.map((r) => getSignedUrl(r.mediaUrl!, 3600)) }` to `sideEffects: { imageUrls: matched.map((r) => r.mediaUrl!) }`

Downstream `sendImage` handles both local paths and URLs via `readMediaBytes` (Task 9).

**Step 2: Type-check**

**Step 3: Commit**

```bash
git add vps/src/skills/search-images.ts
git commit -m "refactor(search-images): emit raw mediaUrl, let sendImage resolve"
```

---

### Task 13: Add `GET /media/*` static route with traversal guard

**Files:**
- Modify: `vps/src/index.ts` (HTTP server route table)

**Step 1: Add route**

Locate the route section (after the public routes block, before `/api/*`). Insert:

```ts
// Public: local media files (only relevant when COS disabled)
if (method === 'GET' && url.pathname.startsWith('/media/')) {
  const { resolveLocalMedia } = await import('./media.js')
  const rel = decodeURIComponent(url.pathname.slice('/media/'.length))
  const abs = resolveLocalMedia(rel)
  if (!abs || !existsSync(abs) || !statSync(abs).isFile()) {
    return json(res, { error: 'Not found' }, 404)
  }
  const ext = extname(abs).toLowerCase()
  const mime = ({
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
    '.silk': 'audio/silk', '.mp4': 'video/mp4',
  } as Record<string, string>)[ext] ?? 'application/octet-stream'
  res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'private, max-age=300' })
  createReadStream(abs).pipe(res)
  return
}
```

**Step 2: Start server, verify route**

```bash
cd vps && npm run dev &
# Wait ~2s for boot, then:
curl -sI http://localhost:18011/media/image/does-not-exist.jpg
# Expected: HTTP/1.1 404
```

Create a dummy file and verify 200:

```bash
mkdir -p vps/data/media/image/2026-04-20
printf '\xFF\xD8\xFF\xE0' > vps/data/media/image/2026-04-20/test.jpg
curl -sI http://localhost:18011/media/image/2026-04-20/test.jpg
# Expected: HTTP/1.1 200 + Content-Type: image/jpeg
```

Verify traversal guard:

```bash
curl -sI "http://localhost:18011/media/../../../etc/passwd"
# Expected: HTTP/1.1 404
```

Kill dev server:
```bash
kill %1 2>/dev/null; wait 2>/dev/null
```

**Step 3: Commit**

```bash
git add vps/src/index.ts
git commit -m "feat(http): add GET /media/* with path-traversal guard"
```

---

### Task 14: Update `.env.example`

**Files:**
- Modify: `vps/env.example`

**Step 1: Edit**

Replace the COS block (lines 16-20) with:

```
# 腾讯云 COS (媒体存储) — OPTIONAL
# 留空则使用本地磁盘 (./data/media/*)，Dashboard 通过 /media/* 路由访问
# 本地模式下"以图搜图"会退化为"以文搜图"（基于 VLM 描述）
# COS_SECRET_ID=
# COS_SECRET_KEY=
# COS_BUCKET=
# COS_REGION=ap-shanghai
```

**Step 2: Commit**

```bash
git add vps/env.example
git commit -m "docs(env): mark COS_* as optional with local-mode notes"
```

---

### Task 15: Update `README.md` with local-mode section

**Files:**
- Modify: `README.md`

**Step 1: Append a new section "本地开发 (无需 COS)"** with:

```markdown
## 本地开发（无需 COS）

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
pnpm install   # 或 npm install
npm run dev
```

- Dashboard: `http://localhost:18011`
- 媒体文件落到 `vps/data/media/<type>/<date>/`
- 媒体通过 `GET /media/<rel>` 对外可读（**未鉴权**，勿暴露到公网）
- 图片 VLM 描述正常工作（base64 内联送 DashScope）
- 文字→图片搜索正常工作（基于 VLM 描述的文本向量）
- **图片→图片搜索在本地模式下不可用**（DashScope 多模态 embedding 只收公网 URL）

切换到 COS 模式：只需在 `.env` 补齐 `COS_SECRET_ID` / `COS_SECRET_KEY` / `COS_BUCKET`，重启即可。
```

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs(readme): add local-mode quickstart"
```

---

### Task 16: Update `CLAUDE.md` with "Storage modes" section

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Insert before "## Known Issues"**

```markdown
## Storage Modes

自动检测：`COS_BUCKET` + `COS_SECRET_ID` + `COS_SECRET_KEY` 三者齐备 → COS 模式；否则 → 本地模式。

| 能力 | COS | 本地 |
|---|---|---|
| 媒体落盘 | COS Bucket | `./data/media/<type>/<date>/` |
| 对外访问 | 签名 URL (`getSignedUrl`) | `GET /media/<rel>` (未鉴权) |
| VLM 描述 | 公网 URL | base64 data URI |
| 图片→图片搜索 | ✅ | ⚠️ 跳过 |
| `sendImage` | fetch(COS) | 本地读文件 |

路径/URL 统一抽象在 `src/media.ts`：`isLocalPath`、`persistMedia`、`readMediaBytes`、`toBase64DataUri`、`toDisplayUrl`、`resolveLocalMedia`。
```

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude): document storage modes"
```

---

### Task 17: Final local smoke test

**Files:** none

**Step 1: Clean env + start**

```bash
cd vps
unset COS_BUCKET COS_SECRET_ID COS_SECRET_KEY
# Ensure .env does NOT set COS_* either
npm run dev
```

**Step 2: In a second terminal, verify**

```bash
curl -s http://localhost:18011/health | head
# Expected: JSON with ok=true

# Login
TOKEN=$(curl -s -X POST http://localhost:18011/api/auth/login \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$ADMIN_PASSWORD\"}" \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).token))')

# Files list works without COS
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:18011/api/files | head
```

**Step 3: Run unit tests**

```bash
cd vps && npm test
```
Expected: all `media.test.ts` tests pass.

**Step 4: Kill dev server**

```bash
# Stop the npm run dev process
```

**Step 5: Mark plan complete** — no commit (nothing changed).

---

## Rollback plan

Every task is a single commit. If something breaks, `git revert <sha>` that commit. All changes are additive except the `cos.ts` throw removal, which is safe because the throw was purely defensive.

## Out of scope

- VPS deployment / systemd / `scp` / `ssh`
- Rebuilding the Next.js Dashboard (no frontend changes needed; `/media/*` is a same-origin URL)
- Migrating any existing COS media to local (one-way: you can still download COS objects manually)
- Authenticating `/media/*` (intentionally unauthed; see README warning)
