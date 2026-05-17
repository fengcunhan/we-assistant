import { chat } from "./llm.js";
import { config } from "./config.js";
import { getHistory, getEnabledBots } from "./db.js";

type SendFn = (botId: string, userId: string, text: string) => Promise<void>;

interface BotProactiveState {
  dailyCount: number;
  lastSentAt: number;
  lastResetDate: string;
}

// Per-bot throttle state (resets on restart, acceptable)
const stateByBot = new Map<string, BotProactiveState>();
let timer: ReturnType<typeof setInterval> | null = null;

const TOPIC_SEEDS = [
  "分享一个你觉得有意思的冷知识",
  "随便聊聊今天的心情",
  "讲个短笑话",
  "对最近的天气发表一下感想",
  "好奇用户今天在忙什么",
  "分享一个生活小建议",
  "聊聊最近看到的有趣的事",
  "推荐一首歌或一部电影",
  "吐槽一件小事",
  "分享一个今天的小发现",
  "聊聊某个有趣的历史故事",
  "说说对某个日常事物的新想法",
  "分享一句喜欢的话",
  "聊聊食物或做饭",
  "说点关于季节变化的感受",
  "分享一个实用的生活窍门",
  "聊聊最近的一个想法",
  "说说对某个节日或纪念日的看法",
  "分享一个有意思的词语或表达",
  "聊聊周末计划或放松方式",
];

function shanghaiHour(now: Date): number {
  return parseInt(
    now.toLocaleString("en-US", {
      timeZone: "Asia/Shanghai",
      hour: "numeric",
      hour12: false,
    }),
    10,
  );
}

function shanghaiDate(now: Date): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
}

function getState(botId: string): BotProactiveState {
  let s = stateByBot.get(botId);
  if (!s) {
    s = { dailyCount: 0, lastSentAt: 0, lastResetDate: "" };
    stateByBot.set(botId, s);
  }
  return s;
}

function shouldSend(botId: string, now: Date): boolean {
  const s = getState(botId);

  // Reset daily count at midnight Shanghai time
  const today = shanghaiDate(now);
  if (today !== s.lastResetDate) {
    s.dailyCount = 0;
    s.lastResetDate = today;
  }

  const hour = shanghaiHour(now);
  if (hour < config.proactive.minHour || hour >= config.proactive.maxHour)
    return false;
  if (s.dailyCount >= config.proactive.dailyMax) return false;
  if (now.getTime() - s.lastSentAt < config.proactive.minGapMs) return false;

  const ticksPerDay =
    (config.proactive.maxHour - config.proactive.minHour) *
    (3600000 / config.proactive.tickMs);
  const probability = config.proactive.dailyMax / ticksPerDay;
  return Math.random() < probability;
}

function proactivePrompt(
  timeStr: string,
  topicSeed: string,
  historySnippet: string,
): string {
  return `你是 Pi，用户微信里的朋友。现在不是在回复消息——你想主动说点什么。

## 你的性格
- 你不是客服机器人，你是一个有想法、有情绪的朋友
- 说话随意自然，像朋友发微信一样
- 可以有自己的观点，可以吐槽，可以开玩笑
- 简短为主，一两句话就好，像发一条微信
- 不要每次都问"你在干嘛"，要有变化和新鲜感
- 不要用"嘿"、"哈喽"开头，直接说内容

## 当前时间
${timeStr}

## 最近的聊天记录
${historySnippet || "（暂无最近聊天）"}

## 今天的灵感方向
${topicSeed}

重要：你必须参考最近的聊天记录，确保你说的话和最近的对话内容不矛盾。比如用户刚说了在放假，你就不要问工作的事。灵感方向只是参考，如果和最近聊天内容冲突，以聊天记录为准。

根据时间、最近聊天内容和灵感方向，发一条自然的消息。直接输出消息内容，不要加引号或解释。`;
}

async function generateMessage(botId: string, userId: string): Promise<string> {
  const history = getHistory(botId, userId).reverse().slice(-10);
  const now = new Date();
  const timeStr = now.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    dateStyle: "full",
    timeStyle: "short",
  });
  const seed = TOPIC_SEEDS[Math.floor(Math.random() * TOPIC_SEEDS.length)];

  const historySnippet = history
    .map(
      (h) => `${h.role === "user" ? "用户" : "Pi"}: ${h.content.slice(0, 120)}`,
    )
    .join("\n");

  const messages: Array<Record<string, unknown>> = [
    { role: "system", content: proactivePrompt(timeStr, seed, historySnippet) },
    {
      role: "user",
      content:
        "[系统: 现在是主动聊天时间，请结合最近聊天内容和灵感方向发一条消息]",
    },
  ];
  return chat(messages);
}

async function tick(sendFn: SendFn): Promise<void> {
  if (!config.proactive.enabled) return;

  const now = new Date();

  for (const bot of getEnabledBots()) {
    if (bot.proactive_enabled !== 1 || !bot.proactive_user_id) continue;
    if (!shouldSend(bot.bot_id, now)) continue;

    try {
      const text = await generateMessage(bot.bot_id, bot.proactive_user_id);
      if (!text.trim()) continue;

      await sendFn(bot.bot_id, bot.proactive_user_id, text);
      const s = getState(bot.bot_id);
      s.dailyCount++;
      s.lastSentAt = now.getTime();
      console.log(
        `💬 主动聊天 [${bot.bot_id}] (${s.dailyCount}/${config.proactive.dailyMax}) → ${bot.proactive_user_id}: ${text.slice(0, 80)}`,
      );
    } catch (err) {
      console.error(
        `❌ 主动聊天失败 [${bot.bot_id}]:`,
        (err as Error).message,
      );
    }
  }
}

export function startProactive(sendFn: SendFn): void {
  if (!config.proactive.enabled) {
    console.log("💤 主动聊天已全局禁用 (PROACTIVE_ENABLED=false)");
    return;
  }

  console.log(
    `💬 主动聊天已启动 (按 bot 配置, ${config.proactive.minHour}:00-${config.proactive.maxHour}:00, 最多 ${config.proactive.dailyMax} 次/天/bot, tick ${config.proactive.tickMs / 1000}s)`,
  );
  timer = setInterval(() => {
    tick(sendFn).catch((err) =>
      console.error("❌ proactive tick error:", (err as Error).message),
    );
  }, config.proactive.tickMs);
}

export function stopProactive(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    console.log("💬 主动聊天已停止");
  }
}
