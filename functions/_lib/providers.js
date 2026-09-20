/**
 * 模型接入 —— 只用 DeepSeek
 *
 * 为什么不接多家:
 *   早先版本里放过 gemini / openai(境内连不上,是死配置),
 *   后来换成四家国产厂商 —— 但那些厂商没有可用密钥做端到端验证,
 *   实际上一次都没被调用过,同样属于"摆着好看"。
 *   比赛演示要的是**真能跑通**的一条路,所以收敛成一家。
 *
 *   想接别家?照下面三件事改即可,业务层不用动:
 *     1. 加一个 endpoint 常量(必须写死在这里 —— 前端不可指定,防 SSRF)
 *     2. 加密钥环境变量
 *     3. 在 TIERS 里给出模型 id
 *
 * 模型清单是**实测**出来的(2026-09-20,GET https://api.deepseek.com/models):
 *   deepseek-flash      快;而且是唯一支持识图的
 *   deepseek-v4-pro     推理更强;不支持图片
 *
 * ⚠️ 别再用 `deepseek-v4-flash`。它能跑通,但**不在官方支持列表里**
 *   (报错信息原文:"The supported API model names are deepseek-flash,
 *   deepseek-v4-pro"),属于未公开别名,随时可能消失。
 */

export const PROVIDER = {
  label: 'DeepSeek',
  endpoint: 'https://api.deepseek.com/chat/completions',
  keyEnv: 'DEEPSEEK_API_KEY',
  keyUrl: 'https://platform.deepseek.com/api_keys',
};

/* ==================== 档位 ====================
   用户界面上只暴露两个档位,各自对应一个真实存在的模型。
   默认是 fast —— 实测 deepseek-v4-pro 回答一个"3²+4²"要 16.7 秒、
   思维链烧掉 1024 tokens,当交互式答疑的默认档太慢;
   flash 同样会输出思维链(实测 40~60 tokens),但 1 秒内就有正文。 */
export const TIERS = {
  fast: {
    label: '快速',
    model: 'deepseek-flash',
    modelEnv: 'DEEPSEEK_MODEL_FAST',
    desc: '响应最快、成本最低,适合日常问答与连续追问',
    reasoning: true,
  },
  deep: {
    label: '深度',
    model: 'deepseek-v4-pro',
    modelEnv: 'DEEPSEEK_MODEL_DEEP',
    desc: '推理更强,适合数学推导与多步讲解;实测明显更慢',
    reasoning: true,
  },
};

export const DEFAULT_TIER = 'fast';

/* ==================== 识图 ====================
   图片与扫描件解析**只能**用 flash —— 实测把图片喂给 deepseek-v4-pro,
   它会一路空转到 finish_reason=length、正文一个字都不出。
   所以这一项与用户选的档位无关,由输入类型决定。 */
export const VISION_MODEL = 'deepseek-flash';
export const VISION_MODEL_ENV = 'DEEPSEEK_VISION_MODEL';

/* ==================== 模型名解析 ====================
   环境变量优先,其次用上面的默认值 —— 官方改名时改配置即可,不用改代码。
   kind: 'chat'(文字对话) | 'vision'(图片 / 扫描件解析) */
function envStr(env, key) {
  if (!key || !env) return '';
  return String(env[key] ?? '').trim();
}

export function resolveTier(name) {
  const t = String(name ?? '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(TIERS, t) ? t : DEFAULT_TIER;
}

export function resolveModel(env, kind = 'chat', tier = DEFAULT_TIER) {
  if (kind === 'vision') return envStr(env, VISION_MODEL_ENV) || VISION_MODEL;
  const t = TIERS[resolveTier(tier)];
  return envStr(env, t.modelEnv) || t.model;
}

/* ==================== token 预算 ====================
   一个很容易踩的坑:对会输出思维链的模型,max_tokens 管的是
   「思维链 + 正文」的总额,不是正文额度。

   实测(2026-09-19,deepseek-flash):
     "帮我举一反三,出几道类似题"  max_tokens=2048 → 思维链 2933 字,正文 0 字
                                  max_tokens=4096 → 思维链 6063 字,正文 0 字
                                  max_tokens=8192 → 思维链 8328 字,正文 1773 字
   finish_reason 全是 "length",正文被思维链挤没了 —— 表现就是「气泡一片空白」。

   前端的「最大回答长度」是给用户看的正文额度,所以这里必须再加一截思考预算;
   上限是上游硬限(=8192),超了会被拒,所以也不能无限加。 */
export const REASONING_BUDGET = 6144;
const UPSTREAM_CEIL = 8192;

export function resolveMaxTokens(requested, { kind = 'chat', tier = DEFAULT_TIER } = {}) {
  const base = clamp(requested, 1, 8192, 2048);
  // 现阶段两个档位都是推理模型,所以都要留思考预算。
  // 将来若加入非推理档,把那个档的 reasoning 设成 false 即可。
  const reasoning = kind === 'vision' || !!TIERS[resolveTier(tier)].reasoning;
  if (!reasoning) return base;
  return Math.min(UPSTREAM_CEIL, base + REASONING_BUDGET);
}

/* ==================== 自检输出 ====================
   给 GET /api/chat 用。只报"密钥有没有配"与"当前生效的模型名",
   绝不回传密钥本身。排查时先看它。 */
export function describeConfig(env) {
  return {
    provider: PROVIDER.label,
    keyEnv: PROVIDER.keyEnv,
    keyConfigured: !!env?.[PROVIDER.keyEnv],
    defaultTier: DEFAULT_TIER,
    tiers: Object.entries(TIERS).map(([name, t]) => ({
      name,
      label: t.label,
      desc: t.desc,
      model: resolveModel(env, 'chat', name),
      overriddenBy: envStr(env, t.modelEnv) ? t.modelEnv : null,
    })),
    visionModel: resolveModel(env, 'vision'),
    visionOverriddenBy: envStr(env, VISION_MODEL_ENV) ? VISION_MODEL_ENV : null,
  };
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
 * 发起到上游的请求。
 * 关键约束:
 *  - endpoint 只能来自本文件的常量,前端无法指定,杜绝 SSRF
 *  - 密钥只在这里出现,响应永远不回传
 */
export async function callUpstream({ apiKey, payload, endpoint = PROVIDER.endpoint }) {
  return fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });
}

/** 流式透传。no-store 必须:否则边缘可能试图缓存这个无限长的响应。
    顺带回一个 X-LLM-Model,让"前端选的档位到底映射成了哪个模型"可被外部核实
    —— 模型名不是密钥,公开无妨。 */
export function streamToClient(upstream, model) {
  const headers = {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Accel-Buffering': 'no',
    'X-LLM-Provider': PROVIDER.label,
  };
  if (model) headers['X-LLM-Model'] = String(model).replace(/[^\w.\-]/g, '');
  return new Response(upstream.body, { headers });
}

/**
 * 收集非流式响应里的文本。
 * 字段名偶有差异,这里做容错取值。
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
