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
 *     1. 加一个 endpoint 常量(默认端点写死在这里。客户端只有 BYOK 那一条
 *        受管束的路径能覆盖它 —— 见 resolveUserEndpoint,私网/回环一律拒绝)
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
 *  - endpoint 默认只能来自本文件的常量;客户端**唯一**能影响它的路径是
 *    chat.js 里那个 `X-Studyomni-Base` 头,而且必须先过 resolveUserEndpoint()
 *    的管束(见下)。没有校验过的地址绝不进来。
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

/* ==================== 用户自带 API(BYOK) ====================
   允许用户在设置里填自己的密钥(可选再加一个自己的 API 地址)。
   两点设计取舍:

   1. **密钥绝不进 Settings 那份 state**。设置面板有"导出设置"功能,
      一旦密钥进了 state 就会被导出成 JSON 文件。所以它单独存两个
      localStorage 键,和处理主题/字号的设置彻底分开。

   2. **地址必须过管束**。放开"客户端可指定端点"这件事本身是有风险的
      (Worker 会变成 SSRF 跳板:拿它去打内网、打云元数据地址)。
      所以这里只放行 https + 公共域名,私网/回环/链路本地/云元数据一律拒绝。
      不合法就当作没填,静默回落到服务端配置 —— 不报错,免得变成探测工具。 */

// 这些主机名本身就是"指向本机"的写法
const LOCAL_HOST = /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.home\.arpa)$/i;

function isPrivateIPv4(h) {
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const a = +m[1], b = +m[2];
  if (a === 0 || a === 10 || a === 127) return true;          // 本机 / 私网 A
  if (a === 169 && b === 254) return true;                    // 链路本地(云元数据就在这)
  if (a === 172 && b >= 16 && b <= 31) return true;           // 私网 B
  if (a === 192 && b === 168) return true;                    // 私网 C
  if (a === 100 && b >= 64 && b <= 127) return true;          // 运营商级 NAT
  if (a >= 224) return true;                                  // 组播 / 保留段
  return false;
}

/** 校验用户填的 API 地址。通过返回规范化后的 URL 串,不通过返回 ''。 */
export function resolveUserEndpoint(raw) {
  if (typeof raw !== 'string') return '';
  const s = raw.trim();
  if (!s || s.length > 200) return '';
  let u;
  try { u = new URL(s); } catch { return ''; }
  if (u.protocol !== 'https:') return '';                     // 只认 https
  if (u.username || u.password) return '';                    // 不许带凭据
  if (u.search || u.hash) return '';                          // 与内置端点保持一致的形态
  const host = u.hostname.toLowerCase();
  if (LOCAL_HOST.test(host)) return '';
  if (host.includes('[') || host.includes(':')) return '';    // IPv6 一律拒绝:规则太容易漏
  if (isPrivateIPv4(host)) return '';
  return u.toString();
}

/** 校验用户填的密钥。只放行常见的密钥字符形态,避免被塞进别的东西。 */
export function resolveUserKey(raw) {
  if (typeof raw !== 'string') return '';
  const s = raw.trim();
  if (s.length < 8 || s.length > 200) return '';
  if (!/^[A-Za-z0-9._\-]+$/.test(s)) return '';
  return s;
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
