// Auto-generated skill: vocab-learner
// Created at: 2026-04-13T07:08:49.377Z
import type { Skill, ToolResult } from './types.js'

const skill: Skill = {
  name: "vocab-learner",
  description: "英语单词学习技能：随机发送英语单词，用户回复中文含义进行答题。支持记忆曲线复习、错误题本、每日10词限制，适合碎片化英语学习。出题时附带搞笑、荒诞的例句帮助记忆（类似多邻国策略）。",
  tools: [
    {
      type: 'function' as const,
      function: {
        name: "get_word",
        description: "获取今天需要学习或复习的英语单词。会根据记忆曲线安排新词和复习词。",
        parameters: {
                "type": "object",
                "properties": {
                        "progress_data": {
                                "type": "string",
                                "description": "用户的学习进度JSON数据（从知识库获取），包含已学单词、正确次数、错误次数、下次复习日期等"
                        }
                },
                "required": []
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: "check_answer",
        description: "检查用户回答的单词中文含义是否正确。支持模糊匹配。",
        parameters: {
                "type": "object",
                "properties": {
                        "word": {
                                "type": "string",
                                "description": "英文单词"
                        },
                        "answer": {
                                "type": "string",
                                "description": "用户回答的中文含义"
                        }
                },
                "required": [
                        "word",
                        "answer"
                ]
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: "get_progress",
        description: "获取用户的学习进度统计",
        parameters: {
                "type": "object",
                "properties": {
                        "progress_data": {
                                "type": "string",
                                "description": "学习进度JSON数据"
                        }
                },
                "required": []
        },
      },
    }
  ],

  async execute(toolName: string, args: Record<string, unknown>, context: { userId: string; userMessage: string }): Promise<ToolResult> {
    async (toolName, args, context) => {
  if (toolName === 'get_word') {
    const resp = await fetch('https://pi-assistant-skill-functions-1255973018.cos.ap-shanghai.myqcloud.com/vocab-learner/get_word', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ progress_data: args.progress_data || '' })
    });
    const data = await resp.json();
    return { content: JSON.stringify(data) };
  }
  
  if (toolName === 'check_answer') {
    const resp = await fetch('https://pi-assistant-skill-functions-1255973018.cos.ap-shanghai.myqcloud.com/vocab-learner/check_answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ word: args.word, answer: args.answer })
    });
    const data = await resp.json();
    return { content: JSON.stringify(data) };
  }
  
  if (toolName === 'get_progress') {
    const resp = await fetch('https://pi-assistant-skill-functions-1255973018.cos.ap-shanghai.myqcloud.com/vocab-learner/get_progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ progress_data: args.progress_data || '' })
    });
    const data = await resp.json();
    return { content: JSON.stringify(data) };
  }
  
  return { content: 'Unknown tool' };
}
  },
}

export default skill
