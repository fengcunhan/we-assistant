// Auto-generated skill: wechat-article-fetcher
// Created at: 2026-04-06T12:44:26.793Z
import type { Skill, ToolResult } from './types.js'

const skill: Skill = {
  name: "wechat-article-fetcher",
  description: "使用微信 User-Agent 抓取微信公众号文章内容，解析标题、作者、正文，并将文章分段返回。当用户提供微信公众号文章链接时使用此技能。",
  tools: [
    {
      type: 'function' as const,
      function: {
        name: "fetch_wechat_article",
        description: "抓取微信公众号文章内容，解析标题、作者和正文，分段返回。url 参数为公众号文章链接。",
        parameters: {
                "type": "object",
                "properties": {
                        "url": {
                                "type": "string",
                                "description": "微信公众号文章 URL"
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
    
const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.47(0x18002f2b) NetType/WIFI Language/zh_CN';

if (toolName === 'fetch_wechat_article') {
  const { url } = args;

  // Helper: strip HTML tags and decode entities
  function stripHtml(html) {
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/section>/gi, '\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#(\d+);/g, (m, code) => String.fromCharCode(parseInt(code)))
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': ua,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Referer': 'https://mp.weixin.qq.com/',
      },
      redirect: 'follow',
    });

    const html = await response.text();

    // Extract title
    let title = '未知标题';
    const titlePatterns = [
      /id="activity-name"[^>]*>\s*([\s\S]*?)\s*<\/h1>/,
      /var\s+msg_title\s*=\s*'([\s\S]*?)'/,
      /var\s+msg_title\s*=\s*"([\s\S]*?)"/,
      /<title>([\s\S]*?)<\/title>/,
    ];
    for (const p of titlePatterns) {
      const m = html.match(p);
      if (m && m[1].trim()) { title = stripHtml(m[1]).trim(); break; }
    }

    // Extract author
    let author = '未知作者';
    const authorPatterns = [
      /var\s+nickname\s*=\s*'([\s\S]*?)'/,
      /var\s+nickname\s*=\s*"([\s\S]*?)"/,
      /id="profileBt"[^>]*>\s*([\s\S]*?)\s*<\/a>/,
      /class="rich_media_meta_nickname"[^>]*>\s*([\s\S]*?)\s*<\/a>/,
      /class="rich_media_meta_text"[^>]*>\s*([\s\S]*?)\s*<\/span>/,
    ];
    for (const p of authorPatterns) {
      const m = html.match(p);
      if (m && m[1].trim()) { author = stripHtml(m[1]).trim(); break; }
    }

    // Extract content
    let contentHtml = '';

    // Method 1: id="js_content"
    const jsContentMatch = html.match(/id="js_content"[^>]*>([\s\S]*?)(?=<\/div>\s*<\/div>\s*<script|<\/div>\s*<script|id="js_pc_close_btn")/);
    if (jsContentMatch && jsContentMatch[1].trim().length > 50) {
      contentHtml = jsContentMatch[1];
    }

    // Method 2: class="rich_media_content"
    if (!contentHtml || contentHtml.length < 50) {
      const richMatch = html.match(/class="rich_media_content[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<\/div>|<script)/);
      if (richMatch && richMatch[1].trim().length > 50) {
        contentHtml = richMatch[1];
      }
    }

    // Method 3: manual extraction from js_content
    if (!contentHtml || contentHtml.length < 50) {
      const startIdx = html.indexOf('id="js_content"');
      if (startIdx !== -1) {
        const afterTag = html.substring(startIdx);
        const gtIdx = afterTag.indexOf('>');
        if (gtIdx !== -1) {
          contentHtml = afterTag.substring(gtIdx + 1);
          // Find reasonable end
          const endMarkers = ['<script', 'id="js_pc_close_btn"', 'id="content_bottom_area"'];
          let endIdx = contentHtml.length;
          for (const marker of endMarkers) {
            const idx = contentHtml.indexOf(marker);
            if (idx > 0 && idx < endIdx) endIdx = idx;
          }
          contentHtml = contentHtml.substring(0, endIdx);
        }
      }
    }

    const cleanContent = stripHtml(contentHtml);

    if (!cleanContent || cleanContent.length < 20) {
      // Return debug info
      const debugSnippet = html.substring(html.indexOf('id="js_content"'), html.indexOf('id="js_content"') + 1000);
      return {
        content: JSON.stringify({
          success: false,
          error: '无法解析文章内容',
          title,
          author,
          htmlLength: html.length,
          contentHtmlLength: contentHtml.length,
          cleanContentLength: cleanContent.length,
          debugSnippet: debugSnippet.substring(0, 500),
          htmlPreview: html.substring(0, 800)
        }, null, 2)
      };
    }

    // Split into segments (~800 chars max)
    const paragraphs = cleanContent.split(/\n+/).filter(p => p.trim());
    const segments = [];
    let current = '';

    for (const para of paragraphs) {
      if (current.length + para.length > 800 && current.length > 0) {
        segments.push(current.trim());
        current = para;
      } else {
        current += (current ? '\n' : '') + para;
      }
    }
    if (current.trim()) segments.push(current.trim());

    return {
      content: JSON.stringify({
        success: true,
        title,
        author,
        totalLength: cleanContent.length,
        segmentCount: segments.length,
        segments,
        preview: cleanContent.substring(0, 300)
      }, null, 2)
    };

  } catch (error) {
    return { content: JSON.stringify({ success: false, error: error.message, stack: error.stack }, null, 2) };
  }
}

  },
}

export default skill
