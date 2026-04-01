import { writeFile } from 'fs/promises'
import { join } from 'path'
import { config } from './config.js'
import { uploadMediaToCOS } from './cos.js'

export interface Credentials {
  botToken: string
  ilinkBotId: string
  baseURL: string
  ilinkUserId: string
}

interface MediaInfo {
  encrypt_query_param?: string
  aes_key?: string
  full_url?: string
}

export interface ILinkMessage {
  from_user_id: string
  to_user_id: string
  message_type: number
  context_token: string
  item_list: Array<{
    type: number
    text_item?: { text: string }
    image_item?: { aeskey?: string; media?: MediaInfo }
    voice_item?: { voice_text?: string; text?: string; aeskey?: string; media?: MediaInfo }
    file_item?: { file_name?: string; file_size?: number; aeskey?: string; media?: MediaInfo }
    video_item?: { duration_ms?: number; aeskey?: string; media?: MediaInfo }
  }>
}

interface GetUpdatesResponse {
  ret: number
  errcode?: number
  errmsg?: string
  msgs: ILinkMessage[]
  get_updates_buf: string
}

function headers(creds: Credentials): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    AuthorizationType: 'ilink_bot_token',
    'X-WECHAT-UIN': btoa(String(Math.floor(Math.random() * 4294967295))),
    Authorization: `Bearer ${creds.botToken}`,
  }
}

export async function getUpdates(creds: Credentials, cursor: string): Promise<GetUpdatesResponse> {
  const res = await fetch(`${creds.baseURL}/ilink/bot/getupdates`, {
    method: 'POST',
    headers: headers(creds),
    body: JSON.stringify({ get_updates_buf: cursor, base_info: { channel_version: '1.0.2' } }),
    signal: AbortSignal.timeout(40000),
  })
  if (!res.ok) throw new Error(`iLink getupdates HTTP ${res.status}: ${await res.text().catch(() => '')}`)
  return res.json() as Promise<GetUpdatesResponse>
}

function newClientId(): string {
  return crypto.randomUUID()
}

export async function sendMessage(creds: Credentials, toUserId: string, contextToken: string, text: string): Promise<void> {
  const res = await fetch(`${creds.baseURL}/ilink/bot/sendmessage`, {
    method: 'POST',
    headers: headers(creds),
    body: JSON.stringify({
      msg: {
        from_user_id: creds.ilinkBotId,
        to_user_id: toUserId,
        client_id: newClientId(),
        message_type: 2, message_state: 2,
        context_token: contextToken,
        item_list: [{ type: 1, text_item: { text } }],
      },
    }),
  })
  const body = await res.json().catch(() => null) as { ret?: number; errcode?: number; errmsg?: string } | null
  if (!res.ok || (body?.ret && body.ret !== 0)) {
    console.error(`⚠️ sendMessage failed:`, JSON.stringify(body))
  } else {
    console.log(`✉️ sendMessage ok:`, JSON.stringify(body))
  }
}

export async function sendTyping(creds: Credentials, ticket: string, toUserId: string): Promise<void> {
  await fetch(`${creds.baseURL}/ilink/bot/sendtyping`, {
    method: 'POST',
    headers: headers(creds),
    body: JSON.stringify({ ilink_user_id: toUserId, typing_ticket: ticket, status: 1 }),
  }).catch(() => {})
}

export async function getTypingTicket(creds: Credentials): Promise<string> {
  const res = await fetch(`${creds.baseURL}/ilink/bot/getconfig`, {
    method: 'POST',
    headers: headers(creds),
    body: JSON.stringify({ ilink_user_id: creds.ilinkUserId, context_token: '' }),
  })
  if (!res.ok) return ''
  const data = await res.json() as { typing_ticket?: string }
  return data.typing_ticket ?? ''
}

