import { mkdirSync } from 'fs'

export const config = {
  llm: {
    baseUrl: process.env.LLM_BASE_URL ?? 'https://open.bigmodel.cn/api/coding/paas/v4',
    model: process.env.LLM_MODEL ?? 'GLM-5.1',
    apiKey: process.env.LLM_API_KEY ?? '',
  },
  embedding: {
    apiKey: process.env.DASHSCOPE_API_KEY ?? '',
    model: process.env.EMBEDDING_MODEL ?? 'tongyi-embedding-vision-plus-2026-03-06',
    dimension: 1024,
  },
  ilink: {
    baseURL: process.env.ILINK_BASE_URL ?? 'https://ilinkai.weixin.qq.com',
  },
  cos: {
    enabled: !!(process.env.COS_BUCKET && process.env.COS_SECRET_ID && process.env.COS_SECRET_KEY),
    bucket: process.env.COS_BUCKET ?? '',
    region: process.env.COS_REGION ?? 'ap-shanghai',
    secretId: process.env.COS_SECRET_ID ?? '',
    secretKey: process.env.COS_SECRET_KEY ?? '',
  },
  proactive: {
    enabled: process.env.PROACTIVE_ENABLED !== 'false',
    userId: process.env.PROACTIVE_USER_ID ?? '',
    minHour: parseInt(process.env.PROACTIVE_MIN_HOUR ?? '8', 10),
    maxHour: parseInt(process.env.PROACTIVE_MAX_HOUR ?? '22', 10),
    dailyMax: parseInt(process.env.PROACTIVE_DAILY_MAX ?? '3', 10),
    minGapMs: parseInt(process.env.PROACTIVE_MIN_GAP_MS ?? '5400000', 10),
    tickMs: parseInt(process.env.PROACTIVE_TICK_MS ?? '600000', 10),
  },
  dataDir: process.env.DATA_DIR ?? './data',
  mediaDir: process.env.MEDIA_DIR ?? './data/media',
  apiPort: parseInt(process.env.API_PORT ?? '18011', 10),
}

// Ensure directories exist
mkdirSync(config.dataDir, { recursive: true })
mkdirSync(config.mediaDir, { recursive: true })
