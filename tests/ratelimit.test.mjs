import {
  checkRateLimit, tooManyResponse, sameOrigin, clientIP, currentLimits,
} from '../functions/_lib/ratelimit.js';

let pass = 0, fail = 0;
const ok = (n, c, extra) => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (extra ? ' | ' + extra : '')); }
};

const req = (headers = {}) => new Request('https://studyomni.pages.dev/api/chat', {
  method: 'POST', headers,
});

console.log('=== clientIP ===');
ok('优先 CF-Connecting-IP', clientIP(req({ 'CF-Connecting-IP': '1.2.3.4', 'x-forwarded-for': '9.9.9.9' })) === '1.2.3.4');
ok('退回 x-forwarded-for 第一段', clientIP(req({ 'x-forwarded-for': '5.5.5.5, 6.6.6.6' })) === '5.5.5.5');
ok('都没有则 unknown', clientIP(req({})) === 'unknown');

console.log('\n=== 单 IP 窗口(每 IP 每分钟 3 次) ===');
{
  const env = { RATE_LIMIT_PER_MIN: '3', RATE_LIMIT_PER_DAY: '1000' };
  const ip = { 'CF-Connecting-IP': '10.0.0.1' };
  const r1 = checkRateLimit(req(ip), env, 'chat');
  const r2 = checkRateLimit(req(ip), env, 'chat');
  const r3 = checkRateLimit(req(ip), env, 'chat');
  const r4 = checkRateLimit(req(ip), env, 'chat');
  ok('第 1 次放行', r1.ok === true);
  ok('第 2 次放行', r2.ok === true);
  ok('第 3 次放行', r3.ok === true);
  ok('第 4 次被拦', r4.ok === false);
  ok('  状态码 429', r4.status === 429, String(r4.status));
  ok('  带 retryAfter', r4.retryAfter > 0 && r4.retryAfter <= 60, String(r4.retryAfter));
  ok('  错误信息可读', /过于频繁/.test(r4.error), r4.error);
  const resp = tooManyResponse(r4);
  ok('  响应头带 Retry-After', !!resp.headers.get('Retry-After'));
  ok('  响应体是 JSON 且含 hint', (await resp.json()).hint.length > 0);
}

console.log('\n=== 不同 IP 互不影响 ===');
{
  const env = { RATE_LIMIT_PER_MIN: '2', RATE_LIMIT_PER_DAY: '1000' };
  checkRateLimit(req({ 'CF-Connecting-IP': '20.0.0.1' }), env, 'chat');
  checkRateLimit(req({ 'CF-Connecting-IP': '20.0.0.1' }), env, 'chat');
  const other = checkRateLimit(req({ 'CF-Connecting-IP': '20.0.0.2' }), env, 'chat');
  ok('A 用满后 B 仍可调用', other.ok === true);
}

console.log('\n=== 分桶隔离:chat 与 parse 各自计数 ===');
{
  const env = { RATE_LIMIT_PER_MIN: '1', RATE_LIMIT_PER_DAY: '1000' };
  const ip = { 'CF-Connecting-IP': '30.0.0.1' };
  const c1 = checkRateLimit(req(ip), env, 'chat');
  const p1 = checkRateLimit(req(ip), env, 'parse');
  const c2 = checkRateLimit(req(ip), env, 'chat');
  ok('chat 第 1 次放行', c1.ok === true);
  ok('parse 第 1 次放行(不占 chat 额度)', p1.ok === true);
  ok('chat 第 2 次被拦', c2.ok === false);
}

console.log('\n=== 全局日配额 ===');
{
  // GLOBAL 计数是模块级的、跟着进程走,前面的用例已经消耗掉一些额度。
  // 所以这里按"当前已用 + 2"来设定上限,才是干净的两个名额。
  const used = currentLimits({}).usedToday;
  const env = { RATE_LIMIT_PER_MIN: '1000', RATE_LIMIT_PER_DAY: String(used + 2) };
  const a = checkRateLimit(req({ 'CF-Connecting-IP': '40.0.0.1' }), env, 'chat');
  const b = checkRateLimit(req({ 'CF-Connecting-IP': '40.0.0.2' }), env, 'chat');
  const c = checkRateLimit(req({ 'CF-Connecting-IP': '40.0.0.3' }), env, 'chat');
  ok('换 IP 也吃全局额度', a.ok && b.ok && !c.ok, JSON.stringify([a.ok, b.ok, c.ok]) + ' (used=' + used + ', cap=' + (used + 2) + ')');
  ok('  报的是"全站额度用完"', /全站/.test(c.error), c.error);
  ok('  额度用完后 usedToday 继续累加', currentLimits({}).usedToday === used + 2,
    String(currentLimits({}).usedToday));
}

console.log('\n=== 非法/缺失配置的兜底 ===');
{
  ok('env 为空 → 用默认值不崩', checkRateLimit(req({ 'CF-Connecting-IP': '50.0.0.1' }), {}, 'chat').ok === true);
  const bad = { RATE_LIMIT_PER_MIN: 'abc', RATE_LIMIT_PER_DAY: '0' };
  ok('非数字 → 回落默认', checkRateLimit(req({ 'CF-Connecting-IP': '50.0.0.2' }), bad, 'chat').ok === true);
  ok('负数 → 回落默认', checkRateLimit(req({ 'CF-Connecting-IP': '50.0.0.3' }), { RATE_LIMIT_PER_MIN: '-5' }, 'chat').ok === true);
}

console.log('\n=== 同源校验 ===');
{
  const H = { Host: 'studyomni.pages.dev' };
  ok('无 Origin(curl/脚本)→ 放行', sameOrigin(req(H), {}) === true);
  ok('同源 → 放行', sameOrigin(req({ ...H, Origin: 'https://studyomni.pages.dev' }), {}) === true);
  ok('跨站 → 拦下', sameOrigin(req({ ...H, Origin: 'https://evil.example.com' }), {}) === false);
  ok('跨站但被 ALLOWED_ORIGINS 放行 → 放行',
    sameOrigin(req({ ...H, Origin: 'https://evil.example.com' }), { ALLOWED_ORIGINS: 'https://evil.example.com' }) === true);
  ok('Origin 是垃圾字符串 → 拦下', sameOrigin(req({ ...H, Origin: 'not a url' }), {}) === false);
  ok('本地开发 localhost 同源 → 放行',
    sameOrigin(req({ Host: 'localhost:8788', Origin: 'http://localhost:8788' }), {}) === true);
  ok('预览域名(不同 host)→ 拦下',
    sameOrigin(req({ Host: 'abc.studyomni.pages.dev', Origin: 'https://xc9.studyomni.pages.dev' }), {}) === false);
  ok('预览域名可显式放行',
    sameOrigin(req({ Host: 'abc.studyomni.pages.dev', Origin: 'https://xc9.studyomni.pages.dev' }),
      { ALLOWED_ORIGINS: 'https://xc9.studyomni.pages.dev' }) === true);
}

console.log('\n=== currentLimits 自检输出 ===');
{
  const l = currentLimits({ RATE_LIMIT_PER_MIN: '7', RATE_LIMIT_PER_DAY: '88' });
  console.log('  ' + JSON.stringify(l));
  ok('反映自定义限额', l.perMinutePerIP === 7 && l.perDayGlobal === 88);
  ok('含当日已用量与在飞键数', typeof l.usedToday === 'number' && typeof l.inFlightKeys === 'number');
}

console.log('\n========== ' + pass + ' PASS / ' + fail + ' FAIL ==========');
process.exit(fail ? 1 : 0);
