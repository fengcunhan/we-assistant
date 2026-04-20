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

import { existsSync, readFileSync, rmSync } from 'node:fs'
import { persistMedia } from './media.js'

test('persistMedia: local mode writes file under MEDIA_DIR and returns absolute path', async () => {
  const bytes = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0])
  const absPath = await persistMedia(bytes, 'image')
  assert.ok(absPath.includes('/data/media/image/'), `got: ${absPath}`)
  assert.ok(existsSync(absPath), 'file should exist on disk')
  const read = readFileSync(absPath)
  assert.deepEqual(Uint8Array.from(read), bytes)
  rmSync(absPath)
})

test('persistMedia: fileName without extension falls back to default ext', async () => {
  const bytes = new Uint8Array([0x01])
  const abs = await persistMedia(bytes, 'image', 'noext')
  assert.match(abs, /\.jpg$/, `got: ${abs}`)
  rmSync(abs)
})

import { mkdtempSync, writeFileSync as wf } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readMediaBytes } from './media.js'

test('readMediaBytes: reads local file from absolute path', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'pi-'))
  const p = join(tmp, 'x.bin')
  wf(p, Buffer.from([1, 2, 3, 4]))
  const bytes = await readMediaBytes(p)
  assert.deepEqual(Array.from(bytes), [1, 2, 3, 4])
})

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

import { resolve } from 'node:path'
import { toDisplayUrl, resolveLocalMedia } from './media.js'
import { config as cfg } from './config.js'

test('toDisplayUrl: http URL passes through (COS disabled path)', () => {
  assert.equal(toDisplayUrl('http://example.com/a.jpg'), 'http://example.com/a.jpg')
})

test('toDisplayUrl: local abs path → /media/<rel>', () => {
  const abs = resolve(cfg.mediaDir, 'image/2026-04-20/x.jpg')
  assert.equal(toDisplayUrl(abs), '/media/image/2026-04-20/x.jpg')
})

test('resolveLocalMedia: rejects path traversal', () => {
  assert.equal(resolveLocalMedia('../etc/passwd'), null)
  assert.equal(resolveLocalMedia('image/../../../../etc/passwd'), null)
})

test('resolveLocalMedia: accepts legit nested path', () => {
  const p = resolveLocalMedia('image/2026-04-20/x.jpg')
  assert.ok(p && p.startsWith(resolve(cfg.mediaDir)))
})

test('resolveLocalMedia: empty string → null', () => {
  assert.equal(resolveLocalMedia(''), null)
})

test('resolveLocalMedia: absolute path → null', () => {
  assert.equal(resolveLocalMedia('/etc/passwd'), null)
})

test('resolveLocalMedia: single dot-dot → null', () => {
  assert.equal(resolveLocalMedia('..'), null)
})
