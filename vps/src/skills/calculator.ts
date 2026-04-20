// Auto-generated skill: calculator
// Created at: 2026-04-06T12:38:01.963Z
import type { Skill, ToolResult } from './types.js'

const skill: Skill = {
  name: "calculator",
  description: "当用户需要进行数学计算时使用，支持加减乘除、幂运算、括号、三角函数、对数、平方根等数学运算。",
  tools: [
    {
      type: 'function' as const,
      function: {
        name: "calculate",
        description: "计算数学表达式的结果，支持四则运算、幂运算(**)、取余(%)、括号、以及常用数学函数：sqrt, abs, round, ceil, floor, sin, cos, tan, log, log2, log10, pow, min, max, PI, E",
        parameters: {
                "type": "object",
                "properties": {
                        "expression": {
                                "type": "string",
                                "description": "数学表达式，如 '2 + 3 * 4'、'sqrt(16)'、'sin(PI/6)'、'2**10'"
                        }
                },
                "required": [
                        "expression"
                ]
        },
      },
    }
  ],

  async execute(toolName: string, args: Record<string, unknown>, context: { userId: string; userMessage: string }): Promise<ToolResult> {
    const expr = args.expression;
if (!expr || typeof expr !== 'string') {
  return { content: '请提供一个有效的数学表达式' };
}
// 安全的数学计算环境
const mathEnv = {
  sqrt: Math.sqrt, abs: Math.abs, round: Math.round,
  ceil: Math.ceil, floor: Math.floor,
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  log: Math.log, log2: Math.log2, log10: Math.log10,
  pow: Math.pow, min: Math.min, max: Math.max,
  PI: Math.PI, E: Math.E,
};
// 白名单检查：只允许数字、运算符、括号、逗号、空格和已知函数名
const allowed = /^[\d+\-*/().%,\s]|sqrt|abs|round|ceil|floor|sin|cos|tan|asin|acos|atan|log|log2|log10|pow|min|max|PI|E|\*{2}$/;
const cleaned = expr.replace(/sqrt|abs|round|ceil|floor|sin|cos|tan|asin|acos|atan|log2|log10|log|pow|min|max|PI|E/g, '');
if (/[a-zA-Z_$]/.test(cleaned)) {
  return { content: '表达式包含不支持的字符，仅支持数学运算和常用函数' };
}
try {
  const fn = new Function(...Object.keys(mathEnv), `return (${expr})`);
  const result = fn(...Object.values(mathEnv));
  if (typeof result !== 'number' || isNaN(result)) {
    return { content: `计算结果无效，请检查表达式是否正确：${expr}` };
  }
  return { content: `${expr} = ${Number.isInteger(result) ? result : parseFloat(result.toFixed(10))}` };
} catch (e) {
  return { content: `表达式计算出错：${e.message}，请检查格式是否正确` };
}
  },
}

export default skill