export async function getQrCode(baseURL: string): Promise<{ qrcode: string; qrcodeUrl: string }> {
  const res = await fetch(`${baseURL}/ilink/bot/get_bot_qrcode?bot_type=3`, {
    headers: { 'Content-Type': 'application/json', AuthorizationType: 'ilink_bot_token' },
  })
  const data = await res.json() as { qrcode: string; qrcode_img_content: string }
  return { qrcode: data.qrcode, qrcodeUrl: data.qrcode_img_content }
}

export async function pollQrStatus(baseURL: string, qrcode: string): Promise<Credentials | null> {
  const res = await fetch(`${baseURL}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`, {
    headers: { 'Content-Type': 'application/json', AuthorizationType: 'ilink_bot_token' },
  })
  const data = await res.json() as { status: string; bot_token?: string; ilink_bot_id?: string; baseurl?: string; ilink_user_id?: string }
  if (data.status !== 'confirmed') return null
  return {
    botToken: data.bot_token!,
    ilinkBotId: data.ilink_bot_id!,
    baseURL: data.baseurl || baseURL,
    ilinkUserId: data.ilink_user_id ?? '',
  }
}

export function isAuthError(res: GetUpdatesResponse): boolean {
  return res.errcode === -14 || res.ret === 401 || res.ret === 403
}

// --- Media download (AES-ECB decrypt + save to disk) ---

// Minimal AES-128-ECB for iLink CDN decryption
const SBOX = new Uint8Array([0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16])
const INV_SBOX = new Uint8Array(256); for (let i = 0; i < 256; i++) INV_SBOX[SBOX[i]] = i
const RCON = [0x01,0x02,0x04,0x08,0x10,0x20,0x40,0x80,0x1b,0x36]

function xtime(a: number) { return ((a << 1) ^ ((a >> 7) * 0x1b)) & 0xff }
function mul(a: number, b: number) { let p = 0; for (let i = 0; i < 8; i++) { if (b & 1) p ^= a; a = xtime(a); b >>= 1 } return p & 0xff }

function expandKey(key: Uint8Array): Uint32Array {
  const w = new Uint32Array(44)
  for (let i = 0; i < 4; i++) w[i] = (key[4*i]<<24)|(key[4*i+1]<<16)|(key[4*i+2]<<8)|key[4*i+3]
  for (let i = 4; i < 44; i++) {
    let t = w[i-1]
    if (i%4===0) t = ((SBOX[(t>>16)&0xff]<<24)|(SBOX[(t>>8)&0xff]<<16)|(SBOX[t&0xff]<<8)|SBOX[(t>>24)&0xff])^(RCON[i/4-1]<<24)
    w[i] = w[i-4]^t
  }
  return w
}

function decryptBlock(block: Uint8Array, rk: Uint32Array): Uint8Array {
  const s = new Uint8Array(16)
  for (let i = 0; i < 16; i++) s[i] = block[i]^((rk[40+(i>>2)]>>(24-(i%4)*8))&0xff)
  for (let r = 9; r >= 0; r--) {
    let t = s[13]; s[13]=s[9]; s[9]=s[5]; s[5]=s[1]; s[1]=t
    t=s[10]; s[10]=s[2]; s[2]=t; t=s[14]; s[14]=s[6]; s[6]=t
    t=s[3]; s[3]=s[7]; s[7]=s[11]; s[11]=s[15]; s[15]=t
    for (let i = 0; i < 16; i++) s[i] = INV_SBOX[s[i]]
    for (let i = 0; i < 16; i++) s[i] ^= (rk[r*4+(i>>2)]>>(24-(i%4)*8))&0xff
    if (r > 0) for (let c = 0; c < 4; c++) {
      const i=c*4, a0=s[i],a1=s[i+1],a2=s[i+2],a3=s[i+3]
      s[i]=mul(a0,14)^mul(a1,11)^mul(a2,13)^mul(a3,9)
      s[i+1]=mul(a0,9)^mul(a1,14)^mul(a2,11)^mul(a3,13)
      s[i+2]=mul(a0,13)^mul(a1,9)^mul(a2,14)^mul(a3,11)
      s[i+3]=mul(a0,11)^mul(a1,13)^mul(a2,9)^mul(a3,14)
    }
  }
  return s
}

