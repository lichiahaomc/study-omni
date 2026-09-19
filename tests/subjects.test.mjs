/**
 * 学科表一致性测试 —— 守住"前端下拉"与"服务端提示词"之间的契约。
 *
 * 为什么需要它:
 *   两边是分开维护的。前端加一个学科、却忘了在 prompts.js 的 SUBJECTS 里补一行,
 *   不会报任何错 —— 服务端会优雅降级成通用数学策略。学科特色静悄悄丢了,
 *   只有真的问一句才能发现。这个测试把这条线钉死。
 *
 * 运行:npm test
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUBJECTS, KIND_STRATEGY, STAGE_TONE } from '../functions/_lib/prompts.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HTML = fs.readFileSync(path.join(HERE, '..', 'public', 'index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, extra) => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (extra ? '   [' + extra + ']' : '')); }
};

/* ---------- 从 HTML 里抽出下拉里的所有学科 ---------- */
const options = [];
const re = /data-accent="([^"]+)"\s+data-badge="([^"]+)"\s+data-value="([^"]+)"/g;
let m;
while ((m = re.exec(HTML))) options.push({ accent: m[1], badge: m[2], value: m[3] });

/* 分组信息(用于统计与显示) */
const groups = [];
const gre = /<div class="subject-group" data-group="([^"]+)">([\s\S]*?)<\/div>\s*(?=<div class="subject-group"|<div class="subject-empty")/g;
let g;
while ((g = gre.exec(HTML))) {
  const n = (g[2].match(/class="subject-option/g) || []).length;
  groups.push({ name: g[1], count: n });
}

console.log('=== 下拉结构 ===');
console.log('  分组 ' + groups.length + ' 个:' + groups.map(x => x.name + '(' + x.count + ')').join(' / '));
console.log('  学科 ' + options.length + ' 个');

console.log('\n=== 1. 每个下拉项都有对应的提示词条目 ===');
{
  const missing = options.filter(o => !SUBJECTS[o.value]).map(o => o.value);
  ok('全部命中 SUBJECTS', missing.length === 0, '缺 ' + missing.length + ' 个: ' + missing.join(', '));
  if (missing.length) {
    missing.forEach(v => console.log('        需要在 prompts.js 补: ' + v));
  }
}

console.log('\n=== 2. 没有孤儿条目(提示词表里定义了却没挂在下拉上)===');
{
  const inUi = new Set(options.map(o => o.value));
  const orphan = Object.keys(SUBJECTS).filter(k => !inUi.has(k));
  ok('无孤儿条目', orphan.length === 0, orphan.join(', '));
}

console.log('\n=== 3. 每个学科的策略/语气都真实存在 ===');
{
  const badKind = Object.entries(SUBJECTS)
    .filter(([, v]) => !KIND_STRATEGY[v.kind]).map(([k, v]) => k + ' -> ' + v.kind);
  ok('kind 都有对应策略', badKind.length === 0, badKind.join(', '));

  const stages = [...new Set(Object.keys(SUBJECTS).map(k => k.split('·')[1]?.trim()))];
  const badStage = stages.filter(s => !STAGE_TONE[s]);
  ok('学段都有对应语气', badStage.length === 0, '缺: ' + badStage.join(', ') + ' | 现有学段: ' + stages.join('/'));
}

console.log('\n=== 4. 每个学科都有实质的 focus ===');
{
  const weak = Object.entries(SUBJECTS)
    .filter(([, v]) => !v.focus || v.focus.length < 10).map(([k]) => k);
  ok('focus 都不为空且够具体(≥10 字)', weak.length === 0, weak.join(', '));
}

console.log('\n=== 5. 无重复 / 无格式错误 ===');
{
  const vals = options.map(o => o.value);
  const dup = vals.filter((v, i) => vals.indexOf(v) !== i);
  ok('data-value 不重复', dup.length === 0, dup.join(', '));

  const badFormat = vals.filter(v => !/^.+ · .+$/.test(v));
  ok('value 都是"学科 · 学段"格式', badFormat.length === 0, badFormat.join(', '));

  const badBadge = options.filter(o => !o.badge || [...o.badge].length > 2).map(o => o.value);
  ok('徽章 1~2 个字符', badBadge.length === 0, badBadge.join(', '));

  const accents = [...new Set(options.map(o => o.accent))];
  const missingCss = accents.filter(a => !HTML.includes('[data-accent="' + a + '"]'));
  ok('每个 accent 都有 CSS 颜色', missingCss.length === 0,
    '缺: ' + missingCss.join(', ') + ' | 用到 ' + accents.length + ' 种');
}

console.log('\n=== 6. 编程类学科足够丰富(本次扩充的重点)===');
{
  const code = options.filter(o => /· 进阶$/.test(o.value)).map(o => o.value);
  ok('进阶(编程/计算机)学科 ≥ 15 个', code.length >= 15, code.length + ' 个');
  const langs = code.filter(v => /Python|C \/ C\+\+|Java|JavaScript|Go|Rust|C#/.test(v));
  ok('覆盖 ≥ 7 种编程语言', langs.length >= 7, langs.length + ' 种: ' + langs.map(l => l.split(' ·')[0]).join('/'));
  ok('包含 Python 之外的 C/C++', code.some(v => /C \/ C\+\+/.test(v)));
  ok('包含 Java', code.some(v => /^Java/.test(v)));
  ok('包含 JS/TS', code.some(v => /^JavaScript/.test(v)));
  ok('包含 Go 与 Rust', code.some(v => /^Go/.test(v)) && code.some(v => /^Rust/.test(v)));
  ok('覆盖工程方向(前端/后端/数据库)', ['前端开发', '后端开发', '数据库'].every(x => code.some(v => v.startsWith(x))));
  ok('覆盖系统方向(OS/网络/组成/编译)', ['操作系统', '计算机网络', '计算机组成原理', '编译原理']
    .every(x => code.some(v => v.startsWith(x))));
}

console.log('\n=== 7. 默认选中项仍然有效 ===');
{
  const sel = /class="subject-option is-selected"[^>]*data-[^>]*data-value="([^"]+)"/.exec(HTML)
    || /is-selected"[\s\S]{0,200}?data-value="([^"]+)"/.exec(HTML);
  ok('存在默认选中项', !!sel, sel ? sel[1] : '没找到');
  if (sel) ok('默认项在 SUBJECTS 里有条目', !!SUBJECTS[sel[1]], sel[1]);
  ok('只有 1 个默认选中', (HTML.match(/subject-option is-selected/g) || []).length === 1);
}

console.log('\n=== 8. buildSystemPrompt:每个学科都真的生成出差异化提示词 ===');
{
  const { buildSystemPrompt } = await import('../functions/_lib/prompts.js');
  const all = Object.keys(SUBJECTS);

  const prompts = all.map(v => [v, buildSystemPrompt({ subject: v, style: 'balanced' })]);
  ok('61 个学科全部生成成功', prompts.length === all.length && prompts.every(([, p]) => p.length > 100),
     prompts.length + ' 个');

  // 每个学科自己的重点是独有的 —— 说明没有退化成"通用模板"
  const noFocus = prompts.filter(([v, p]) => !p.includes(SUBJECTS[v].focus.slice(0, 12)));
  ok('每个 prompt 都带本学科的重点', noFocus.length === 0, noFocus.map(x => x[0]).join(', '));

  // 不同 kind 的策略文案必须不同
  const byKind = {};
  all.forEach(v => { byKind[SUBJECTS[v].kind] = buildSystemPrompt({ subject: v, style: 'balanced' }); });
  const kindCount = Object.keys(KIND_STRATEGY).length;
  ok('策略文案按 kind 区分(' + kindCount + ' 种)', new Set(Object.values(byKind)).size === kindCount,
     new Set(Object.values(byKind)).size + ' 种不同');

  // 同一学科在不同风格下必须不同
  const a = buildSystemPrompt({ subject: 'Rust · 进阶', style: 'concise' });
  const b = buildSystemPrompt({ subject: 'Rust · 进阶', style: 'socratic' });
  ok('不同回答风格产生不同 prompt', a !== b);

  // 学段语气要进 prompt
  const rust = buildSystemPrompt({ subject: 'Rust · 进阶', style: 'balanced' });
  ok('进阶学科用"进阶"语气', rust.includes('编程 / 技术基础') && rust.includes('复杂度'), rust.slice(0, 60));
  ok('进阶学科不写成"高中生"', !rust.includes('高中生'));

  // 通识学段(以前会掉到"高中"语气)
  const art = buildSystemPrompt({ subject: '音乐 · 通识', style: 'balanced' });
  ok('通识学科有专门的语气', art.includes('兴趣了解'), art.slice(0, 60));
  ok('通识学科不写成"高中生"', !art.includes('高中生'));

  // 编程类学科要带上该语言的易错点提醒
  const cpp = buildSystemPrompt({ subject: 'C / C++ · 进阶', style: 'balanced' });
  ok('C/C++ prompt 提到内存/未定义行为', /内存|未定义行为/.test(cpp));
  const go = buildSystemPrompt({ subject: 'Go · 进阶', style: 'balanced' });
  ok('Go prompt 提到 goroutine/channel', /goroutine|channel/.test(go));
  const rs = buildSystemPrompt({ subject: 'Rust · 进阶', style: 'balanced' });
  ok('Rust prompt 提到所有权/借用', /所有权|借用/.test(rs));

  // 未命中时优雅降级,而不是抛错
  let threw = false;
  let out = '';
  try { out = buildSystemPrompt({ subject: '不存在的学科 · 高中', style: 'balanced' }); }
  catch (e) { threw = true; }
  ok('未知学科不抛错', !threw);
  ok('未知学科仍产出可用 prompt', out.length > 80 && out.includes('不存在的学科'), out.slice(0, 60));

  let threw2 = false;
  try { buildSystemPrompt({ subject: '', style: '' }); buildSystemPrompt({}); } catch (e) { threw2 = true; }
  ok('空/缺参数不抛错', !threw2);

  // 只给学科名(不带学段)也应命中 —— 走的是跨学段按名查找那条降级路径
  const bare = buildSystemPrompt({ subject: 'Python', style: 'balanced' });
  ok('只给学科名也能命中', bare.includes('Python 3'), bare.slice(0, 70));
  const bareMath = buildSystemPrompt({ subject: '离散数学', style: 'balanced' });
  ok('只给"离散数学"也能命中', bareMath.includes('图论'), bareMath.slice(0, 70));
  const bareUnknown = buildSystemPrompt({ subject: '量子玄学', style: 'balanced' });
  ok('真的没有的学科仍然安全降级', bareUnknown.includes('量子玄学') && bareUnknown.length > 80);
}

console.log('\n=== 9. 分组统计 ===');
groups.forEach(g => console.log('  ' + g.name.padEnd(14) + g.count + ' 个'));

console.log('\n========== ' + pass + ' PASS / ' + fail + ' FAIL ==========');
process.exit(fail ? 1 : 0);
