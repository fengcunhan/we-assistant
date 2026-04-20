import { createHmac, createHash } from 'crypto'
import { config } from './config.js'

function cosHost(): string {
  if (!config.cos.enabled) {
    throw new Error('COS is not configured (set COS_BUCKET/COS_SECRET_ID/COS_SECRET_KEY)')
  }
  return `${config.cos.bucket}.cos.${config.cos.region}.myqcloud.com`
}

function cosBase(): string {
  return `https://${cosHost()}`
}

/**
 * Generate Tencent COS authorization header.
 * https://cloud.tencent.com/document/product/436/7778
 */
function sign(method: string, path: string, headers: Record<string, string>): string {
  const secretId = config.cos.secretId
  const secretKey = config.cos.secretKey
  const now = Math.floor(Date.now() / 1000)
  const exp = now + 600 // 10 min
  const keyTime = `${now};${exp}`

  // SignKey
  const signKey = createHmac('sha1', secretKey).update(keyTime).digest('hex')

  // HttpString
  const httpString = `${method.toLowerCase()}\n${path}\n\n\n`

  // StringToSign
  const sha1HttpString = createHash('sha1').update(httpString).digest('hex')
  const stringToSign = `sha1\n${keyTime}\n${sha1HttpString}\n`

  // Signature
  const signature = createHmac('sha1', signKey).update(stringToSign).digest('hex')

  return `q-sign-algorithm=sha1&q-ak=${secretId}&q-sign-time=${keyTime}&q-key-time=${keyTime}&q-header-list=&q-url-param-list=&q-signature=${signature}`
}

/**
 * Upload a buffer to COS and return the public URL.
 */
/**
 * Generate a pre-signed URL for reading a COS object.
 */
export function getSignedUrl(cosUrl: string, expSeconds = 3600): string {
  const url = new URL(cosUrl)
  const path = url.pathname
  const authorization = sign('GET', path, {})
  return `${cosBase()}${path}?${authorization}`
}

export async function uploadToCOS(
  data: Uint8Array,
  key: string,
  contentType = 'application/octet-stream'
): Promise<string> {
  const path = `/${key}`
  const authorization = sign('PUT', path, {})

  const host = cosHost()
  const base = `https://${host}`
  const res = await fetch(`${base}${path}`, {
    method: 'PUT',
    headers: {
      Authorization: authorization,
      'Content-Type': contentType,
      'Content-Length': String(data.byteLength),
      Host: host,
    },
    body: data,
    signal: AbortSignal.timeout(30000),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`COS upload failed (${res.status}): ${body.slice(0, 200)}`)
  }

  return `${base}${path}`
}

/**
 * Upload media file to COS with organized path.
 * Returns the public URL.
 */
export async function uploadMediaToCOS(
  data: Uint8Array,
  mediaType: 'image' | 'voice' | 'file' | 'video',
  fileName?: string
): Promise<string> {
  const date = new Date().toISOString().slice(0, 10) // 2026-03-31
  const id = Math.random().toString(36).slice(2, 8)
  const ext = fileName
    ? fileName.slice(fileName.lastIndexOf('.'))
    : { image: '.jpg', voice: '.silk', video: '.mp4', file: '' }[mediaType]
  const key = `media/${mediaType}/${date}/${Date.now()}_${id}${ext}`

  const contentType = {
    image: 'image/jpeg',
    voice: 'audio/silk',
    video: 'video/mp4',
    file: 'application/octet-stream',
  }[mediaType]

  return uploadToCOS(data, key, contentType)
}