function decryptAesEcb(data: Uint8Array, key: Uint8Array): Uint8Array {
  const rk = expandKey(key)
  const out = new Uint8Array(data.length)
  for (let off = 0; off < data.length; off += 16) out.set(decryptBlock(data.subarray(off, off+16), rk), off)
  const pad = out[out.length - 1]
  return (pad > 0 && pad <= 16) ? out.subarray(0, out.length - pad) : out
}

const CDN = 'https://novac2c.cdn.weixin.qq.com/c2c'
const EXT_MAP: Record<string, string> = { image: '.jpg', voice: '.silk', file: '', video: '.mp4' }

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16)
  return bytes
}

/**
 * Download media from iLink CDN, decrypt, and save to disk.
 * Returns the local file path.
 *
 * aesKeyField: hex string (from iLink message item.aeskey)
 * CDN URL: /download?encrypted_query_param=<urlencoded param>
 */
export async function downloadMedia(
  encryptQueryParam: string,
  aesKeyHex: string,
  mediaType: 'image' | 'voice' | 'file' | 'video',
  fileName?: string
): Promise<string> {
  const downloadURL = `${CDN}/download?encrypted_query_param=${encodeURIComponent(encryptQueryParam)}`
  const res = await fetch(downloadURL, { signal: AbortSignal.timeout(30000) })
  if (!res.ok) throw new Error(`CDN download failed: ${res.status}`)

  const encrypted = new Uint8Array(await res.arrayBuffer())
  // aeskey from iLink is a hex string of the raw 16-byte key
  const keyBuf = hexToBytes(aesKeyHex)
  const decrypted = decryptAesEcb(encrypted, keyBuf)

  // Upload to COS if configured, otherwise save locally
  if (config.cos.secretId && config.cos.secretKey) {
    const cosUrl = await uploadMediaToCOS(decrypted, mediaType, fileName)
    console.log(`☁️ COS uploaded: ${cosUrl}`)
    return cosUrl
  }

  // Fallback: save to local disk
  const name = fileName ?? `${Date.now()}_${Math.random().toString(36).slice(2, 6)}${EXT_MAP[mediaType] ?? ''}`
  const dir = join(config.mediaDir, mediaType)
  const { mkdirSync } = await import('fs')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, name)
  await writeFile(path, decrypted)
  return path
}

/** Resolve aes key to hex string. item.aeskey is hex directly; media.aes_key is base64-encoded hex. */
function resolveAesKeyHex(itemKey?: string, mediaKey?: string): string | null {
  if (itemKey) return itemKey
  if (!mediaKey) return null
  // media.aes_key is base64 → decode to get hex string
  return Buffer.from(mediaKey, 'base64').toString('utf-8')
}

/**
 * Extract text + download media from an inbound message.
 */
