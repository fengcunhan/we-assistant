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
  const ext = fileName ? fileName.slice(fileName.lastIndexOf('.')) : EXT_MAP[mediaType]
  const dir = join(config.mediaDir, mediaType, date)
  mkdirSync(dir, { recursive: true })
  const abs = resolve(dir, `${Date.now()}_${id}${ext}`)
  writeFileSync(abs, bytes)
  return abs
}
