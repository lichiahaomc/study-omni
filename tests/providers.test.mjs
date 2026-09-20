/**
 * 厂商适配表测试 —— 纯离线,不发真实请求。
 *
 * 守两件事:
 *   1. 表本身自洽(字段齐、端点合法、密钥变量命名规范),否则运行时才炸
 *   2. 模型名解析 / 厂商选择 的边界(尤其 pickProvider 的原型链陷阱)
 *
 * 为什么值得单独守:
 *   这张表是「配置」不是「逻辑」,写错了不会有编译错误,
 *   只会在某次真实请求时抛一句难懂的 500。端点、密钥变量名这类
 *   一旦手滑(少个 v1、变量名不一致),排查成本很高。
 */

import { readFileSync } from 'node:fs';
import { PROVIDERS, DEFAULT_PROVIDER, resolveModel, pickProvider, listProviders, resolveMaxTokens } from '../functions/_lib/providers.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
};
const eq = (name, got, want) => ok(name, got === want, { got, want });
const section = t => console.log('\n=== ' + t + ' ===');

const names = Object.keys(PROVIDERS);

/* ==================== 1. 表结构 ==================== */
section('厂商表结构');

ok('至少有一家厂商', names.length >= 1, names);
eq('默认厂商在表里', names.includes(DEFAULT_PROVIDER), true);

// 每家必填字段
const REQUIRED = ['label', 'endpoint', 'keyEnv', 'modelEnv', 'visionModelEnv',
                  'defaultModel', 'visionModel', 'note'];
for (const n of names) {
  const p = PROVIDERS[n];
  const missing = REQUIRED.filter(k => !p[k]);
  eq(`[${n}] 必填字段齐全`, missing.length, 0);
  if (missing.length) console.log('        缺失: ' + missing.join(', '));
}

// 密钥/模型环境变量命名规范
for (const n of names) {
  const p = PROVIDERS[n];
  ok(`[${n}] keyEnv 命名规范(${p.keyEnv})`, /^[A-Z][A-Z0-9_]*_API_KEY$/.test(p.keyEnv || ''), p.keyEnv);
  ok(`[${n}] modelEnv 命名规范(${p.modelEnv})`, /^[A-Z][A-Z0-9_]*_MODEL$/.test(p.modelEnv || ''), p.modelEnv);
  ok(`[${n}] visionModelEnv 命名规范(${p.visionModelEnv})`, /^[A-Z][A-Z0-9_]*_VISION_MODEL$/.test(p.visionModelEnv || ''), p.visionModelEnv);
}

// 密钥变量不能互相撞(撞了就会出现"配了 A 结果 B 也能用"的诡异现象)
const keyEnvs = names.map(n => PROVIDERS[n].keyEnv);
ok('各家的 keyEnv 互不相同', new Set(keyEnvs).size === keyEnvs.length, keyEnvs);
const modelEnvs = names.map(n => PROVIDERS[n].modelEnv);
ok('各家的 modelEnv 互不相同', new Set(modelEnvs).size === modelEnvs.length, modelEnvs);

/* ==================== 2. 端点合法性 ==================== */
section('端点(防 SSRF 的关键)');

for (const n of names) {
  const p = PROVIDERS[n];
  let u = null;
  try { u = new URL(p.endpoint); } catch {}
  ok(`[${n}] 是合法 URL`, !!u, p.endpoint);
  if (!u) continue;
  eq(`[${n}] 必须 https`, u.protocol, 'https:');
  ok(`[${n}] 路径以 /chat/completions 结尾`, u.pathname.endsWith('/chat/completions'), u.pathname);
  ok(`[${n}] 不带查询串/锚点`, !u.search && !u.hash, p.endpoint);
  ok(`[${n}] 用默认端口`, u.port === '' || u.port === '443', u.port);
  ok(`[${n}] 主机名不是 IP(避免绕过域名校验)`, /[a-z]/i.test(u.hostname) && !/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname), u.hostname);
}

/* ==================== 端点不可被外部改写 ====================
   这是防 SSRF 的真正防线:端点只能来自常量表。
   光看表本身证明不了什么,得看 API 层有没有别的入口 ——
   所以这里直接读源码断言。 */
section('端点不可被环境变量 / 请求体改写(SSRF 防线)');

const srcRoot = new URL('../functions/', import.meta.url);
const API_FILES = ['api/chat.js', 'api/parse.js'];
const sources = {};
for (const f of ['_lib/providers.js', ...API_FILES]) {
  try { sources[f] = readFileSync(new URL(f, srcRoot), 'utf8'); }
  catch (e) { sources[f] = ''; }
}

