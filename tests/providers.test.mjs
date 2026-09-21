/**
 * 模型配置测试 —— 纯离线,不发真实请求。
 *
 * 守三件事:
 *   1. 档位表自洽(档位名、模型名、环境变量命名),写错了不会有编译错误
 *   2. 模型名解析的边界(env 覆盖优先、非法档位回退、原型链陷阱)
 *   3. **防 SSRF**:端点是常量,API 层不得从 env / 请求体取,也不得绕过
 *      callUpstream 自己 fetch;模型名同理不得采纳客户端指定
 *
 * 这些是"配置"不是"逻辑",错了只会在某次真实请求时抛一句难懂的 500。
 */

import { readFileSync } from 'node:fs';
import {
  PROVIDER, TIERS, DEFAULT_TIER, VISION_MODEL, VISION_MODEL_ENV,
  resolveTier, resolveModel, resolveMaxTokens, describeConfig, REASONING_BUDGET,
  resolveUserKey, resolveUserEndpoint,
} from '../functions/_lib/providers.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
};
const eq = (name, got, want) => ok(name, got === want, { got, want });
const section = t => console.log('\n=== ' + t + ' ===');

const tierNames = Object.keys(TIERS);

/* ==================== 1. 结构 ==================== */
section('配置结构');

ok('PROVIDER 必填字段齐全', ['label', 'endpoint', 'keyEnv'].every(k => PROVIDER[k]),
   Object.keys(PROVIDER));
ok('keyEnv 命名规范', /^[A-Z][A-Z0-9_]*_API_KEY$/.test(PROVIDER.keyEnv), PROVIDER.keyEnv);
ok('至少一个档位', tierNames.length >= 1, tierNames);
ok('默认档位在表里', tierNames.includes(DEFAULT_TIER), DEFAULT_TIER);
ok('档位名是短英文(会进 localStorage 与请求体)', tierNames.every(t => /^[a-z][a-z0-9_]*$/.test(t)), tierNames);

for (const t of tierNames) {
  const d = TIERS[t];
  ok(`[${t}] 有 label / model / desc`, !!(d.label && d.model && d.desc), Object.keys(d));
  ok(`[${t}] 模型名非空且无空格`, /\S/.test(d.model) && !/\s/.test(d.model), d.model);
  ok(`[${t}] modelEnv 命名规范(${d.modelEnv})`, /^[A-Z][A-Z0-9_]*_MODEL_[A-Z]+$/.test(d.modelEnv || ''), d.modelEnv);
}

const envKeys = tierNames.map(t => TIERS[t].modelEnv).concat(VISION_MODEL_ENV);
ok('各档 modelEnv 互不相同', new Set(envKeys).size === envKeys.length, envKeys);

/* ==================== 2. 模型名不能是未公开别名 ====================
   实测:官方 /models 只返回 deepseek-flash 与 deepseek-v4-pro。
   `deepseek-v4-flash` 能跑通但不在支持列表里(属未公开别名),别用。 */
section('模型名必须是官方支持名');

const OFFICIAL = ['deepseek-flash', 'deepseek-v4-pro'];
for (const t of tierNames) {
  ok(`[${t}] 模型名在官方支持列表内(${TIERS[t].model})`, OFFICIAL.includes(TIERS[t].model), TIERS[t].model);
}
ok(`识图模型在官方支持列表内(${VISION_MODEL})`, OFFICIAL.includes(VISION_MODEL), VISION_MODEL);
ok('没有使用未公开别名 deepseek-v4-flash',
   ![VISION_MODEL, ...tierNames.map(t => TIERS[t].model)].includes('deepseek-v4-flash'));

/* ==================== 3. 端点 ==================== */
section('端点(防 SSRF)');

let u = null;
try { u = new URL(PROVIDER.endpoint); } catch {}
ok('是合法 URL', !!u, PROVIDER.endpoint);
if (u) {
  eq('必须 https', u.protocol, 'https:');
  ok('路径以 /chat/completions 结尾', u.pathname.endsWith('/chat/completions'), u.pathname);
  ok('不带查询串/锚点', !u.search && !u.hash, PROVIDER.endpoint);
  ok('主机名不是 IP', !/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname), u.hostname);
}

/* ==================== 4. 源码级断言 ==================== */
section('端点是常量,模型名不由客户端指定');

