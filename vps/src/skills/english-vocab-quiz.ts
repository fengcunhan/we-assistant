// Auto-generated skill: english-vocab-quiz
// Created at: 2026-04-12T04:31:02.737Z
import type { Skill, ToolResult } from './types.js'

const skill: Skill = {
  name: "english-vocab-quiz",
  description: "英语单词学习与测验技能。随机发送英语单词，用户回答中文含义，支持记忆曲线复习、错题本、正确单词记录。每天不超过10个单词。",
  tools: [
    {
      type: 'function' as const,
      function: {
        name: "get_random_word",
        description: "从词库中随机获取一个英语单词用于学习。会自动排除最近已学过的单词（通过传入 learned 参数）。",
        parameters: {
                "type": "object",
                "properties": {
                        "learned": {
                                "type": "string",
                                "description": "已经学过的单词列表，逗号分隔，用于排除"
                        },
                        "level": {
                                "type": "number",
                                "description": "单词难度级别：1=基础, 2=中级, 3=高级。不传则随机"
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
        description: "检查用户回答的中文含义是否正确，支持模糊匹配和近义词识别。",
        parameters: {
                "type": "object",
                "properties": {
                        "word": {
                                "type": "string",
                                "description": "英语单词"
                        },
                        "answer": {
                                "type": "string",
                                "description": "用户的中文回答"
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
        name: "get_word_bank_info",
        description: "获取词库统计信息，包括各级别单词数量。",
        parameters: {
                "type": "object",
                "properties": {},
                "required": []
        },
      },
    }
  ],

  async execute(toolName: string, args: Record<string, unknown>, context: { userId: string; userMessage: string }): Promise<ToolResult> {
    const wordBank = [
  // ===== Level 1 - 基础词汇 (30) =====
  { word: "abandon", meaning: "放弃", alts: ["抛弃", "遗弃"], level: 1 },
  { word: "absorb", meaning: "吸收", alts: ["吸纳", "吸引"], level: 1 },
  { word: "achieve", meaning: "实现", alts: ["达到", "完成"], level: 1 },
  { word: "adapt", meaning: "适应", alts: ["改编", "调整"], level: 1 },
  { word: "admire", meaning: "钦佩", alts: ["欣赏", "羡慕"], level: 1 },
  { word: "afford", meaning: "负担得起", alts: ["买得起", "承担"], level: 1 },
  { word: "announce", meaning: "宣布", alts: ["公布", "宣告"], level: 1 },
  { word: "appreciate", meaning: "感激", alts: ["欣赏", "理解"], level: 1 },
  { word: "approach", meaning: "接近", alts: ["方法", "途径", "靠近"], level: 1 },
  { word: "avoid", meaning: "避免", alts: ["回避", "躲避"], level: 1 },
  { word: "benefit", meaning: "好处", alts: ["利益", "益处"], level: 1 },
  { word: "cancel", meaning: "取消", alts: ["撤销", "废除"], level: 1 },
  { word: "challenge", meaning: "挑战", alts: ["质疑", "难题"], level: 1 },
  { word: "comfort", meaning: "安慰", alts: ["舒适", "舒服"], level: 1 },
  { word: "concern", meaning: "关心", alts: ["担忧", "关切"], level: 1 },
  { word: "confirm", meaning: "确认", alts: ["证实", "确定"], level: 1 },
  { word: "create", meaning: "创造", alts: ["创建", "创作"], level: 1 },
  { word: "deliver", meaning: "递送", alts: ["交付", "发表"], level: 1 },
  { word: "develop", meaning: "发展", alts: ["开发", "研制"], level: 1 },
  { word: "discover", meaning: "发现", alts: ["探索", "发觉"], level: 1 },
  { word: "encourage", meaning: "鼓励", alts: ["激励", "鼓舞"], level: 1 },
  { word: "estimate", meaning: "估计", alts: ["估算", "估价"], level: 1 },
  { word: "explore", meaning: "探索", alts: ["探究", "考察"], level: 1 },
  { word: "generous", meaning: "慷慨的", alts: ["大方", "大方"], level: 1 },
  { word: "hesitate", meaning: "犹豫", alts: ["迟疑", "踌躇"], level: 1 },
  { word: "imagine", meaning: "想象", alts: ["设想", "猜想"], level: 1 },
  { word: "improve", meaning: "改善", alts: ["提高", "改进"], level: 1 },
  { word: "include", meaning: "包括", alts: ["包含"], level: 1 },
  { word: "manage", meaning: "管理", alts: ["处理", "应对"], level: 1 },
  { word: "prevent", meaning: "预防", alts: ["阻止", "防止"], level: 1 },

  // ===== Level 2 - 中级词汇 (30) =====
  { word: "accelerate", meaning: "加速", alts: ["促进", "加快"], level: 2 },
  { word: "accumulate", meaning: "积累", alts: ["积聚", "堆积"], level: 2 },
  { word: "acknowledge", meaning: "承认", alts: ["确认", "致谢"], level: 2 },
  { word: "acquire", meaning: "获得", alts: ["获取", "习得"], level: 2 },
  { word: "anticipate", meaning: "预期", alts: ["预料", "期望"], level: 2 },
  { word: "appropriate", meaning: "适当的", alts: ["合适", "恰当"], level: 2 },
  { word: "assess", meaning: "评估", alts: ["评价", "评定"], level: 2 },
  { word: "attribute", meaning: "归因于", alts: ["属性", "特质"], level: 2 },
  { word: "compensate", meaning: "补偿", alts: ["赔偿", "弥补"], level: 2 },
  { word: "compromise", meaning: "妥协", alts: ["折中", "让步"], level: 2 },
  { word: "consequence", meaning: "后果", alts: ["结果", "影响"], level: 2 },
  { word: "contribute", meaning: "贡献", alts: ["促成", "投稿"], level: 2 },
  { word: "demonstrate", meaning: "展示", alts: ["证明", "示范"], level: 2 },
  { word: "distinguish", meaning: "区分", alts: ["辨别", "区别"], level: 2 },
  { word: "eliminate", meaning: "消除", alts: ["排除", "淘汰"], level: 2 },
  { word: "emphasize", meaning: "强调", alts: ["着重", "突出"], level: 2 },
  { word: "encounter", meaning: "遭遇", alts: ["遇到", "邂逅"], level: 2 },
  { word: "evaluate", meaning: "评价", alts: ["评估", "估价"], level: 2 },
  { word: "fundamental", meaning: "基本的", alts: ["根本", "基础"], level: 2 },
  { word: "guarantee", meaning: "保证", alts: ["担保", "保障"], level: 2 },
  { word: "implement", meaning: "实施", alts: ["执行", "实现"], level: 2 },
  { word: "interpret", meaning: "解释", alts: ["口译", "解读"], level: 2 },
  { word: "justify", meaning: "证明合理", alts: ["辩护", "正当化"], level: 2 },
  { word: "negotiate", meaning: "谈判", alts: ["协商", "磋商"], level: 2 },
  { word: "perceive", meaning: "感知", alts: ["察觉", "认为"], level: 2 },
  { word: "pursue", meaning: "追求", alts: ["追赶", "从事"], level: 2 },
  { word: "relevant", meaning: "相关的", alts: ["有关", "切题"], level: 2 },
  { word: "substantial", meaning: "大量的", alts: ["重大", "实质性"], level: 2 },
  { word: "transform", meaning: "转变", alts: ["改造", "变换"], level: 2 },
  { word: "voluntary", meaning: "自愿的", alts: ["志愿", "义务"], level: 2 },

  // ===== Level 3 - 高级词汇 (20) =====
  { word: "ambiguous", meaning: "模糊的", alts: ["含糊", "模棱两可"], level: 3 },
  { word: "comprehensive", meaning: "全面的", alts: ["综合", "详尽"], level: 3 },
  { word: "contemplate", meaning: "沉思", alts: ["考虑", "凝视"], level: 3 },
  { word: "deteriorate", meaning: "恶化", alts: ["退化", "变坏"], level: 3 },
  { word: "discrepancy", meaning: "差异", alts: ["不一致", "矛盾"], level: 3 },
  { word: "empirical", meaning: "实证的", alts: ["经验主义的", "经验"], level: 3 },
  { word: "exacerbate", meaning: "加剧", alts: ["使恶化", "激化"], level: 3 },
  { word: "facilitate", meaning: "促进", alts: ["使便利", "推动"], level: 3 },
  { word: "inevitable", meaning: "不可避免的", alts: ["必然", "注定"], level: 3 },
  { word: "meticulous", meaning: "一丝不苟的", alts: ["细致", "仔细"], level: 3 },
  { word: "nuance", meaning: "细微差别", alts: ["微妙之处"], level: 3 },
  { word: "paradigm", meaning: "范式", alts: ["典范", "模式"], level: 3 },
  { word: "phenomenon", meaning: "现象", alts: ["奇迹"], level: 3 },
  { word: "resilient", meaning: "有韧性的", alts: ["弹性", "适应力强"], level: 3 },
  { word: "scrutinize", meaning: "仔细审查", alts: ["审视", "细查"], level: 3 },
  { word: "unprecedented", meaning: "前所未有的", alts: ["空前的", "史无前例"], level: 3 },
  { word: "pragmatic", meaning: "务实的", alts: ["实用", "实际"], level: 3 },
  { word: "prevalent", meaning: "普遍的", alts: ["流行", "盛行"], level: 3 },
  { word: "elaborate", meaning: "精心制作的", alts: ["详细", "阐述"], level: 3 },
  { word: "synthesize", meaning: "综合", alts: ["合成", "整合"], level: 3 }
];

if (toolName === "get_random_word") {
  const learnedStr = (args as any).learned || "";
  const level = (args as any).level;
  const learnedSet = new Set(learnedStr.split(",").map((s: string) => s.trim().toLowerCase()).filter(Boolean));

  let pool = wordBank;
  if (level) pool = pool.filter(w => w.level === level);

  const available = pool.filter(w => !learnedSet.has(w.word.toLowerCase()));

  if (available.length === 0) {
    return {
      content: JSON.stringify({
        message: "词库中的单词都已学过啦！进入复习模式吧 🎉",
        totalWords: wordBank.length,
        learned: learnedSet.size
      })
    };
  }

  const idx = Math.floor(Math.random() * available.length);
  const w = available[idx];
  return {
    content: JSON.stringify({
      word: w.word,
      level: w.level,
      levelLabel: w.level === 1 ? "基础" : w.level === 2 ? "中级" : "高级",
      totalWords: wordBank.length,
      remaining: available.length
    })
  };
}

if (toolName === "check_answer") {
  const { word, answer } = args as { word: string; answer: string };
  const found = wordBank.find(w => w.word.toLowerCase() === String(word).toLowerCase());
  if (!found) {
    return { content: JSON.stringify({ error: "词库中未找到该单词", word }) };
  }

  const userAns = String(answer).trim();
  const allMeanings = [found.meaning, ...found.alts];

  // 模糊匹配：用户答案包含正确含义，或正确含义包含用户答案
  const isExact = allMeanings.some(m => m === userAns);
  const isPartial = allMeanings.some(m =>
    m.length >= 2 && (userAns.includes(m) || m.includes(userAns))
  );
  // 去掉"的"字后匹配
  const isClose = allMeanings.some(m => {
    const clean = (s: string) => s.replace(/的$/, "");
    return clean(m) === clean(userAns);
  });

  const isCorrect = isExact || isPartial || isClose;

  return {
    content: JSON.stringify({
      correct: isCorrect,
      word: found.word,
      meaning: found.meaning,
      alternatives: found.alts,
      userAnswer: userAns,
      level: found.level,
      levelLabel: found.level === 1 ? "基础" : found.level === 2 ? "中级" : "高级",
      hint: isCorrect ? "" : `正确答案：${found.meaning}（近义词：${found.alts.join("、")}）`
    })
  };
}

if (toolName === "get_word_bank_info") {
  return {
    content: JSON.stringify({
      totalWords: wordBank.length,
      levels: {
        "1": { count: wordBank.filter(w => w.level === 1).length, label: "基础" },
        "2": { count: wordBank.filter(w => w.level === 2).length, label: "中级" },
        "3": { count: wordBank.filter(w => w.level === 3).length, label: "高级" }
      }
    })
  };
}

return { content: JSON.stringify({ error: "未知工具: " + toolName }) };
  },
}

export default skill