export async function extractContent(msg: ILinkMessage): Promise<{ text: string; mediaPaths: string[] }> {
  const parts: string[] = []
  const mediaPaths: string[] = []

  // Debug: log raw item structure for non-text messages
  for (const item of msg.item_list) {
    if (item.type !== 1) {
      console.log(`[DEBUG] item type=${item.type}:`, JSON.stringify(item).slice(0, 2000))
    }
  }

  for (const item of msg.item_list) {
    switch (item.type) {
      case 1:
        if (item.text_item?.text) parts.push(item.text_item.text)
        break
      case 2: {
        const img = item.image_item
        const imgAesKey = resolveAesKeyHex(img?.aeskey, img?.media?.aes_key)
        if (img?.media?.encrypt_query_param && imgAesKey) {
          try {
            const p = await downloadMedia(img.media.encrypt_query_param, imgAesKey, 'image')
            mediaPaths.push(p)
            parts.push(`[图片已保存: ${p}]`)
          } catch (e) { parts.push(`[图片下载失败: ${(e as Error).message}]`) }
        } else parts.push('[图片]')
        break
      }
      case 3: {
        const voice = item.voice_item
        const voiceText = voice?.voice_text || voice?.text
        if (voiceText) {
          parts.push(voiceText)
        } else parts.push('[语音]')
        const voiceAesKey = resolveAesKeyHex(voice?.aeskey, voice?.media?.aes_key)
        if (voice?.media?.encrypt_query_param && voiceAesKey) {
          try {
            const p = await downloadMedia(voice.media.encrypt_query_param, voiceAesKey, 'voice')
            mediaPaths.push(p)
          } catch { /* non-critical */ }
        }
        break
      }
      case 4: {
        const file = item.file_item
        const fname = file?.file_name ?? '未知文件'
        const fileAesKey = resolveAesKeyHex(file?.aeskey, file?.media?.aes_key)
        if (file?.media?.encrypt_query_param && fileAesKey) {
          try {
            const p = await downloadMedia(file.media.encrypt_query_param, fileAesKey, 'file', fname)
            mediaPaths.push(p)
            parts.push(`[文件已保存: ${fname}]`)
          } catch { parts.push(`[文件下载失败: ${fname}]`) }
        } else parts.push(`[文件: ${fname}]`)
        break
      }
      case 5: {
        const vid = item.video_item
        const vidAesKey = resolveAesKeyHex(vid?.aeskey, vid?.media?.aes_key)
        if (vid?.media?.encrypt_query_param && vidAesKey) {
          try {
            const p = await downloadMedia(vid.media.encrypt_query_param, vidAesKey, 'video')
            mediaPaths.push(p)
            parts.push(`[视频已保存: ${p}]`)
          } catch { parts.push('[视频下载失败]') }
        } else parts.push('[视频]')
        break
      }
    }
  }

  return { text: parts.join('\n') || '[空消息]', mediaPaths }
}

// --- Send image via iLink (encrypt + upload CDN + sendmessage) ---

function encryptBlock(block: Uint8Array, rk: Uint32Array): Uint8Array {
  const s = new Uint8Array(16)
  for (let i = 0; i < 16; i++) s[i] = block[i] ^ ((rk[i >> 2] >> (24 - (i % 4) * 8)) & 0xff)
  for (let r = 1; r <= 10; r++) {
    for (let i = 0; i < 16; i++) s[i] = SBOX[s[i]]
    let t = s[1]; s[1]=s[5]; s[5]=s[9]; s[9]=s[13]; s[13]=t
    t=s[2]; s[2]=s[10]; s[10]=t; t=s[6]; s[6]=s[14]; s[14]=t
    t=s[15]; s[15]=s[11]; s[11]=s[7]; s[7]=s[3]; s[3]=t
    if (r < 10) for (let c = 0; c < 4; c++) {
      const i=c*4, a0=s[i],a1=s[i+1],a2=s[i+2],a3=s[i+3]
      s[i]=xtime(a0)^xtime(a1)^a1^a2^a3
      s[i+1]=a0^xtime(a1)^xtime(a2)^a2^a3
      s[i+2]=a0^a1^xtime(a2)^xtime(a3)^a3
      s[i+3]=xtime(a0)^a0^a1^a2^xtime(a3)
    }
    for (let i = 0; i < 16; i++) s[i] ^= (rk[r*4+(i>>2)]>>(24-(i%4)*8))&0xff
  }
  return s
}

function encryptAesEcb(data: Uint8Array, key: Uint8Array): Uint8Array {
  const rk = expandKey(key)
  const padLen = 16 - (data.length % 16)
  const padded = new Uint8Array(data.length + padLen)
  padded.set(data)
  for (let i = data.length; i < padded.length; i++) padded[i] = padLen
  const out = new Uint8Array(padded.length)
  for (let off = 0; off < padded.length; off += 16) out.set(encryptBlock(padded.subarray(off, off+16), rk), off)
  return out
}

