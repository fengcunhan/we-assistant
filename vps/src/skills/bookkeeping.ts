import Database from 'better-sqlite3'
import { join } from 'path'
import { config } from '../config.js'
import type { Skill, ToolResult } from './types.js'

const db = new Database(join(config.dataDir, 'pi.db'))

db.exec(`
  CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    item TEXT NOT NULL,
    amount REAL NOT NULL,
    date TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT '日常',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_expenses_user_date ON expenses (user_id, date);
`)

const VALID_CATEGORIES = ['餐饮', '购物', '交通', '日常', '娱乐', '医疗', '教育', '其他']

function genId(): string {
  return `exp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

function getTodayStr(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
}

function validateCategory(cat: string): string {
  return VALID_CATEGORIES.includes(cat) ? cat : '日常'
}

function recordExpense(args: Record<string, unknown>, userId: string): ToolResult {
  const item = (args.item as string)?.trim()
  const amount = Number(args.amount)
  if (!item) return { content: '缺少消费项目名称。' }
  if (!Number.isFinite(amount) || amount <= 0) return { content: '金额无效，请输入正数。' }

  const date = (args.date as string) || getTodayStr()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { content: '日期格式无效，请使用 YYYY-MM-DD。' }

  const category = validateCategory((args.category as string) || '日常')
  const id = genId()
  const now = Date.now()

  db.prepare(
    'INSERT INTO expenses (id, user_id, item, amount, date, category, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(id, userId, item, amount, date, category, now, now)

  return {
    content: `已记账：${date} ${item} ¥${amount.toFixed(2)} (${category})\nID: ${id}`,
  }
}

function updateExpense(args: Record<string, unknown>, userId: string): ToolResult {
  const id = args.id as string
  if (!id) return { content: '缺少记录 ID。' }

  const existing = db.prepare('SELECT * FROM expenses WHERE id = ? AND user_id = ?').get(id, userId) as any
  if (!existing) return { content: `未找到记录 ${id}。` }

  const newItem = (args.item as string)?.trim() || existing.item
  const newAmount = args.amount !== undefined ? Number(args.amount) : existing.amount
  const newDate = (args.date as string) || existing.date
  const newCategory = args.category ? validateCategory(args.category as string) : existing.category

  if (!Number.isFinite(newAmount) || newAmount <= 0) return { content: '金额无效。' }

  db.prepare(
    'UPDATE expenses SET item = ?, amount = ?, date = ?, category = ?, updated_at = ? WHERE id = ?',
  ).run(newItem, newAmount, newDate, newCategory, Date.now(), id)

  return { content: `已更新：${newDate} ${newItem} ¥${newAmount.toFixed(2)} (${newCategory})` }
}

function deleteExpense(args: Record<string, unknown>, userId: string): ToolResult {
  const id = args.id as string
  if (!id) return { content: '缺少记录 ID。' }

  const existing = db.prepare('SELECT * FROM expenses WHERE id = ? AND user_id = ?').get(id, userId) as any
  if (!existing) return { content: `未找到记录 ${id}。` }

  db.prepare('DELETE FROM expenses WHERE id = ?').run(id)
  return { content: `已删除：${existing.date} ${existing.item} ¥${existing.amount.toFixed(2)}` }
}

function listExpenses(userId: string, filters: Record<string, unknown>): ToolResult {
  const conditions = ['user_id = ?']
  const params: unknown[] = [userId]

  const startDate = filters.start_date as string | undefined
  const endDate = filters.end_date as string | undefined
  const category = filters.category as string | undefined

  if (startDate) {
    conditions.push('date >= ?')
    params.push(startDate)
  }
  if (endDate) {
    conditions.push('date <= ?')
    params.push(endDate)
  }
  if (category) {
    conditions.push('category = ?')
    params.push(validateCategory(category))
  }

  const rows = db.prepare(
    `SELECT * FROM expenses WHERE ${conditions.join(' AND ')} ORDER BY date DESC, created_at DESC`,
  ).all(...params) as Array<{
    id: string; item: string; amount: number; date: string; category: string
  }>

  if (rows.length === 0) {
    return { content: '没有找到符合条件的记账记录。' }
  }

  const total = rows.reduce((sum, r) => sum + r.amount, 0)
  const lines = rows.map((r, i) => `${i + 1}. [${r.date}] ${r.item} ¥${r.amount.toFixed(2)} (${r.category}) ID:${r.id}`)

  return {
    content: `共 ${rows.length} 笔，合计 ¥${total.toFixed(2)}\n\n${lines.join('\n')}`,
  }
}

function summaryExpenses(userId: string, args: Record<string, unknown>): ToolResult {
  const conditions = ['user_id = ?']
  const params: unknown[] = [userId]

  const startDate = (args.start_date as string) || ''
  const endDate = (args.end_date as string) || ''

  if (startDate) {
    conditions.push('date >= ?')
    params.push(startDate)
  }
  if (endDate) {
    conditions.push('date <= ?')
    params.push(endDate)
  }

  const where = conditions.join(' AND ')

  const byCategory = db.prepare(
    `SELECT category, SUM(amount) as total, COUNT(*) as count FROM expenses WHERE ${where} GROUP BY category ORDER BY total DESC`,
  ).all(...params) as Array<{ category: string; total: number; count: number }>

  const byDate = db.prepare(
    `SELECT date, SUM(amount) as total, COUNT(*) as count FROM expenses WHERE ${where} GROUP BY date ORDER BY date DESC`,
  ).all(...params) as Array<{ date: string; total: number; count: number }>

  const grandTotal = byCategory.reduce((s, r) => s + r.total, 0)

  if (grandTotal === 0) return { content: '该时段没有记账记录。' }

  let text = `记账汇总：共 ${byCategory.reduce((s, r) => s + r.count, 0)} 笔，合计 ¥${grandTotal.toFixed(2)}\n\n`

  text += '按分类：\n'
  for (const r of byCategory) {
    text += `  ${r.category}  ¥${r.total.toFixed(2)} (${r.count}笔)\n`
  }

  text += '\n按日期：\n'
  for (const r of byDate) {
    text += `  ${r.date}  ¥${r.total.toFixed(2)} (${r.count}笔)\n`
  }

  return { content: text }
}

const skill: Skill = {
  name: 'bookkeeping',
  description:
    '日常记账与消费统计。用户说"记一笔"、"记账"、"花了多少"、"消费统计"、"账单汇总"、"这个月花了多少"等时使用。支持记录、修改、删除、按日期/分类汇总。',

  tools: [
    {
      type: 'function',
      function: {
        name: 'record_expense',
        description: '记录一笔消费支出',
        parameters: {
          type: 'object',
          properties: {
            item: { type: 'string', description: '消费项目，如"买菜"、"打车"' },
            amount: { type: 'number', description: '金额（元）' },
            date: { type: 'string', description: '日期 YYYY-MM-DD，不传默认今天' },
            category: {
              type: 'string',
              description: '分类：餐饮/购物/交通/日常/娱乐/医疗/教育/其他，不传默认日常',
            },
          },
          required: ['item', 'amount'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'update_expense',
        description: '修改一笔记账记录',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '记录 ID' },
            item: { type: 'string', description: '新项目名，不传则不改' },
            amount: { type: 'number', description: '新金额，不传则不改' },
            date: { type: 'string', description: '新日期 YYYY-MM-DD，不传则不改' },
            category: { type: 'string', description: '新分类，不传则不改' },
          },
          required: ['id'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'delete_expense',
        description: '删除一笔记账记录',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '记录 ID' },
          },
          required: ['id'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_expenses',
        description: '查询记账记录列表，可按日期范围或分类筛选',
        parameters: {
          type: 'object',
          properties: {
            start_date: { type: 'string', description: '开始日期 YYYY-MM-DD' },
            end_date: { type: 'string', description: '结束日期 YYYY-MM-DD' },
            category: { type: 'string', description: '按分类筛选' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'summary_expenses',
        description: '汇总统计记账数据，按分类和日期分组',
        parameters: {
          type: 'object',
          properties: {
            start_date: { type: 'string', description: '开始日期 YYYY-MM-DD' },
            end_date: { type: 'string', description: '结束日期 YYYY-MM-DD' },
          },
        },
      },
    },
  ],

  async execute(toolName, args, context): Promise<ToolResult> {
    const userId = context.userId

    if (toolName === 'record_expense') return recordExpense(args, userId)
    if (toolName === 'update_expense') return updateExpense(args, userId)
    if (toolName === 'delete_expense') return deleteExpense(args, userId)
    if (toolName === 'list_expenses') return listExpenses(userId, args)
    if (toolName === 'summary_expenses') return summaryExpenses(userId, args)

    return { content: '未知操作' }
  },
}

export default skill
