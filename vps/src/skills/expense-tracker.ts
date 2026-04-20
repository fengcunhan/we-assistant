// Auto-generated skill: expense-tracker
// Created at: 2026-04-18T14:30:28.978Z
import type { Skill, ToolResult } from './types.js'

const skill: Skill = {
  name: "expense-tracker",
  description: "日常记账技能：当用户说\"记一笔\"、\"记账\"、\"花了多少\"、\"统计花费\"等与消费记录相关的内容时使用。支持记录消费、修改记录、汇总统计。",
  tools: [
    {
      type: 'function' as const,
      function: {
        name: "record_expense",
        description: "记录一笔消费，包括项目名称、金额、日期、分类",
        parameters: {
                "type": "object",
                "properties": {
                        "item": {
                                "type": "string",
                                "description": "消费项目，如'买菜'、'买水果'、'打车'"
                        },
                        "amount": {
                                "type": "number",
                                "description": "消费金额（元）"
                        },
                        "date": {
                                "type": "string",
                                "description": "消费日期，格式YYYY-MM-DD，不填默认今天"
                        },
                        "category": {
                                "type": "string",
                                "description": "消费分类：餐饮/交通/购物/日用/娱乐/医疗/教育/其他，不填默认'日用'"
                        }
                },
                "required": [
                        "item",
                        "amount"
                ]
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: "update_expense",
        description: "修改已有的一笔记账记录，通过项目名称匹配",
        parameters: {
                "type": "object",
                "properties": {
                        "old_item": {
                                "type": "string",
                                "description": "原来的项目名称"
                        },
                        "new_item": {
                                "type": "string",
                                "description": "新的项目名称（不修改则不填）"
                        },
                        "new_amount": {
                                "type": "number",
                                "description": "新的金额（不修改则不填）"
                        },
                        "new_date": {
                                "type": "string",
                                "description": "新的日期，格式YYYY-MM-DD（不修改则不填）"
                        }
                },
                "required": [
                        "old_item"
                ]
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: "get_expense_summary",
        description: "汇总统计记账数据，支持按日期范围或分类筛选",
        parameters: {
                "type": "object",
                "properties": {
                        "start_date": {
                                "type": "string",
                                "description": "开始日期，格式YYYY-MM-DD"
                        },
                        "end_date": {
                                "type": "string",
                                "description": "结束日期，格式YYYY-MM-DD"
                        },
                        "category": {
                                "type": "string",
                                "description": "按分类筛选，如'餐饮'"
                        }
                }
        },
      },
    }
  ],

  async execute(toolName: string, args: Record<string, unknown>, context: { userId: string; userMessage: string }): Promise<ToolResult> {
    const toolName = toolName;
const args = args;

if (toolName === 'record_expense') {
  const { item, amount, date, category } = args;
  const recordDate = date || new Date().toISOString().split('T')[0];
  const cat = category || '日用';
  const now = new Date().toISOString();

  const record = {
    id: `exp_${Date.now()}`,
    type: 'expense',
    item,
    amount: Number(amount),
    date: recordDate,
    category: cat,
    createdAt: now
  };

  return {
    content: JSON.stringify({
      action: 'record',
      record
    }),
    sideEffects: { record }
  };
}

if (toolName === 'update_expense') {
  const { old_item, new_item, new_amount, new_date } = args;
  const updates = {};
  if (new_item) updates.item = new_item;
  if (new_amount !== undefined) updates.amount = Number(new_amount);
  if (new_date) updates.date = new_date;

  return {
    content: JSON.stringify({
      action: 'update',
      oldItem: old_item,
      updates
    }),
    sideEffects: { update: { oldItem: old_item, updates } }
  };
}

if (toolName === 'get_expense_summary') {
  const { start_date, end_date, category } = args;
  return {
    content: JSON.stringify({
      action: 'summary',
      filters: { startDate: start_date || null, endDate: end_date || null, category: category || null }
    }),
    sideEffects: { summary: true }
  };
}

return { content: '未知操作' };
  },
}

export default skill
