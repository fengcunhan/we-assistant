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