const srcRoot = new URL('../functions/', import.meta.url);
const API_FILES = ['api/chat.js', 'api/parse.js'];
const sources = {};
for (const f of ['_lib/providers.js', ...API_FILES]) {
  try { sources[f] = readFileSync(new URL(f, srcRoot), 'utf8'); }
  catch { sources[f] = ''; }
}
// 断言必须看代码、不看注释 —— 解释"为什么不这样做"的注释自己会被正则命中
const stripComments = s => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '');

for (const f of API_FILES) {
  const code = stripComments(sources[f]);
  ok(`${f} 读到源码`, sources[f].length > 0, f);
  ok(`${f} 不读环境变量里的端点`, !/env\s*[.[]\s*['"]?\w*ENDPOINT/i.test(code));
  ok(`${f} 不读请求体里的端点`, !/payload\s*[.[]\s*['"]?\w*endpoint/i.test(code));
  ok(`${f} 不自己直连外部地址(必须走 callUpstream)`, !/fetch\s*\(\s*['"`]https?:/.test(code));
  ok(`${f} 不直接采纳 payload.model`, !/payload\s*\.\s*model\b/.test(code),
     (code.match(/payload\s*\.\s*model\b/g) || []));
}
ok('endpoint 以字面量写在 providers.js 里', /endpoint:\s*'https:\/\//.test(sources['_lib/providers.js']));
ok('callUpstream 默认只用 PROVIDER.endpoint', /endpoint = PROVIDER\.endpoint/.test(sources['_lib/providers.js']));
ok('chat.js 用 resolveModel 取对话模型', /resolveModel\(env,\s*'chat'/.test(sources['api/chat.js']));
ok('parse.js 用 resolveModel 取识图模型', /resolveModel\(env,\s*'vision'/.test(sources['api/parse.js']));
// 自检断言有效性
ok('上述断言本身有效(能识别被加回的写法)',
   /payload\s*\.\s*model\b/.test(stripComments("const x = payload.model || 'a';")));

/* ==================== 5. resolveTier ==================== */
section('档位解析');

eq('默认回落到 DEFAULT_TIER', resolveTier(undefined), DEFAULT_TIER);
eq('空串回落到默认', resolveTier(''), DEFAULT_TIER);
eq('纯空白回落到默认', resolveTier('   '), DEFAULT_TIER);
eq('合法档位原样返回', resolveTier(DEFAULT_TIER), DEFAULT_TIER);
eq('大小写不敏感', resolveTier(DEFAULT_TIER.toUpperCase()), DEFAULT_TIER);
eq('两侧空白被裁掉', resolveTier('  ' + DEFAULT_TIER + '  '), DEFAULT_TIER);
eq('未知档位回落', resolveTier('nope'), DEFAULT_TIER);
// 原型链上的键不能被当成合法档位(档位名来自客户端)
for (const bad of ['constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf']) {
  eq(`原型链键 "${bad}" 落到默认档`, resolveTier(bad), DEFAULT_TIER);
}
// 已废弃的旧档位名也必须落到默认(用户 localStorage 里可能还存着)
for (const old of ['omni-pro', 'omni-flash', 'omni-vision']) {
  eq(`已废弃档位 "${old}" 落到默认档`, resolveTier(old), DEFAULT_TIER);
}

/* ==================== 6. resolveModel ==================== */
section('模型名解析');

for (const t of tierNames) {
  eq(`[${t}] 无 env 时用默认模型`, resolveModel(undefined, 'chat', t), TIERS[t].model);
  eq(`[${t}] env 可覆盖`, resolveModel({ [TIERS[t].modelEnv]: 'my-model' }, 'chat', t), 'my-model');
  eq(`[${t}] 空串覆盖视为未设置`, resolveModel({ [TIERS[t].modelEnv]: '' }, 'chat', t), TIERS[t].model);
  eq(`[${t}] 纯空白覆盖视为未设置`, resolveModel({ [TIERS[t].modelEnv]: '   ' }, 'chat', t), TIERS[t].model);
  eq(`[${t}] 覆盖值两侧空白被裁掉`, resolveModel({ [TIERS[t].modelEnv]: '  m  ' }, 'chat', t), 'm');
}
// 一个档位的覆盖不能影响另一个档位
if (tierNames.length >= 2) {
  const [a, b] = tierNames;
  const env = { [TIERS[a].modelEnv]: 'only-a' };
  eq(`[${a}] 覆盖后生效`, resolveModel(env, 'chat', a), 'only-a');
  eq(`[${b}] 不受 ${a} 的覆盖影响`, resolveModel(env, 'chat', b), TIERS[b].model);
}

eq('识图用自己的模型', resolveModel(undefined, 'vision'), VISION_MODEL);
eq('识图可被 env 覆盖', resolveModel({ [VISION_MODEL_ENV]: 'my-vl' }, 'vision'), 'my-vl');
eq('识图不受档位影响(不同档位结果相同)',
   new Set(tierNames.map(t => resolveModel(undefined, 'vision', t))).size, 1);
for (const t of tierNames) {
  eq(`识图忽略 ${t} 的 chat 覆盖`, resolveModel({ [TIERS[t].modelEnv]: 'chat-only' }, 'vision', t), VISION_MODEL);
}
eq('kind 默认是 chat', resolveModel(undefined, undefined, DEFAULT_TIER), TIERS[DEFAULT_TIER].model);
eq('非法档位回落到默认档的模型', resolveModel(undefined, 'chat', 'nope'), TIERS[DEFAULT_TIER].model);

/* ==================== 7. token 预算 ==================== */
section('token 预算(不能被这次改动带坏)');

eq('推理档加思考预算', resolveMaxTokens(2048, { tier: DEFAULT_TIER }), 2048 + REASONING_BUDGET);
eq('夹到上游硬限 8192', resolveMaxTokens(8192, { tier: DEFAULT_TIER }), 8192);
eq('识图也加思考预算', resolveMaxTokens(512, { kind: 'vision' }), 512 + REASONING_BUDGET);
eq('识图夹到 8192', resolveMaxTokens(8192, { kind: 'vision' }), 8192);
eq('非法输入回落 2048 再加预算', resolveMaxTokens(undefined, {}), 2048 + REASONING_BUDGET);
eq('负数被夹到 1', resolveMaxTokens(-100, {}), 1 + REASONING_BUDGET);
eq('不传参数也能算', resolveMaxTokens(1024), 1024 + REASONING_BUDGET);
for (const t of tierNames) {
  const want = TIERS[t].reasoning ? 1024 + REASONING_BUDGET : 1024;
  eq(`[${t}] 预算按 reasoning 标记计算`, resolveMaxTokens(1024, { tier: t }), want);
}

/* ==================== 8. describeConfig ==================== */
section('自检输出');

const c = describeConfig({ [PROVIDER.keyEnv]: 'sk-test' });
eq('provider 是 label', c.provider, PROVIDER.label);
eq('keyConfigured 为 true', c.keyConfigured, true);
eq('未配时报 false', describeConfig({}).keyConfigured, false);
eq('空的 env 不报错', describeConfig(undefined).keyConfigured, false);
ok('列出全部档位', c.tiers.length === tierNames.length, c.tiers.map(x => x.name));
ok('每档都有 label / desc / model', c.tiers.every(x => x.label && x.desc && x.model), c.tiers);
ok('默认档标记正确', c.defaultTier === DEFAULT_TIER, c.defaultTier);
ok('暴露识图模型', !!c.visionModel, c.visionModel);
ok('绝不回传密钥本身', !JSON.stringify(c).includes('sk-test'), 'leaked');
ok('未覆盖时 overriddenBy 为 null', c.tiers.every(x => x.overriddenBy === null), c.tiers);

const c2 = describeConfig({ [PROVIDER.keyEnv]: 'k', [TIERS[DEFAULT_TIER].modelEnv]: 'custom' });
eq('自检反映模型覆盖',
   c2.tiers.find(x => x.name === DEFAULT_TIER).model, 'custom');
eq('自检标出被哪个变量覆盖',
   c2.tiers.find(x => x.name === DEFAULT_TIER).overriddenBy, TIERS[DEFAULT_TIER].modelEnv);

/* ==================== 5. 用户自带 API(BYOK) ==================== */
section('自定义 API:密钥校验');

ok('正常密钥放行', resolveUserKey('sk-abcdef1234567890') === 'sk-abcdef1234567890');
ok('去掉首尾空白', resolveUserKey('  sk-abcdef1234567890  ') === 'sk-abcdef1234567890');
ok('太短拒绝', resolveUserKey('sk-1') === '');
ok('空值拒绝', resolveUserKey('') === '' && resolveUserKey(null) === '' && resolveUserKey(undefined) === '');
ok('超长拒绝', resolveUserKey('a'.repeat(201)) === '');
// 密钥会被塞进 Authorization 头,含空白/换行/引号的形态一律不放行 ——
// 否则等于给了注入自定义头的能力
ok('含空格拒绝', resolveUserKey('sk-abc def123456') === '');
ok('含换行拒绝', resolveUserKey('sk-abc\n1234567890') === '');
ok('含冒号/引号拒绝', resolveUserKey('sk-abc:1234567') === '' && resolveUserKey('sk-"1234567') === '');

section('自定义 API:地址管束(这里被绕过 = Worker 变 SSRF 跳板)');

const deny = [
  ['http 明文', 'http://api.example.com/chat/completions'],
  ['localhost', 'https://localhost/chat/completions'],
  ['子域 .localhost', 'https://a.localhost/chat/completions'],
  ['.local', 'https://box.local/chat/completions'],
  ['.internal', 'https://meta.internal/chat/completions'],
  ['回环 IPv4', 'https://127.0.0.1/chat/completions'],
  ['私网 10/8', 'https://10.1.2.3/chat/completions'],
  ['私网 192.168/16', 'https://192.168.1.1/chat/completions'],
  ['私网 172.16/12', 'https://172.20.0.9/chat/completions'],
  ['云元数据 169.254', 'https://169.254.169.254/latest/meta-data'],
  ['CGNAT 100.64', 'https://100.64.0.1/chat/completions'],
  ['保留段 240/4', 'https://240.0.0.1/chat/completions'],
  ['IPv6 回环', 'https://[::1]/chat/completions'],
  ['带账号密码', 'https://u:p@api.example.com/chat/completions'],
  ['带查询串', 'https://api.example.com/c?x=1'],
  ['带锚点', 'https://api.example.com/c#x'],
  ['不是 URL', 'api.example.com'],
  ['空值', ''],
  ['超长', 'https://api.example.com/' + 'a'.repeat(200)],
];
deny.forEach(([why, v]) => {
  ok('拒绝:' + why, resolveUserEndpoint(v) === '', resolveUserEndpoint(v));
});

ok('放行正常的公共 https 地址',
   resolveUserEndpoint('https://api.deepseek.com/chat/completions')
   === 'https://api.deepseek.com/chat/completions');
ok('放行自建网关(带路径)',
   resolveUserEndpoint('https://gateway.mycorp.cn/v1/chat/completions')
   === 'https://gateway.mycorp.cn/v1/chat/completions');
ok('放行公网 IP', resolveUserEndpoint('https://8.8.8.8/chat/completions')
   === 'https://8.8.8.8/chat/completions');
ok('去掉首尾空白', resolveUserEndpoint('  https://a.com/c  ') === 'https://a.com/c');

section('自定义 API:接入方式');

const chatSrc = sources['api/chat.js'];
const parseSrc = sources['api/parse.js'];
['api/chat.js', 'api/parse.js'].forEach(f => {
  const code = stripComments(sources[f]);
  // 只从请求头取,不从 payload —— 上面那条"不读请求体里的端点"断言仍然成立
  ok(`${f} 从请求头读自定义密钥`, /headers\.get\(\s*'X-Studyomni-Key'\s*\)/.test(code));
  ok(`${f} 从请求头读自定义地址`, /headers\.get\(\s*'X-Studyomni-Base'\s*\)/.test(code));
  // 两者都必须过校验才用,不能直接把头里的值传下去
  ok(`${f} 密钥过了 resolveUserKey`, /resolveUserKey\(/.test(code));
  ok(`${f} 地址过了 resolveUserEndpoint`, /resolveUserEndpoint\(/.test(code));
});
ok('chat.js 用户没填就回落到服务端密钥', /userKey\s*\|\|\s*env\[PROVIDER\.keyEnv\]/.test(chatSrc));
ok('parse.js 同样回落', /userKey\s*\|\|\s*env\[PROVIDER\.keyEnv\]/.test(parseSrc));
ok('端点默认值没有被改掉',
   /endpoint = PROVIDER\.endpoint/.test(sources['_lib/providers.js']));

console.log('\n========== ' + (pass + fail) + ' 项:' + pass + ' PASS / ' + fail + ' FAIL ==========');
process.exit(fail ? 1 : 0);
