/**
 * 生成 public/index.html 顶部的**跨文件源码索引**。
 *
 * 拆分之后文件从 1 个变成 19 个,原来的"单文件内跳转"没必要了 ——
 * 现在真正需要一眼看清的是:**加载顺序**,以及"某个东西该去哪个文件找"。
 * 所以这份索引改成按加载顺序列出每个文件、行数、以及它内部的分节。
 *
 * 两条纪律(都是踩出来的):
 *  - 索引是**生成**的,并且由 `npm test` 校验;手写的索引一定会过期。
 *  - 起始标记**不能自带 `-->`**,否则注释当场闭合,后面的内容会变成页面上的
 *    裸文本被解析器挤进 <body>。
 *
 * 用法:
 *   node scripts/toc.mjs          重写索引
 *   node scripts/toc.mjs --check  只校验,不一致时退出码 1
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const INDEX = path.join(ROOT, 'public', 'index.html');
const PUB = path.join(ROOT, 'public');

const BEGIN = '<!-- ▼ 源码索引 · 由 `npm run toc` 生成,请勿手改 ▼';
const END = '▲ 源码索引结束 ▲ -->';

const HEAD = /^\s*(?:\/\*|<!--)\s*={3,}\s*(.+?)\s*=*\s*(?:\*\/|-->)?\s*$/;

/* 加载顺序 = 文件系统里的字典序(文件名前缀 01/02/… 就是给这个用的)。
   ⚠️ 但顺序的真正权威是 index.html 里的 <link> / <script> 顺序 ——
   这里从 index.html 里读出来,而不是自己猜。 */
function loadOrder() {
  const html = fs.readFileSync(INDEX, 'utf8');
  const strip = html.replace(new RegExp(BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?' + END), '');
  const css = [...strip.matchAll(/<link[^>]+href="([^"]+\.css)"/g)].map(m => m[1]);
  const js = [...strip.matchAll(/<script[^>]+src="([^"]+\.js)"/g)].map(m => m[1]);
  return { css, js, html: strip };
}

function scan(file) {
  const text = fs.readFileSync(path.join(PUB, file), 'utf8');
  const lines = text.split('\n');
  const sections = [];
  lines.forEach((l, i) => {
    const m = l.match(HEAD);
    if (m) sections.push({ line: i + 1, title: m[1] });
  });
  return { file, lines: lines.length, bytes: Buffer.byteLength(text, 'utf8'), sections, text };
}

function render(groups, totalLines) {
  const pad = n => String(n).padStart(5);
  const L = [];
  L.push(BEGIN);
  L.push('  源码索引 · 前端共 ' + totalLines + ' 行,按下面的顺序加载。');
  L.push('  改动后跑 `npm run toc` 重新生成;`npm test` 会校验它与实际文件一致,并逐个核验行号。');
  L.push('  ⚠️ 顺序不能调 —— CSS 级联与 JS 执行都吃顺序,换位置就会出问题。');
  groups.forEach(g => {
    L.push('');
    L.push('  【' + g.label + '】');
    g.files.forEach(f => {
      // f.file 是 href,本来就含目录前缀(css/01-tokens.css),别再拼一次
      L.push('    ' + f.file + '   ' + f.lines + ' 行 / ' + (f.bytes / 1024).toFixed(1) + ' KB');
      f.sections.forEach(s => L.push('      ' + pad(s.line) + '  ' + s.title));
    });
  });
  L.push(END);
  return L;
}

const order = loadOrder();
const groups = [
  // ⚠️ 标签文字里**不要写 `<link>` / `<script>` 这类字面量标签** ——
  // 索引是 HTML 注释,写在里面虽然无害,但会把"数内联脚本"之类的源码断言带偏。
  { label: '样式(css/,按加载顺序)', dir: 'css', files: order.css.map(scan) },
  { label: '脚本(js/,按加载顺序)', dir: 'js', files: order.js.map(scan) },
];
const total = groups.reduce((a, g) => a + g.files.reduce((b, f) => b + f.lines, 0), 0);

const raw = fs.readFileSync(INDEX, 'utf8');
const base = (() => {
  const a = raw.indexOf(BEGIN), b = raw.indexOf(END);
  if (a < 0 || b < 0) return raw;
  return raw.slice(0, a) + raw.slice(b + END.length).replace(/^\n/, '');
})();

const check = process.argv.includes('--check');
// 首次生成时索引还不存在,base === raw 是正常的;只有 --check 才该报错
if (check && base === raw) { console.log('  FAIL  index.html 里找不到源码索引'); process.exit(1); }

/* 索引插在 <head> 之后、第一个 <link> 之前 */
const HEAD_AT = base.indexOf('<head>');
if (HEAD_AT < 0) { console.log('  FAIL  找不到 <head>'); process.exit(1); }
const INSERT = base.indexOf('\n', HEAD_AT) + 1;
const headPart = base.slice(0, INSERT);
const restPart = base.slice(INSERT);

let toc = render(groups, total);
let finalText = headPart + toc.join('\n') + '\n' + restPart;

/* 自检:每个行号回到**它自己那个文件**里去看,那一行必须真的是一条分节横幅。
   注意不能拿 index.html 去核 —— 这些行号是各文件内部的坐标(踩过)。 */
function verify() {
  const bad = [];
  let count = 0;
  const cache = {};
  groups.forEach(g => g.files.forEach(f => {
    const ls = cache[f.file] || (cache[f.file] = fs.readFileSync(path.join(PUB, f.file), 'utf8').split('\n'));
    f.sections.forEach(s => {
      count++;
      const line = ls[s.line - 1];
      if (!line || !HEAD.test(line)) bad.push(f.file + ':' + s.line + ' → ' + String(line).slice(0, 50));
    });
  }));
  return { bad, count };
}
const chk = verify();
if (chk.bad.length) {
  console.log('  自检失败:' + chk.bad.length + ' 个行号指不到横幅');
  chk.bad.slice(0, 5).forEach(b => console.log('    ' + b));
  if (!check) process.exit(1);
}

/* 标题里的总行数用实测值,免得写个错数字 */
toc[1] = '  源码索引 · 前端共 ' + total + ' 行,按下面的顺序加载。';
finalText = headPart + toc.join('\n') + '\n' + restPart;

/* 正文里不能出现注释定界符,否则注释提前闭合 */
const tocBody = toc.slice(1, -1).join('\n');
if (/<!--|-->/.test(tocBody)) {
  console.log('  自检失败:索引正文里出现了注释定界符');
  process.exit(1);
}

if (check) {
  if (raw === finalText) {
    console.log('  索引与源码一致,且 ' + chk.count + ' 个行号都指得准');
    process.exit(0);
  }
  console.log('  FAIL  索引已过期 —— 文件有改动但索引没重新生成。跑 `npm run toc` 修好。');
  process.exit(1);
}

fs.writeFileSync(INDEX, finalText, 'utf8');
console.log('已写入索引:' + groups.map(g => g.dir + ' ' + g.files.length + ' 个文件').join(' / ')
  + ' · ' + total + ' 行 · 行号自检' + (chk.bad.length ? '有误' : '全部通过'));
