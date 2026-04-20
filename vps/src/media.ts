export function isLocalPath(p: string): boolean {
  return !/^https?:\/\//i.test(p)
}

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
  const dot = fileName ? fileName.lastIndexOf('.') : -1
  const ext = dot >= 0 ? fileName!.slice(dot) : EXT_MAP[mediaType]
  const dir = join(config.mediaDir, mediaType, date)
  mkdirSync(dir, { recursive: true })
  const abs = resolve(dir, `${Date.now()}_${id}${ext}`)
  writeFileSync(abs, bytes)
  return abs
}

import { readFile } from 'node:fs/promises'

export async function readMediaBytes(pathOrUrl: string): Promise<Uint8Array> {
  if (isLocalPath(pathOrUrl)) {
    const buf = await readFile(pathOrUrl)
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
  }
  let url = pathOrUrl
  if (config.cos.enabled && url.includes('.cos.') && url.includes('.myqcloud.com')) {
    const { getSignedUrl } = await import('./cos.js')
    url = getSignedUrl(pathOrUrl, 600)
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`readMediaBytes fetch failed: ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

import { extname } from 'node:path'

export const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.gif': 'image/gif',
  '.webp': 'image/webp', '.bmp': 'image/bmp',
  '.silk': 'audio/silk', '.mp4': 'video/mp4',
}

export async function toBase64DataUri(pathOrUrl: string, mimeType?: string): Promise<string> {
  const bytes = await readMediaBytes(pathOrUrl)
  const mime = mimeType ?? MIME_BY_EXT[extname(pathOrUrl).toLowerCase()] ?? 'image/jpeg'
  const b64 = Buffer.from(bytes).toString('base64')
  return `data:${mime};base64,${b64}`
}

import { relative, sep, isAbsolute } from 'node:path'
import { getSignedUrl } from './cos.js'

export function toDisplayUrl(pathOrUrl: string): string {
  if (!isLocalPath(pathOrUrl)) {
    if (config.cos.enabled && pathOrUrl.includes('.cos.') && pathOrUrl.includes('.myqcloud.com')) {
      return getSignedUrl(pathOrUrl, 3600)
    }
    return pathOrUrl
  }
  const mediaRoot = resolve(config.mediaDir)
  const abs = resolve(pathOrUrl)
  if (abs !== mediaRoot && !abs.startsWith(mediaRoot + sep)) {
    throw new Error(`toDisplayUrl: path outside mediaDir: ${pathOrUrl}`)
  }
  const rel = relative(mediaRoot, abs).split(sep).join('/')
  return `/media/${rel}`
}

/**
 * Given a `/media/<rel>` URL suffix, return an absolute path safely under
 * config.mediaDir, or null if the input escapes that root. Rejects empty
 * input and absolute paths.
 *
 * CONTRACT: `rel` MUST be URL-decoded by the caller (e.g. `decodeURIComponent`).
 * Passing a percent-encoded string means traversal attempts encoded as `%2e%2e`
 * will slip through as literal filenames and cause readFile to ENOENT rather
 * than being rejected here.
 */
export function resolveLocalMedia(rel: string): string | null {
  if (!rel || isAbsolute(rel)) return null
  const mediaRoot = resolve(config.mediaDir)
  const abs = resolve(mediaRoot, rel)
  if (!abs.startsWith(mediaRoot + sep)) return null
  return abs
}
