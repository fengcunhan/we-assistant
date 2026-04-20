import { getEnabledDueJobs, updateCronJobAfterRun, type CronJob } from './db.js'

const CHECK_INTERVAL_MS = 30_000 // check every 30s

type SendFn = (userId: string, text: string) => Promise<void>

type JobExecutor = (job: CronJob) => Promise<string>

let timer: ReturnType<typeof setInterval> | null = null
let sendFn: SendFn | null = null
const jobExecutors = new Map<string, JobExecutor>()

export function registerJobExecutor(jobType: string, executor: JobExecutor): void {
  jobExecutors.set(jobType, executor)
}

/** Compute next run time for recurring jobs */
export function computeNextRunAt(job: CronJob, afterMs: number): number | null {
  if (job.schedule_kind === 'at') {
    // One-shot: no next run
    return null
  }

  if (job.schedule_kind === 'every') {
    const intervalMs = parseInt(job.schedule_value, 10)
    if (!Number.isFinite(intervalMs) || intervalMs < 60_000) return null
    return afterMs + intervalMs
  }

  if (job.schedule_kind === 'cron') {
    // Simple cron: support "HH:MM" daily format and standard 5-field cron
    const expr = job.schedule_value.trim()
    const dailyMatch = expr.match(/^(\d{1,2}):(\d{2})$/)
    if (dailyMatch) {
      return computeNextDaily(parseInt(dailyMatch[1], 10), parseInt(dailyMatch[2], 10), afterMs, job.schedule_tz)
    }
    // 5-field cron: minute hour dom month dow
    const parts = expr.split(/\s+/)
    if (parts.length === 5 && parts[0] !== '*' && parts[1] !== '*') {
      const minute = parseInt(parts[0], 10)
      const hour = parseInt(parts[1], 10)
      if (Number.isFinite(minute) && Number.isFinite(hour)) {
        return computeNextDaily(hour, minute, afterMs, job.schedule_tz)
      }
    }
    return null
  }

  return null
}

function computeNextDaily(hour: number, minute: number, afterMs: number, tz: string): number {
  // Compute next occurrence of HH:MM in the given timezone
  const now = new Date(afterMs)
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
  const dateStr = fmt.format(now)
  const [y, m, d] = dateStr.split('-').map(Number)

  // Build target time in tz by trying today and tomorrow
  for (let dayOffset = 0; dayOffset <= 1; dayOffset++) {
    const target = new Date(`${y}-${String(m).padStart(2, '0')}-${String(d + dayOffset).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`)
    // Convert from tz to UTC using Intl
    const tzTarget = zonedToUtcMs(y, m, d + dayOffset, hour, minute, tz)
    if (tzTarget > afterMs) return tzTarget
  }

  // Fallback: tomorrow + 1 day
  return afterMs + 86_400_000
}

function zonedToUtcMs(y: number, m: number, d: number, h: number, min: number, tz: string): number {
  // Create a date and adjust for timezone offset
  // Use a brute-force approach: format a known UTC date in target tz to find offset
  const guess = new Date(Date.UTC(y, m - 1, d, h, min, 0, 0))
  const utcStr = guess.toLocaleString('en-US', { timeZone: 'UTC' })
  const tzStr = guess.toLocaleString('en-US', { timeZone: tz })
  const utcMs = new Date(utcStr).getTime()
  const tzMs = new Date(tzStr).getTime()
  const offsetMs = utcMs - tzMs
  return guess.getTime() + offsetMs
}

/** Execute a single due job */
async function executeJob(job: CronJob): Promise<void> {
  if (!sendFn) return

  try {
    const executor = jobExecutors.get(job.job_type ?? '')
    const payload = executor ? await executor(job) : job.payload
    await sendFn(job.user_id, payload)
    const nextRunAt = computeNextRunAt(job, Date.now())
    updateCronJobAfterRun(job.id, 'ok', nextRunAt)

    // Disable one-shot jobs
    if (job.schedule_kind === 'at') {
      const { default: db } = await import('./db.js')
      db.prepare('UPDATE cron_jobs SET enabled = 0 WHERE id = ?').run(job.id)
    }

    console.log(`⏰ Cron OK: "${job.name}" → ${job.user_id}`)
  } catch (err) {
    const nextRunAt = computeNextRunAt(job, Date.now())
    updateCronJobAfterRun(job.id, 'error', nextRunAt)
    console.error(`⏰ Cron ERROR: "${job.name}":`, (err as Error).message)
  }
}

/** Check for due jobs and execute them */
async function tick(): Promise<void> {
  const now = Date.now()
  const dueJobs = getEnabledDueJobs(now)

  for (const job of dueJobs) {
    await executeJob(job)
  }
}

/** Start the scheduler */
export function startScheduler(send: SendFn): void {
  sendFn = send
  if (timer) return

  console.log('⏰ Scheduler started (30s interval)')
  timer = setInterval(() => {
    tick().catch((err) => console.error('⏰ Scheduler tick error:', (err as Error).message))
  }, CHECK_INTERVAL_MS)

  // Run immediately on start to catch missed jobs
  tick().catch(() => {})
}

/** Stop the scheduler */
export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  sendFn = null
}
