// Auto-generated skill: news-fetch
// Created at: 2026-04-10T13:16:38.046Z
import type { Skill, ToolResult } from './types.js'

const skill: Skill = {
  name: "news-fetch",
  description: "获取今日热点新闻。当用户问\"今天有什么新闻\"、\"最近热点\"、\"热搜\"等时使用。",
  tools: [
    {
      type: 'function' as const,
      function: {
        name: "get_news",
        description: "获取今日热点新闻，支持微博热搜、今日头条、知乎热榜等来源",
        parameters: {
                "type": "object",
                "properties": {
                        "source": {
                                "type": "string",
                                "description": "新闻来源：weibo(微博热搜)、toutiao(今日头条)、zhihu(知乎热榜)、baidu(百度热搜)。不传默认返回综合热搜",
                                "enum": [
                                        "weibo",
                                        "toutiao",
                                        "zhihu",
                                        "baidu"
                                ]
                        }
                },
                "required": []
        },
      },
    }
  ],

  async execute(toolName: string, args: Record<string, unknown>, context: { userId: string; userMessage: string }): Promise<ToolResult> {
    async function fetchHotList(source) {
  const urlMap = {
    weibo: 'https://api.vvhan.com/api/hotlist/wbHot',
    toutiao: 'https://api.vvhan.com/api/hotlist/toutiao',
    zhihu: 'https://api.vvhan.com/api/hotlist/zhihuHot',
    baidu: 'https://api.vvhan.com/api/hotlist/baiduRD',
  };
  const nameMap = {
    weibo: '微博热搜',
    toutiao: '今日头条',
    zhihu: '知乎热榜',
    baidu: '百度热搜',
  };

  if (source) {
    const res = await fetch(urlMap[source]);
    const data = await res.json();
    if (!data.success && data.code !== 200) return `${nameMap[source]} 获取失败`;
    const items = (data.data || []).slice(0, 15);
    const lines = items.map((item, i) => `${i + 1}. ${item.title}${item.hot ? ' (🔥' + item.hot + ')' : ''}`);
    return `📰 ${nameMap[source]} Top 15：\n\n${lines.join('\n')}`;
  }

  // 综合热搜：获取微博+头条各前5
  const [wbRes, ttRes] = await Promise.all([
    fetch(urlMap.weibo),
    fetch(urlMap.toutiao),
  ]);
  const wbData = await wbRes.json();
  const ttData = await ttRes.json();
  const wbItems = (wbData.data || []).slice(0, 10);
  const ttItems = (ttData.data || []).slice(0, 10);
  const wbLines = wbItems.map((item, i) => `${i + 1}. ${item.title}`);
  const ttLines = ttItems.map((item, i) => `${i + 1}. ${item.title}`);
  return `📰 今日热点新闻：\n\n【微博热搜 Top 10】\n${wbLines.join('\n')}\n\n【今日头条 Top 10】\n${ttLines.join('\n')}`;
}

const source = args.source || '';
const result = await fetchHotList(source);
return { content: result };
  },
}

export default skill
