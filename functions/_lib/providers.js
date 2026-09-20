/**
 * 厂商适配表
 *
 * 为什么一套代码能接多家:
 *   它们都提供 **OpenAI 兼容接口** —— 同样的 `/chat/completions` 路径、
 *   `Authorization: Bearer` 鉴权、同样的 SSE 流式格式。
 *   所以请求构造与解析逻辑完全一致,差异只剩 endpoint / 密钥变量 / 模型名三项。
 *
 * ⚠️ 这里刻意**只收国内可直接访问的厂商**。
 *   早先版本里放过 `gemini` 与 `openai`,但两家在国内都连不上
 *   (OpenAI 本身不向中国大陆提供服务,Gemini 同样需要海外网络),
 *   留着就是"永远走不到的死配置",已移除。
 *   想再加任何 OpenAI 兼容厂商,照下面补一条即可 ——
 *   端点必须写死在本文件,不能由前端指定(防 SSRF)。
 *
 * ⚠️ 模型名变更很快,而且各家的命名规则不统一。
 *   所以每家都留了 `<厂商>_MODEL` / `<厂商>_VISION_MODEL` 环境变量做覆盖,
 *   改配置即可,不用改代码。默认值以各家控制台当时的名称为准。
 */

export const PROVIDERS = {
  deepseek: {
    label: 'DeepSeek',
    endpoint: 'https://api.deepseek.com/chat/completions',
    keyEnv: 'DEEPSEEK_API_KEY',
    modelEnv: 'DEEPSEEK_MODEL',
    visionModelEnv: 'DEEPSEEK_VISION_MODEL',
    // V4 系列是当前主力。老端点 deepseek-chat / deepseek-reasoner
    // 已于 2026-07-24 退役,不要再使用。
    defaultModel: 'deepseek-v4-flash',
    visionModel: 'deepseek-v4-flash',
    // 图片计费上限 384 tokens/张,整体最便宜,作为默认
    note: '默认选择:输出 ¥4.5~9 / 百万 tokens(闲时 / 高峰),图文识别也走它',
    reasoning: true,
    // 端到端实测过(2026-09):流式、视觉、扫描件三条链路都跑通
    e2eVerified: true,
  },

  /* ---------- 以下四家为「可选替代」,代码路径与 DeepSeek 完全相同 ---------- */

  qwen: {
    label: '通义千问 · 阿里百炼',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    keyEnv: 'DASHSCOPE_API_KEY',
    modelEnv: 'QWEN_MODEL',
    visionModelEnv: 'QWEN_VISION_MODEL',
    defaultModel: 'qwen3.7-plus',
    visionModel: 'qwen-vl-max',
    note: '百炼平台有免费额度;Qwen-VL 系列识图能力强,可作视觉对照',
    reasoning: true,
    e2eVerified: false,
  },
  zhipu: {
    label: '智谱 GLM',
    endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    keyEnv: 'ZHIPU_API_KEY',
    modelEnv: 'ZHIPU_MODEL',
    visionModelEnv: 'ZHIPU_VISION_MODEL',
    defaultModel: 'glm-5',
    visionModel: 'glm-5v',
    note: '清华系;GLM 的 Flash 档有免费额度,适合压成本',
    reasoning: true,
    e2eVerified: false,
  },
  moonshot: {
    label: '月之暗面 Kimi',
    endpoint: 'https://api.moonshot.cn/v1/chat/completions',
    keyEnv: 'MOONSHOT_API_KEY',
    modelEnv: 'MOONSHOT_MODEL',
    visionModelEnv: 'MOONSHOT_VISION_MODEL',
    // kimi-latest 是官方提供的"跟随最新模型"别名,长上下文场景省心
    defaultModel: 'kimi-latest',
    visionModel: 'kimi-latest',
    note: '长上下文见长,适合一次塞进很长的讲义',
    reasoning: true,
    e2eVerified: false,
  },
  doubao: {
    label: '豆包 · 火山方舟',
    endpoint: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
    keyEnv: 'ARK_API_KEY',
    modelEnv: 'ARK_MODEL',
    visionModelEnv: 'ARK_VISION_MODEL',
    defaultModel: 'doubao-2.0-pro-256k',
    visionModel: 'doubao-2.0-vision',
    // 方舟有时要求填「推理接入点 ID」(ep-xxxxxxxx)而不是模型名,
    // 遇到 400 就把 ARK_MODEL 设成控制台里的接入点 ID
    note: '字节系;注意方舟可能要求在控制台创建接入点,用 ep- 开头的 ID',
    reasoning: true,
    e2eVerified: false,
  },
};

