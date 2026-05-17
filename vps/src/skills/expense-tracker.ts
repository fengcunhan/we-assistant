// Auto-generated skill: expense-tracker
// Created at: 2026-05-07T14:08:31.659Z
import type { Skill, ToolResult } from './types.js'

const skill: Skill = {
  name: "expense-tracker",
  description: "个人记账技能：记录日常支出、查询历史记录、删除错误条目、按月汇总统计。当用户说\"记一笔\"、\"花了多少钱\"、\"帮我记账\"、\"删除那笔\"、\"这个月花了多少\"等与消费/支出相关的话题时使用。",
  tools: [
    {
      type: 'function' as const,
      function: {
        name: "add_expense",
        description: "记录一笔支出。参数：items（消费项目明细，JSON数组，每项含name和amount），date（日期，格式YYYY-MM-DD，可选，默认今天），category（分类标签，如food/shopping/transport等，可选，默认general）",
        parameters: {
                "type": "object",
                "properties": {
                        "items": {
                                "type": "string",
                                "description": "消费项目JSON数组，如[{\"name\":\"玉米\",\"amount\":5}]"
                        },
                        "date": {
                                "type": "string",
                                "description": "日期，格式YYYY-MM-DD，默认今天"
                        },
                        "category": {
                                "type": "string",
                                "description": "分类标签：food/shopping/transport/daily/other"
                        }
                },
                "required": [
                        "items"
                ]
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: "query_expenses",
        description: "查询记账记录。可按月份、日期范围、分类筛选，返回匹配的支出记录列表。",
        parameters: {
                "type": "object",
                "properties": {
                        "month": {
                                "type": "string",
                                "description": "查询月份，格式YYYY-MM，如2026-04"
                        },
                        "date": {
                                "type": "string",
                                "description": "查询具体日期，格式YYYY-MM-DD"
                        },
                        "category": {
                                "type": "string",
                                "description": "按分类筛选：food/shopping/transport/daily/other"
                        }
                },
                "required": []
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: "delete_expense",
        description: "删除一条记账记录。需要提供记录的ID或具体内容描述来定位要删除的记录。",
        parameters: {
                "type": "object",
                "properties": {
                        "record_id": {
                                "type": "string",
                                "description": "要删除的记录ID或唯一标识"
                        },
                        "description": {
                                "type": "string",
                                "description": "要删除的记录内容描述，用于模糊匹配"
                        }
                },
                "required": []
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: "summary_expenses",
        description: "按月汇总统计支出，包括总金额、分类明细、日均消费等。",
        parameters: {
                "type": "object",
                "properties": {
                        "month": {
                                "type": "string",
                                "description": "汇总月份，格式YYYY-MM，如2026-04"
                        }
                },
                "required": [
                        "month"
                ]
        },
      },
    }
  ],

  async execute(toolName: string, args: Record<string, unknown>, context: { userId: string; userMessage: string }): Promise<ToolResult> {
    // 工具：记录支出
    if (toolName === "add_expense") {
      const items = typeof args.items === "string" ? JSON.parse(args.items as string) : (args.items as any[]);
      const date = (args.date as string) || new Date().toISOString().split("T")[0];
      const category = (args.category as string) || "general";

      const lines = items.map((item: any) => `${item.name}: ${item.amount}元`).join("、");
      const total = items.reduce((sum: number, item: any) => sum + parseFloat(item.amount), 0);

      const content = `【记账-${date}】${category} | ${lines} | 合计: ${total.toFixed(2)}元`;

      return {
        content: JSON.stringify({
          action: "store",
          content: content,
          category: "general",
          date: date,
          items: items,
          total: total.toFixed(2),
          type: "expense-record"
        })
      };
    }

    // 工具：查询支出
    if (toolName === "query_expenses") {
      const month = (args.month as string) || new Date().toISOString().slice(0, 7);
      const date = (args.date as string) || "";
      const category = (args.category as string) || "";

      return {
        content: JSON.stringify({
          action: "query",
          month: month,
          date: date,
          category: category,
          type: "expense-query",
          instruction: "请使用query_knowledge工具搜索记账记录，搜索关键词为：记账 " + (date || month)
        })
      };
    }

    // 工具：删除支出
    if (toolName === "delete_expense") {
      const recordId = (args.record_id as string) || "";
      const description = (args.description as string) || "";

      const content = `【记账删除标记】${recordId ? "ID:" + recordId + " " : ""}${description ? "描述:" + description : ""} | 已于${new Date().toISOString().split("T")[0]}标记删除`;

      return {
        content: JSON.stringify({
          action: "store_deletion_mark",
          content: content,
          category: "general",
          record_id: recordId,
          description: description,
          type: "expense-deletion"
        })
      };
    }

    // 工具：汇总统计
    if (toolName === "summary_expenses") {
      const month = (args.month as string) || new Date().toISOString().slice(0, 7);

      return {
        content: JSON.stringify({
          action: "query_summary",
          month: month,
          type: "expense-summary",
          instruction: "请使用query_knowledge工具搜索该月份所有记账记录，搜索关键词为：记账 " + month + "，然后汇总计算"
        })
      };
    }

    return { content: "未知工具: " + toolName };
  },
}

export default skill
