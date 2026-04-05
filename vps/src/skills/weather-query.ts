// Auto-generated skill: weather-query
// Created at: 2026-04-02T07:44:16.721Z
import type { Skill, ToolResult } from './types.js'

const skill: Skill = {
  name: "weather-query",
  description: "当用户想查询某个城市的天气情况时使用，包括当前天气、温度、湿度、风力等信息",
  tools: [
    {
      type: 'function' as const,
      function: {
        name: "get_weather",
        description: "查询指定城市的天气情况",
        parameters: {
                "type": "object",
                "properties": {
                        "city": {
                                "type": "string",
                                "description": "城市名称，如'北京'、'上海'、'杭州'"
                        }
                },
                "required": [
                        "city"
                ]
        },
      },
    }
  ],

  async execute(toolName: string, args: Record<string, unknown>, context: { userId: string; userMessage: string }): Promise<ToolResult> {
    
const city = args.city || '北京';
const url = `https://wttr.in/${encodeURIComponent(city)}?format=j1&lang=zh`;

const resp = await fetch(url);
const data = await resp.json();

const current = data.current_condition[0];
const area = data.nearest_area[0];

const temp = current.temp_C;
const feelsLike = current.FeelsLikeC;
const humidity = current.humidity;
const windSpeed = current.windspeedKmph;
const windDir = current.winddir16Point;
const desc = current.lang_zh && current.lang_zh[0] ? current.lang_zh[0].value : current.weatherDesc[0].value;
const visibility = current.visibility;
const pressure = current.pressure;

// forecast
let forecastStr = '';
if (data.weather) {
  const today = data.weather[0];
  const tomorrow = data.weather[1];
  forecastStr = `\n\n📅 明天预报: ${tomorrow.mintempC}°C ~ ${tomorrow.maxtempC}°C`;
}

const result = `📍 ${area.areaName[0].value}, ${area.region[0].value}
🌡️ 温度: ${temp}°C（体感 ${feelsLike}°C）
🌤️ 天气: ${desc}
💧 湿度: ${humidity}%
🌬️ 风力: ${windDir} ${windSpeed}km/h
👁️ 能见度: ${visibility}km
📊 气压: ${pressure}hPa${forecastStr}`;

return { content: result };

  },
}

export default skill
