/**
 * One-off script: re-embed all images with VLM caption + text embedding + visual embedding.
 * Usage: node --import tsx src/reindex-images.ts
 */
import { getEmbedding, getMultimodalEmbedding } from './embedding.js'
import { insertVector } from './db.js'
import { getSignedUrl } from './cos.js'
import { config } from './config.js'
import Database from 'better-sqlite3'
import { join } from 'path'

const db = new Database(join(config.dataDir, 'pi.db'))

// All images from message_log
const images = db.prepare(
  `SELECT DISTINCT media_path, contact_id FROM message_log
   WHERE media_path LIKE '%.jpg' OR media_path LIKE '%.jpeg'
      OR media_path LIKE '%.png' OR media_path LIKE '%.gif' OR media_path LIKE '%.webp'
   ORDER BY timestamp ASC`
).all() as Array<{ media_path: string; contact_id: string }>

console.log(`Found ${images.length} images to process\n`)

// Remove old image vectors (will be replaced)
db.prepare(`DELETE FROM vectors WHERE category IN ('image', 'image_visual')`).run()
console.log('Cleared old image vectors\n')

for (const [i, img] of images.entries()) {
  const { media_path: url, contact_id: contactId } = img
  console.log(`[${i + 1}/${images.length}] ${url.slice(-40)}`)

  try {
    const signedUrl = getSignedUrl(url, 600)

    // 1. VLM caption
    const captionRes = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.embedding.apiKey}`,
      },
      body: JSON.stringify({
        model: 'qwen3.5-27b',
        messages: [
          { role: 'system', content: '用中文简要描述这张图片的内容，包括主体、场景、颜色、风格等关键信息。只输出描述，不要其他内容。不要思考过程。' },
          { role: 'user', content: [{ type: 'image_url', image_url: { url: signedUrl } }] },
        ],
      }),
    })
    if (!captionRes.ok) {
      const err = await captionRes.text()
      console.error(`  ❌ VLM caption failed (${captionRes.status}): ${err.slice(0, 200)}`)
      continue
    }
    const captionData = await captionRes.json() as { choices: Array<{ message: { content: string } }> }
    const caption = captionData.choices[0]?.message?.content ?? ''
    console.log(`  📝 ${caption.slice(0, 80)}`)

    // 2. Text embedding
    const textEmb = await getEmbedding(caption)
    const textId = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    insertVector(textId, textEmb, caption, 'image', contactId, 'store', url)
    console.log(`  ✅ text embedding: ${textId}`)

    // 3. Visual embedding
    const imgEmb = await getMultimodalEmbedding([{ image: signedUrl }])
    const imgId = `imgv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    insertVector(imgId, imgEmb, caption, 'image_visual', contactId, 'store', url)
    console.log(`  ✅ visual embedding: ${imgId}`)

    // Small delay to avoid rate limiting
    await new Promise((r) => setTimeout(r, 1000))
  } catch (err) {
    console.error(`  ❌ Failed: ${(err as Error).message}`)
  }
}

console.log('\nDone!')
process.exit(0)
