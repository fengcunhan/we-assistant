import { writeFileSync, readdirSync, unlinkSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { Skill, ToolResult } from './types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SKILLS_DIR = __dirname // this file is inside skills/

/** Built-in skill files that cannot be overwritten or deleted */
const PROTECTED = new Set([
  'types.ts',
  'create-skill.ts',
  'store-note.ts',
  'query-knowledge.ts',
  'search-images.ts',
  'reminder.ts',
])

const skill: Skill = {
  name: 'create-skill',
  description:
    '当用户要求你学习新能力、创建新工具、增加新技能时使用。你可以动态创建、查看和删除技能。创建后下一轮对话即可使用。',
  tools: [
    {
      type: 'function',
      function: {
        name: 'create_skill',
        description:
          '创建一个新技能。提供技能名称、描述、工具定义和执行代码。创建后无需重启，下次对话即可使用。',
        parameters: {
          type: 'object',
          properties: {
            skill_name: {
              type: 'string',
              description: '技能名称，用作文件名（英文、短横线分隔，如 "weather-query"）',
            },
            skill_description: {
              type: 'string',
              description: '技能描述：什么时候、为什么要使用这个技能',
            },
            tools_json: {
              type: 'string',
              description:
                'JSON 字符串，定义此技能提供的工具列表。格式: [{ "name": "tool_name", "description": "...", "parameters": { "type": "object", "properties": {...}, "required": [...] } }]',
            },
            execute_code: {
              type: 'string',
              description:
                '工具执行函数体的 TypeScript 代码。可用变量: toolName (string), args (Record<string,unknown>), context ({userId, userMessage})。必须返回 { content: string, sideEffects?: Record<string,unknown> }。可以使用 fetch() 调用外部 API。',
            },
          },
          required: ['skill_name', 'skill_description', 'tools_json', 'execute_code'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_skills',
        description: '列出当前所有已安装的技能（包括内置和动态创建的）',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'delete_skill',
        description: '删除一个动态创建的技能（内置技能不可删除）',
        parameters: {
          type: 'object',
          properties: {
            skill_name: {
              type: 'string',
              description: '要删除的技能文件名（不含 .ts 后缀）',
            },
          },
          required: ['skill_name'],
        },
      },
    },
  ],

  async execute(toolName, args, _context): Promise<ToolResult> {
    if (toolName === 'create_skill') {
      return createSkill(args)
    }
    if (toolName === 'list_skills') {
      return listSkills()
    }
    if (toolName === 'delete_skill') {
      return deleteSkill(args.skill_name as string)
    }
    return { content: '未知操作' }
  },
}

function createSkill(args: Record<string, unknown>): ToolResult {
  const name = args.skill_name as string
  const description = args.skill_description as string
  const toolsJson = args.tools_json as string
  const executeCode = args.execute_code as string

  // Validate name
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    return { content: '技能名称无效：只能用小写字母、数字和短横线，必须字母开头。' }
  }

  const filename = `${name}.ts`
  if (PROTECTED.has(filename)) {
    return { content: `不能覆盖内置技能: ${name}` }
  }

  // Parse tools definition
  let toolsDef: Array<{ name: string; description: string; parameters: Record<string, unknown> }>
  try {
    toolsDef = JSON.parse(toolsJson)
    if (!Array.isArray(toolsDef) || toolsDef.length === 0) {
      return { content: 'tools_json 必须是非空数组。' }
    }
  } catch (err) {
    return { content: `tools_json 解析失败: ${(err as Error).message}` }
  }

  // Generate tool definitions in OpenAI format
  const toolsCode = toolsDef
    .map(
      (t) => `    {
      type: 'function' as const,
      function: {
        name: ${JSON.stringify(t.name)},
        description: ${JSON.stringify(t.description)},
        parameters: ${JSON.stringify(t.parameters, null, 8).replace(/\n/g, '\n        ')},
      },
    }`
    )
    .join(',\n')

  // Generate the skill file
  const fileContent = `// Auto-generated skill: ${name}
// Created at: ${new Date().toISOString()}
import type { Skill, ToolResult } from './types.js'

const skill: Skill = {
  name: ${JSON.stringify(name)},
  description: ${JSON.stringify(description)},
  tools: [
${toolsCode}
  ],

  async execute(toolName: string, args: Record<string, unknown>, context: { userId: string; userMessage: string }): Promise<ToolResult> {
    ${executeCode}
  },
}

export default skill
`

  const filePath = join(SKILLS_DIR, filename)
  writeFileSync(filePath, fileContent, 'utf-8')

  const toolNames = toolsDef.map((t) => t.name).join(', ')
  return {
    content: `技能「${name}」已创建！\n- 文件: skills/${filename}\n- 工具: ${toolNames}\n- 描述: ${description}\n\n下一轮对话即可使用这些新工具。`,
  }
}

function listSkills(): ToolResult {
  const files = readdirSync(SKILLS_DIR).filter(
    (f) => f.endsWith('.ts') && f !== 'types.ts'
  )

  const lines = files.map((f) => {
    const isBuiltin = PROTECTED.has(f)
    const label = isBuiltin ? '📦 内置' : '🔧 动态'
    return `- ${label} ${f.replace('.ts', '')}`
  })

  return { content: `已安装的技能:\n${lines.join('\n')}` }
}

function deleteSkill(name: string): ToolResult {
  const filename = `${name}.ts`
  if (PROTECTED.has(filename)) {
    return { content: `不能删除内置技能: ${name}` }
  }

  const filePath = join(SKILLS_DIR, filename)
  if (!existsSync(filePath)) {
    return { content: `技能不存在: ${name}` }
  }

  unlinkSync(filePath)
  return { content: `技能「${name}」已删除。下一轮对话生效。` }
}

export default skill