for (const f of API_FILES) {
  ok(`${f} 读到源码`, sources[f].length > 0, f);
  ok(`${f} 不读环境变量里的端点`,
     !/env\s*[.[]\s*['"]?\w*ENDPOINT/i.test(sources[f]));
  ok(`${f} 不读请求体里的端点`,
     !/payload\s*[.[]\s*['"]?\w*endpoint/i.test(sources[f]));
  ok(`${f} 不自己直连外部地址(必须经 callUpstream)`,
     !/fetch\s*\(\s*['"`]https?:/.test(sources[f]));
}

// 表里每家的 endpoint 都必须是字面量
eq('endpoint 全部是源码里的字面量',
   (sources['_lib/providers.js'].match(/endpoint:\s*'https:\/\//g) || []).length, names.length);
ok('callUpstream 只用 provider.endpoint',
   /fetch\(provider\.endpoint/.test(sources['_lib/providers.js']));

/* ==================== 模型名也不由客户端决定 ====================
   文件开头写着"模型名全部由服务端决定",但代码里曾留过
   `payload.model || provider.defaultModel` —— 注释与实现自相矛盾。
   客户端只要能猜到厂商的模型名就能绕过我们选定的默认型号,
   所以这里守住:API 层不得直接采纳请求体里的 model。 */
section('模型名不由客户端指定');

// 断言要看**代码**,不能看注释 —— 上面那段解释"为什么不再读 payload.model"
// 的注释本身就会被正则命中(踩过一次)。
const stripComments = s => s
  .replace(/\/\*[\s\S]*?\*\//g, '')   // 块注释
  .replace(/^[ \t]*\/\/.*$/gm, '');   // 行注释(不碰字符串里的 https:// )

for (const f of API_FILES) {
  const code = stripComments(sources[f]);
  ok(`${f} 不直接采纳 payload.model`,
     !/payload\s*\.\s*model\b/.test(code),
     (code.match(/payload\s*\.\s*model\b/g) || []));
}
ok('chat.js 用 resolveModel 取对话模型', /resolveModel\(env,\s*provider,\s*'chat'\)/.test(sources['api/chat.js']));
ok('parse.js 用 resolveModel 取视觉模型', /resolveModel\(env,\s*provider,\s*'vision'\)/.test(sources['api/parse.js']));
ok('parse.js 不再直接用 provider.visionModel 当模型名',
   !/model:\s*provider\.visionModel/.test(stripComments(sources['api/parse.js'])));

// 反向确认:如果把 payload.model 加回去,这条断言必须失败(自检断言有效性)
ok('断言本身有效(能识别出被加回的写法)',
   /payload\s*\.\s*model\b/.test(stripComments("const x = payload.model || 'a';")));

/* ==================== 3. 国内可直连 ==================== */
section('部署环境可达性');

// 本项目面向国内部署。这两家在境内直连不通,留着就是死配置。
const OVERSEAS = ['api.openai.com', 'generativelanguage.googleapis.com'];
for (const n of names) {
  const host = new URL(PROVIDERS[n].endpoint).hostname;
  ok(`[${n}] 主机不在境外不可达名单里(${host})`, !OVERSEAS.includes(host), host);
}
ok('表里没有 gemini / openai 这两家',
   !names.includes('gemini') && !names.includes('openai'),
   names);

/* ==================== 4. resolveModel ==================== */
section('模型名解析(环境变量优先)');

const ds = PROVIDERS.deepseek;
eq('无 env 时用默认模型', resolveModel(undefined, ds, 'chat'), ds.defaultModel);
eq('无 env 时用默认视觉模型', resolveModel(undefined, ds, 'vision'), ds.visionModel);
eq('默认 kind 是 chat', resolveModel(undefined, ds), ds.defaultModel);

eq('env 能覆盖 chat 模型', resolveModel({ [ds.modelEnv]: 'my-model' }, ds, 'chat'), 'my-model');
eq('env 能覆盖 vision 模型', resolveModel({ [ds.visionModelEnv]: 'my-vl' }, ds, 'vision'), 'my-vl');
eq('覆盖 chat 不影响 vision', resolveModel({ [ds.modelEnv]: 'only-chat' }, ds, 'vision'), ds.visionModel);
eq('覆盖 vision 不影响 chat', resolveModel({ [ds.visionModelEnv]: 'only-vl' }, ds, 'chat'), ds.defaultModel);

eq('空串覆盖视为未设置', resolveModel({ [ds.modelEnv]: '' }, ds, 'chat'), ds.defaultModel);
eq('纯空白覆盖视为未设置', resolveModel({ [ds.modelEnv]: '   ' }, ds, 'chat'), ds.defaultModel);
eq('覆盖值两侧空白被裁掉', resolveModel({ [ds.modelEnv]: '  m  ' }, ds, 'chat'), 'm');

eq('provider 为 null 返回空串', resolveModel({}, null, 'chat'), '');
eq('未定义的 env 键被忽略', resolveModel({ SOMETHING_ELSE: 'x' }, ds, 'vision'), ds.visionModel);

/* ==================== 5. pickProvider ==================== */
section('厂商选择');

eq('默认落 deepseek', pickProvider({}, null).name, DEFAULT_PROVIDER);
eq('env 可切厂商', pickProvider({ LLM_PROVIDER: 'qwen' }, null).name, 'qwen');
eq('请求指定优先于 env', pickProvider({ LLM_PROVIDER: 'qwen' }, 'zhipu').name, 'zhipu');
eq('大小写不敏感', pickProvider({}, 'QWEN').name, 'qwen');
eq('两侧空白被裁掉', pickProvider({}, '  qwen  ').name, 'qwen');
eq('未知厂商 provider 为 null', pickProvider({}, 'nope').provider, null);
eq('未知厂商仍回显名字(便于报错)', pickProvider({}, 'nope').name, 'nope');

// 原型链上的键不能被当成合法厂商 —— name 来自客户端
for (const bad of ['constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf']) {
  eq(`原型链键 "${bad}" 不被认作厂商`, pickProvider({}, bad).provider, null);
}
eq('未配置 LLM_PROVIDER 时不被原型链污染', pickProvider({ LLM_PROVIDER: 'constructor' }, null).provider, null);

/* ==================== 6. 模型名不撞车 ==================== */
section('模型名');

for (const n of names) {
  const p = PROVIDERS[n];
  ok(`[${n}] 模型名非空且无空格`, /\S/.test(p.defaultModel) && !/\s/.test(p.defaultModel), p.defaultModel);
  ok(`[${n}] 视觉模型名非空且无空格`, /\S/.test(p.visionModel) && !/\s/.test(p.visionModel), p.visionModel);
}

// 一家厂商的 chat 与 vision 用同一个模型是合理的(比如 DeepSeek 那种通用模型),
// 但**不同厂商之间**撞名多半是抄错了 —— 那意味着某家会拿到别家的模型名
const owner = new Map();
const crossDup = [];
for (const n of names) {
  for (const m of [PROVIDERS[n].defaultModel, PROVIDERS[n].visionModel]) {
    if (owner.has(m) && owner.get(m) !== n) crossDup.push(m + ': ' + owner.get(m) + ' ↔ ' + n);
    else owner.set(m, n);
  }
}
ok('同一个模型名不会挂到两家厂商上', crossDup.length === 0, crossDup);

// 每家至少要能在自检里一眼看出"配哪个环境变量换模型"
for (const n of names) {
  ok(`[${n}] modelEnv 与 visionModelEnv 不是同一个键`,
     PROVIDERS[n].modelEnv !== PROVIDERS[n].visionModelEnv, [PROVIDERS[n].modelEnv, PROVIDERS[n].visionModelEnv]);
}

/* ==================== 7. listProviders ==================== */
section('自检输出');

const lp = listProviders({ DEEPSEEK_API_KEY: 'sk-test' });
eq('列出全部厂商', lp.length, names.length);
eq('每项都带 name', lp.every(x => !!x.name), true);
ok('deepseek 标记为已配置', lp.find(x => x.name === 'deepseek').keyConfigured === true, lp.find(x => x.name === 'deepseek'));
ok('其余标记为未配置', lp.filter(x => x.name !== 'deepseek').every(x => x.keyConfigured === false), lp);
ok('绝不回传密钥本身', JSON.stringify(lp).indexOf('sk-test') === -1, 'leaked!');
ok('每项都带 keyEnv 便于照着配', lp.every(x => /_API_KEY$/.test(x.keyEnv)), lp.map(x => x.keyEnv));
ok('每项都带可用模型名', lp.every(x => !!x.model && !!x.visionModel), lp);
ok('区分是否端到端实测过', lp.every(x => typeof x.e2eVerified === 'boolean'), lp.map(x => x.e2eVerified));
eq('deepseek 标记为已实测', lp.find(x => x.name === 'deepseek').e2eVerified, true);

// 环境变量覆盖要反映到自检里,否则排查时看到的是假的
const lp2 = listProviders({ DEEPSEEK_API_KEY: 'k', DEEPSEEK_MODEL: 'overridden' });
eq('自检反映模型覆盖', lp2.find(x => x.name === 'deepseek').model, 'overridden');
eq('自检的视觉模型不受 chat 覆盖影响',
   lp2.find(x => x.name === 'deepseek').visionModel, PROVIDERS.deepseek.visionModel);

/* ==================== 8. resolveMaxTokens 回归 ==================== */
section('token 预算(不能被这次改动带坏)');

eq('推理模型加思考预算', resolveMaxTokens(2048, ds), 2048 + 6144);
eq('推理模型夹到上游硬限 8192', resolveMaxTokens(8192, ds), 8192);
eq('非推理模型不加预算', resolveMaxTokens(2048, { reasoning: false }), 2048);
eq('非推理模型夹到 8192', resolveMaxTokens(99999, { reasoning: false }), 8192);
eq('非法输入回落 2048', resolveMaxTokens(undefined, { reasoning: false }), 2048);
eq('maxOutput 能压低下限', resolveMaxTokens(8192, { reasoning: true, maxOutput: 4096 }), 4096);
eq('provider 为 null 时给基础额度', resolveMaxTokens(1024, null), 1024);

// 表里每家都应按同一套规则工作
for (const n of names) {
  const got = resolveMaxTokens(1024, PROVIDERS[n]);
  const want = PROVIDERS[n].reasoning ? 1024 + 6144 : 1024;
  eq(`[${n}] 预算按 reasoning 标记计算`, got, want);
}

console.log('\n========== ' + (pass + fail) + ' 项:' + pass + ' PASS / ' + fail + ' FAIL ==========');
process.exit(fail ? 1 : 0);
