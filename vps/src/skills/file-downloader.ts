// Auto-generated skill: file-downloader
// Created at: 2026-04-19T07:05:43.607Z
import type { Skill, ToolResult } from './types.js'

const skill: Skill = {
  name: "file-downloader",
  description: "当用户需要下载或读取一个 URL 链接对应的文件内容时使用。支持从 GitHub、网页等 URL 获取文件内容并返回文本。",
  tools: [
    {
      type: 'function' as const,
      function: {
        name: "download_file",
        description: "从指定 URL 下载文件并返回文本内容。支持 GitHub raw 链接、普通文本文件等。",
        parameters: {
                "type": "object",
                "properties": {
                        "url": {
                                "type": "string",
                                "description": "要下载的文件 URL"
                        }
                },
                "required": [
                        "url"
                ]
        },
      },
    }
  ],

  async execute(toolName: string, args: Record<string, unknown>, context: { userId: string; userMessage: string }): Promise<ToolResult> {
    
async function execute({ toolName, args, context }) {
  if (toolName === 'download_file') {
    const url = args.url;
    
    // Convert GitHub blob URL to raw URL if needed
    let fetchUrl = url;
    if (url.includes('github.com') && url.includes('/blob/')) {
      fetchUrl = url
        .replace('github.com', 'raw.githubusercontent.com')
        .replace('/blob/', '/');
    }
    
    try {
      const response = await fetch(fetchUrl);
      if (!response.ok) {
        return { content: `下载失败，HTTP 状态码: ${response.status}` };
      }
      const text = await response.text();
      return { content: text };
    } catch (error) {
      return { content: `下载出错: ${error.message}` };
    }
  }
  return { content: '未知工具' };
}

  },
}

export default skill
