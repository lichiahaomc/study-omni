/**
 * formatText 的渲染测试。
 *
 * 抠法:01-core.js 从 `const MATH_RE` 到文件末尾**全是纯函数**(不碰 DOM),
 * 可以直接在 Node 里求值;只差两个外部依赖 ——
 *   · escapeHtml 在 08-paste.js 里
 *   · latexPlain 在 02-math.js 里(只影响公式的纯文本兜底,这里用直通桩)
 * 这个抠法有静默失效的风险:哪天有人在 74 行之后加了碰 DOM 的代码,
 * 求值会抛错 —— 那是好事,会当场红,而不是悄悄测了个假的。
 */

import fs from 'node:fs';
import path from 'node:path';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
};
const section = t => console.log('\n=== ' + t + ' ===');

const read = f => fs.readFileSync(path.join(process.cwd(), 'public', 'js', f), 'utf8');
const coreSrc = read('01-core.js');
const pasteSrc = read('08-paste.js');

const pureFrom = coreSrc.indexOf('const MATH_RE');
const domPart = coreSrc.slice(0, pureFrom);
if (/\bdocument\s*\./.test(coreSrc.slice(pureFrom))) {
  console.log('  ✗ 01-core.js 的纯函数区里出现了 document —— 抠法需要调整');
  process.exit(1);
}
const escapeHtmlSrc = pasteSrc.slice(
  pasteSrc.indexOf('function escapeHtml(str) {'),
  pasteSrc.indexOf('// 自动滚动到底部'));

const api = new Function(
  'function latexPlain(s) { return String(s); }\n'
  + escapeHtmlSrc + '\n'
  + coreSrc.slice(pureFrom) + '\n'
  + 'return { formatText, renderTable };')();

const F = api.formatText;

/* ==================== 1. 表格 ==================== */
section('markdown 表格');

const basic = F('| x | y |\n|---|---|\n| 1 | 2 |');
ok('渲染出 <table class="md-table"', basic.includes('<table class="md-table">'), basic.slice(0, 80));
ok('有 thead / tbody', basic.includes('<thead>') && basic.includes('<tbody>'));
ok('表头是 th、数据是 td', basic.includes('<th>x</th>') && basic.includes('<td>1</td>'));
ok('管道符没有残留', !basic.includes('|'), basic);
ok('**没有被包进 <p>**', !basic.includes('<p'), basic);
ok('外面套了可横向滚动的容器', basic.includes('<div class="md-table-wrap">'));

// 截图里的真实案例:模型写表格时行间夹了空行
const real = F([
  '**步骤 3:列表算出各候选点的函数值**',
  '',
  '| x | $0$ | $2$ | $3$ |',
  '',
  '|---|---|---|---|',
  '',
  '| f(x) | 0 - 0 + 2 = 2 | 8 - 12 + 2 = -2 |',
  '| 27 - 27 + 2 = 2 |',
].join('\n'));
ok('行间夹空行也能识别成表格', real.includes('<table class="md-table">'));
ok('表头 4 列', (real.match(/<th\b/g) || []).length === 4, (real.match(/<th\b/g) || []).length);
ok('表头前的粗体段落没被吞掉', real.includes('<strong>步骤 3'));
ok('缺列的行不会崩(用空单元格补齐)',
   (real.match(/<td\b/g) || []).length % 4 === 0, (real.match(/<td\b/g) || []).length);

section('单元格里的公式');
ok('$0$ 变成公式节点,不再是字面文本', real.includes('data-tex="0"'), real.slice(0, 200));
ok('$2$ / $3$ 同样升级', real.includes('data-tex="2"') && real.includes('data-tex="3"'));
ok('单元格里的公式是行内模式(不是块级)',
   real.includes('data-display="0"') && !real.includes('data-display="1"'),
   real.slice(real.indexOf('data-tex="0"') - 70, real.indexOf('data-tex="0"') + 10));

section('对齐语法');
const al = F('| a | b | c |\n|:--|--:|:-:|\n| 1 | 2 | 3 |');
ok(':-- → 左对齐', al.includes('class="tl"'));
ok('--: → 右对齐', al.includes('class="tr"'));
ok(':-: → 居中', al.includes('class="tc"'));

section('表格的边界情况');
ok('孤立的管道符文本不当表格',
   F('a | b | c').includes('<p class="bubble-p">'), F('a | b | c'));
ok('只有表头没有分隔行 → 不当表格',
   F('| a | b |\n| 1 | 2 |').includes('<p class="bubble-p">'));
ok('代码块里的表格原样保留',
   F('```\n| a | b |\n|---|---|\n```').includes('<pre class="code-block">'));
ok('单元格里的 HTML 被转义',
   F('| a |\n|---|\n| <b>x</b> |').includes('&lt;b&gt;'), true);
ok('表头只有一列也能渲染', F('| a |\n|---|\n| 1 |').includes('<th>a</th>'));
ok('单元格里的粗体也认(与正文共用同一套行内规则)',
   F('| a |\n|---|\n| **粗** |').includes('<strong>粗</strong>'));

/* ==================== 2. 金额守卫 ==================== */
section('$...$ 的金额 / 公式判定');

const isMath = s => F(s).includes('math-node');
ok('$0$ → 公式', isMath('答案是 $0$'));
ok('$12$ → 公式', isMath('共 $12$ 个'));
ok('$1,200$ → 金额,不当公式', !isMath('价格 $1,200$ 元'), F('价格 $1,200$ 元'));
ok('$99.99$ → 金额,不当公式', !isMath('售价 $99.99$ 美元'), F('售价 $99.99$ 美元'));
ok('$ 100 $ 首尾带空格 → 不当公式', !isMath('$ 100 $'));
ok('真正的公式照旧', isMath('$f(x) = x^2$'));
ok('$$...$$ 块级公式照旧', F('$$\\int_0^1 x dx$$').includes('data-display="1"'));

/* ==================== 3. 别把原有的弄坏 ==================== */
section('回归:原有语法');

ok('标题', F('## 小标题').includes('<h4 class="bubble-h">'));
ok('无序列表', F('- 甲\n- 乙').includes('<ul><li>甲</li><li>乙</li></ul>'));
ok('有序列表', F('1. 甲\n2. 乙').includes('<ol><li>甲</li>'));
ok('行内代码', F('用 `npm test` 跑').includes('<code>npm test</code>'));
ok('代码块', F('```\nx = 1\n```').includes('<pre class="code-block">'));
ok('分隔线', F('---').includes('<hr>'));
ok('粗体 / 斜体', F('**粗**和*斜*').includes('<strong>粗</strong>'));
ok('段落内换行保留为 <br>', F('第一行\n第二行').includes('<p class="bubble-p">第一行<br>第二行</p>'));

console.log('\n========== ' + (pass + fail) + ' 项:' + pass + ' PASS / ' + fail + ' FAIL ==========');
process.exit(fail ? 1 : 0);