function bytesToHex(buf: Uint8Array): string {
  return [...buf].map(b => b.toString(16).padStart(2, '0')).join('')
}

function md5Hex(data: Uint8Array): string {
  const { createHash } = require('crypto')
  return createHash('md5').update(data).digest('hex')
}

/**
 * Send an image from a URL (e.g. COS) to a WeChat user via iLink.
 */
export async function sendImage(creds: Credentials, toUserId: string, contextToken: string, imageUrl: string): Promise<void> {
  // 1. Download image
  const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(15000) })
  if (!imgRes.ok) throw new Error(`Failed to download image: ${imgRes.status}`)
  const raw = new Uint8Array(await imgRes.arrayBuffer())

  // 2. Generate AES key + encrypt
  const aesKey = new Uint8Array(16)
  crypto.getRandomValues(aesKey)
  const aesKeyHex = bytesToHex(aesKey)
  const encrypted = encryptAesEcb(raw, aesKey)
  const rawMd5 = md5Hex(raw)
  const filekeyHex = bytesToHex(crypto.getRandomValues(new Uint8Array(16)))

  // 3. Get upload URL
  const uploadRes = await fetch(`${creds.baseURL}/ilink/bot/getuploadurl`, {
    method: 'POST',
    headers: headers(creds),
    body: JSON.stringify({
      filekey: filekeyHex,
      media_type: 1,
      to_user_id: toUserId,
      rawsize: raw.byteLength,
      rawfilemd5: rawMd5,
      filesize: encrypted.byteLength,
      no_need_thumb: true,
      aes_key: aesKeyHex,
      base_info: {},
    }),
  })
  const uploadData = await uploadRes.json() as { upload_full_url?: string; upload_param?: string; ret?: number; errmsg?: string }
  if (uploadData.ret && uploadData.ret !== 0) throw new Error(`getuploadurl failed: ${uploadData.errmsg}`)

  // 4. Upload to CDN
  let cdnUrl = uploadData.upload_full_url?.trim()
  if (!cdnUrl) {
    if (!uploadData.upload_param) throw new Error('No upload URL returned')
    cdnUrl = `${CDN}/upload?encrypted_query_param=${encodeURIComponent(uploadData.upload_param)}&filekey=${encodeURIComponent(filekeyHex)}`
  }

  const cdnRes = await fetch(cdnUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: encrypted,
    signal: AbortSignal.timeout(30000),
  })
  if (!cdnRes.ok) throw new Error(`CDN upload failed: ${cdnRes.status}`)
  const downloadParam = cdnRes.headers.get('X-Encrypted-Param') ?? ''
  if (!downloadParam) throw new Error('CDN upload: missing X-Encrypted-Param')

  // 5. Send image message
  // aeskey for message: base64 encode the hex string (matching WeClaw's AESKeyToBase64)
  const aesKeyB64 = Buffer.from(aesKeyHex).toString('base64')

  const res = await fetch(`${creds.baseURL}/ilink/bot/sendmessage`, {
    method: 'POST',
    headers: headers(creds),
    body: JSON.stringify({
      msg: {
        from_user_id: creds.ilinkBotId,
        to_user_id: toUserId,
        client_id: newClientId(),
        message_type: 2, message_state: 2,
        context_token: contextToken,
        item_list: [{
          type: 2,
          image_item: {
            aeskey: aesKeyB64,
            media: { encrypt_query_param: downloadParam },
          },
        }],
      },
    }),
  })
  const body = await res.json().catch(() => null) as { ret?: number; errmsg?: string } | null
  if (body?.ret && body.ret !== 0) console.error('⚠️ sendImage failed:', JSON.stringify(body))
  else console.log('🖼️ sendImage ok')
}