export const DEFAULT_PROVIDER = 'deepseek';

/* ==================== 模型名解析 ====================
   环境变量优先,其次用表里的默认值。
   kind: 'chat'(文字对话) | 'vision'(图片 / 扫描件解析) */
export function resolveModel(env, provider, kind = 'chat') {
  if (!provider) return '';
  const vision = kind === 'vision';
  const envKey = vision ? provider.visionModelEnv : provider.modelEnv;
  const fallback = vision ? provider.visionModel : provider.defaultModel;
  const override = envKey && env ? String(env[envKey] ?? '').trim() : '';
  return override || fallback || '';
}

/* ==================== token 预算 ====================
   一个很容易踩的坑:对会输出思维链的模型,max_tokens 管的是
   「思维链 + 正文」的总额,不是正文额度。

   实测(2026-09-19,deepseek-v4-flash):
     "帮我举一反三,出几道类似题"  max_tokens=2048 → 思维链 2933 字,正文 0 字
                                  max_tokens=4096 → 思维链 6063 字,正文 0 字
                                  max_tokens=8192 → 思维链 8328 字,正文 1773 字
   finish_reason 全是 "length",正文被思维链挤没了 —— 表现就是「气泡一片空白」。

   前端的「最大回答长度」是给用户看的正文额度,所以这里必须再加一截思考预算;
   上限是上游硬限,超了会被拒,所以也不能无限加。

   注意 reasoning 宁可为 true:多给预算只是让 max_tokens 大一点(无害),
   而漏给会导致正文一个字都出不来(难查)。各家的实际上限如果低于 8192,
   在厂商表里加一个 `maxOutput: 4096` 覆盖即可;不填就按 8192 算。 */
export const REASONING_BUDGET = 6144;
const UPSTREAM_CEIL = 8192;

export function resolveMaxTokens(requested, provider) {
  const base = clamp(requested, 1, 8192, 2048);
  if (!provider || !provider.reasoning) return base;
  const ceil = clamp(provider.maxOutput, 1, UPSTREAM_CEIL, UPSTREAM_CEIL);
  return Math.min(ceil, base + REASONING_BUDGET);
}

/* ==================== 厂商选择 ====================
   请求指定 > 服务端环境变量 > deepseek。
   必须用 hasOwnProperty 判断:name 来自客户端,直接下标取值的话
   `provider=constructor` / `toString` 会从原型链上取到函数,
   虽然不至于打穿,但会变成一句语焉不详的 500 而不是清晰的 400。 */
export function pickProvider(env, requested) {
  const name = String(requested || env?.LLM_PROVIDER || DEFAULT_PROVIDER).trim().toLowerCase();
  const known = Object.prototype.hasOwnProperty.call(PROVIDERS, name);
  return { name, provider: known ? PROVIDERS[name] : null };
}

/* 自检用:列出全部厂商与密钥就绪情况(绝不回传密钥本身) */
export function listProviders(env) {
  return Object.entries(PROVIDERS).map(([name, p]) => ({
    name,
    label: p.label,
    model: resolveModel(env, p, 'chat'),
    visionModel: resolveModel(env, p, 'vision'),
    keyEnv: p.keyEnv,
    keyConfigured: !!(env && env[p.keyEnv]),
    e2eVerified: !!p.e2eVerified,
    note: p.note,
  }));
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
