/**
 * 厂商适配表 —— 三家的统一入口
 *
 * 为什么可以共用一套代码:
 *   DeepSeek 与 OpenAI 本身就是 OpenAI 兼容格式;
 *   Gemini 官方也提供了 OpenAI 兼容层
 *   ( https://generativelanguage.googleapis.com/v1beta/openai/chat/completions ),
 *   同样用 Bearer 鉴权、同样是 SSE 流。
 * 所以请求构造与解析逻辑完全一致,差异只剩 endpoint / key / 模型名三项。
 */

export const PROVIDERS = {
  deepseek: {
    label: 'DeepSeek',
    endpoint: 'https://api.deepseek.com/chat/completions',
    keyEnv: 'DEEPSEEK_API_KEY',
    // V4 系列是当前主力。老端点 deepseek-chat / deepseek-reasoner
    // 已于 2026-07-24 退役,不要再使用。
    defaultModel: 'deepseek-v4-flash',
    visionModel: 'deepseek-v4-flash',
    // 图片计费上限 384 tokens/张,整体最便宜,作为默认
    note: '默认选择:输出 ¥4.5~9 / 百万 tokens(闲时 / 高峰)',
    reasoning: true,
  },
  gemini: {
    label: 'Google Gemini',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    keyEnv: 'GEMINI_API_KEY',
    defaultModel: 'gemini-2.5-flash',
    visionModel: 'gemini-2.5-flash',
    note: '视觉成熟度高,若觉得 DeepSeek 识图不准可切这家对比',
  },
  openai: {
    label: 'OpenAI',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    keyEnv: 'OPENAI_API_KEY',
    defaultModel: 'gpt-4o-mini',
    visionModel: 'gpt-4o-mini',
    note: '价格最高,通常只作为画质/复杂推理兜底',
  },
};

/* ==================== token 预算 ====================
   一个很容易踩的坑:对会输出思维链的模型(DeepSeek V4 的 reasoning_content),
   max_tokens 管的是「思维链 + 正文」的总额,不是正文额度。

   实测(2026-09-19,deepseek-flash):
     "帮我举一反三,出几道类似题"  max_tokens=2048 → 思维链 2933 字,正文 0 字
                                  max_tokens=4096 → 思维链 6063 字,正文 0 字
                                  max_tokens=8192 → 思维链 8328 字,正文 1773 字
   finish_reason 全是 "length",正文被思维链挤没了 —— 表现就是「气泡一片空白」。

   前端的「最大回答长度」是给用户看的正文额度,所以这里必须再加一截思考预算;
   上限 8192 是上游硬限,超了会被拒,所以也不能无限加。 */
export const REASONING_BUDGET = 6144;
const UPSTREAM_CEIL = 8192;

export function resolveMaxTokens(requested, provider) {
  const base = clamp(requested, 1, 8192, 2048);
  if (!provider || !provider.reasoning) return base;
  return Math.min(UPSTREAM_CEIL, base + REASONING_BUDGET);
}

/** 决定用哪家:请求指定 > 服务端环境变量 > deepseek */
export function pickProvider(env, requested) {
  const name = String(requested || env.LLM_PROVIDER || 'deepseek').toLowerCase();
  return { name, provider: PROVIDERS[name] };
}

export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extra },
  });
}

export function clamp(n, lo, hi, fallback = lo) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(lo, Math.min(hi, v));
}

/**
 * 发起到厂商的请求。
 * 关键约束:
 *  - endpoint 只能来自本文件的常量表,前端无法指定,杜绝 SSRF
 *  - 密钥只在这里出现,响应永远不回传
 */
export async function callUpstream({ provider, apiKey, payload }) {
  return fetch(provider.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });
}

/** 流式透传。no-store 必须:否则边缘可能试图缓存这个无限长的响应 */
export function streamToClient(upstream, providerName) {
  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
      'X-LLM-Provider': providerName,
    },
  });
}

/**
 * 收集非流式响应里的文本。
 * 各家 JSON 结构基本一致,但字段名偶有差异,这里做容错取值。
 */
export async function readText(upstream) {
  let data;
  try {
    data = await upstream.json();
  } catch {
    return { text: '', raw: await upstream.text().catch(() => '') };
  }
  const msg = data.choices?.[0]?.message;
  const text =
    (typeof msg?.content === 'string' && msg.content) ||
    (Array.isArray(msg?.content) && msg.content.map(c => c.text || '').join('')) ||
    data.text ||
    data.output_text ||
    '';
  return { text, raw: data };
}
