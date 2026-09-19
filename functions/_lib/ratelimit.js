/**
 * 限流 —— 目标不是"精确计量",而是"公开 URL 别被刷爆账单"。
 *
 * 两层防线:
 *   ① 单 IP 固定窗口 —— 防一个人狂点(前端连点、脚本循环、误按回车)
 *   ② 全局每日配额   —— 兜底,防换 IP 的分布式刷量
 *
 * 为什么不接 KV / Durable Objects?
 *   那两者才能跨 isolate 精确计数,但 KV 免费额度每天只有上千次**写**,
 *   拿它给每个请求计数,还没防住别人就先把自己的额度写爆了。
 *   所以计数放在 isolate 内存里 —— 冷启动会清零、多实例之间不共享,
 *   定位是「降低伤害」而不是「硬性防御」。
 *
 *   真要硬防,去 Cloudflare 控制台的速率限制规则里配(在边缘就拦掉,
 *   请求根本进不到 Worker,也就不产生任何 token 费用)。
 *
 * 可通过环境变量覆盖(不改代码):
 *   RATE_LIMIT_PER_MIN   每 IP 每分钟上限,默认 20
 *   RATE_LIMIT_PER_DAY   全站每天上限,默认 2000
 */

const WINDOW_MS = 60_000;
const DEFAULT_IP_LIMIT = 20;
const DEFAULT_DAY_LIMIT = 2000;

const HITS = new Map();                       // "kind|ip" -> { count, resetAt }
const GLOBAL = { day: '', count: 0 };
let lastSweep = 0;

function positive(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/* Cloudflare 会把真实访客 IP 放在 CF-Connecting-IP,优先用它。
   x-forwarded-for 只在本地开发(wrangler)或自建反代时兜底。 */
export function clientIP(request) {
  const cf = request.headers.get('CF-Connecting-IP');
  if (cf) return cf;
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return 'unknown';
}

/* 顺手清理过期记录。Map 不清理会长到内存上限,所以每次放行时
   最多每分钟扫一遍 —— 比每次请求都全表扫便宜得多。 */
function sweep(now) {
  if (now - lastSweep < WINDOW_MS) return;
  lastSweep = now;
  for (const [k, v] of HITS) {
    if (now >= v.resetAt) HITS.delete(k);
  }
}

/**
 * @param {Request} request
 * @param {object} env          Pages 的 env(密钥与配置)
 * @param {string} kind         计数分桶,chat / parse 各自独立限额
 * @returns {{ok:true}|{ok:false,status:number,retryAfter:number,error:string,hint:string}}
 */
export function checkRateLimit(request, env, kind) {
  const now = Date.now();
  const ipLimit = positive(env?.RATE_LIMIT_PER_MIN, DEFAULT_IP_LIMIT);
  const dayLimit = positive(env?.RATE_LIMIT_PER_DAY, DEFAULT_DAY_LIMIT);

  /* ---- ① 全局日配额 ---- */
  const day = new Date(now).toISOString().slice(0, 10);
  if (GLOBAL.day !== day) {
    GLOBAL.day = day;
    GLOBAL.count = 0;
  }
  if (GLOBAL.count >= dayLimit) {
    return {
      ok: false,
      status: 429,
      retryAfter: 600,
      error: '今日全站调用额度已用完',
      hint: `服务端设置了每天 ${dayLimit} 次的保护上限,明天自动恢复。`
        + '（可用环境变量 RATE_LIMIT_PER_DAY 调整）',
    };
  }

  /* ---- ② 单 IP 固定窗口 ---- */
  const key = kind + '|' + clientIP(request);
  let rec = HITS.get(key);
  if (!rec || now >= rec.resetAt) {
    rec = { count: 0, resetAt: now + WINDOW_MS };
    HITS.set(key, rec);
  }
  if (rec.count >= ipLimit) {
    return {
      ok: false,
      status: 429,
      retryAfter: Math.max(1, Math.ceil((rec.resetAt - now) / 1000)),
      error: '请求过于频繁',
      hint: `每分钟最多 ${ipLimit} 次。等一会儿再问即可 —— 正常提问不会触发这个限制。`,
    };
  }

  rec.count++;
  GLOBAL.count++;
  sweep(now);
  return { ok: true };
}

/** 把限流结果变成规范的 429 响应(带 Retry-After,方便前端退避) */
export function tooManyResponse(r, extra = {}) {
  return new Response(JSON.stringify({
    error: r.error,
    hint: r.hint,
    retryAfter: r.retryAfter,
    ...extra,
  }, null, 2), {
    status: r.status || 429,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Retry-After': String(r.retryAfter || 60),
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * 同源校验。
 * 前端与 Functions 是同源部署的,所以正常页面发来的 Origin 一定等于自身 Host。
 * 别家网站把我们的 /api/chat 嵌进自己页面调用 → 这里挡掉。
 *
 * 注意:curl / 服务端脚本不带 Origin,一律放行(它们本来就是合法调用方,
 * 而且伪造 Origin 对脚本来说毫无成本 —— 所以这道校验只防"顺手蹭"）。
 * 需要额外放行时,用 ALLOWED_ORIGINS 以逗号分隔列出。
 */
export function sameOrigin(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return true;

  const allow = String(env?.ALLOWED_ORIGINS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  if (allow.includes(origin)) return true;

  const host = request.headers.get('Host');
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** 供 GET 自检接口展示当前生效的限额 */
export function currentLimits(env) {
  return {
    perMinutePerIP: positive(env?.RATE_LIMIT_PER_MIN, DEFAULT_IP_LIMIT),
    perDayGlobal: positive(env?.RATE_LIMIT_PER_DAY, DEFAULT_DAY_LIMIT),
    usedToday: GLOBAL.day === new Date().toISOString().slice(0, 10) ? GLOBAL.count : 0,
    inFlightKeys: HITS.size,
  };
}
