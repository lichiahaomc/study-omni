/**
 * 生成 public/index.html 顶部的目录(index)。
 *
 * 为什么需要它:这个文件近 8000 行,分节横幅一度是"手写 + 没人校验"的状态 ——
 * 结果新代码一路往后追加,1400 行内容全挂在「已收藏状态」这个标题下面,
 * 目录彻底失去意义。所以目录必须是**生成**的,并且由 `npm test` 校验,
 * 一旦与真实横幅不一致就报错,而不是等人发现。
 *
 * 用法:
 *   node scripts/toc.mjs          重写 public/index.html 里的目录块
 *   node scripts/toc.mjs --check  只校验(不写文件),不一致时退出码 1
 */

import fs from 'node:fs';
import path from 'node:path';

const FILE = path.join(process.cwd(), 'public', 'index.html');

/* ⚠️ BEGIN 与 END 合起来才是一个注释: BEGIN **不能自带 `-->`**。
   写成 `<!-- ... -->` 的话它当场就闭合了,后面那些目录行会变成**裸文本** ——
   `<head>` 里不允许放文本,解析器会把它们塞进 `<body>`,目录就显示在页面上了。
   (踩过:探针发现 body.textContent 里有 "[样式]",而 HTML 源码看着完全正常。) */
const BEGIN = '<!-- ▼ 目录 · 由 `npm run toc` 生成,请勿手改 ▼';
const END = '▲ 目录结束 ▲ -->';

/* 一段(segment)= 文件骨架里的一整块。区块(section)= 里面的一个横幅。 */
const SEGMENTS = [
  { key: 'css', label: '样式', from: '<style>', to: '</style>' },
  { key: 'pre', label: '预初始化脚本(首屏渲染前,避免闪一下再变)', from: '<script>', to: '</script>' },
  { key: 'body', label: '页面结构', from: '<body>', to: '<script>' },
  { key: 'js', label: '主脚本', from: '<script>', to: '</script>' }
];

/* 横幅识别:同时认 CSS 和 HTML 两种注释,单行与多行都认。
   刻意只认 `=====` 这种强标记 —— 普通的 /* 说明注释不该进目录。 */
const HEAD = /^\s*(?:\/\*|<!--)\s*={3,}\s*(.+?)\s*=*\s*(?:\*\/|-->)?\s*$/;

const stripToc = text => {
  const a = text.indexOf(BEGIN), b = text.indexOf(END);
  if (a < 0 || b < 0) return text;
  // 连同目录块后面的那个换行一起去掉,恢复成插入前的样子
  const tail = text.slice(b + END.length).replace(/^\n/, '');
  return text.slice(0, a) + tail;
};

function boundaries(lines) {
  const idx = (pat, from) => lines.findIndex((l, i) => i >= from && l.trim().startsWith(pat));
  const styleOpen = idx('<style>', 0);
  const styleClose = idx('</style>', styleOpen + 1);
  const preOpen = idx('<script>', styleClose + 1);
  const preClose = idx('</script>', preOpen + 1);
  const bodyOpen = idx('<body', preClose + 1);
  const jsOpen = idx('<script>', bodyOpen + 1);
  const jsClose = idx('</script>', jsOpen + 1);
  return { styleOpen, styleClose, preOpen, preClose, bodyOpen, jsOpen, jsClose };
}

/* 收集所有区块。offset = 目录块自身占的行数(它插在文件最前面,
   会把后面所有行号往下推,所以要迭代到收敛)。 */
function collect(lines, offset) {
  const b = boundaries(lines);
  const ranges = [
    { seg: SEGMENTS[0], a: b.styleOpen + 1, z: b.styleClose },       // <style> 之后, </style> 之前
    { seg: SEGMENTS[1], a: b.preOpen + 1, z: b.preClose },
    { seg: SEGMENTS[2], a: b.bodyOpen + 1, z: b.jsOpen },
    { seg: SEGMENTS[3], a: b.jsOpen + 1, z: b.jsClose }
  ];
  const out = [];
  ranges.forEach(r => {
    const list = [];
    for (let i = r.a; i < r.z && i < lines.length; i++) {
      const m = lines[i].match(HEAD);
      if (m) list.push({ line: i + 1 + offset, title: m[1] });
    }
    // 区块范围给的是**整段**的起止,不是第一个小节的行号 ——
    // 否则「样式 77 – 3482」看着像少了一大截。
    // 换算:base 里第 i 行(0 基)在插入目录后是第 i + offset + 1 行(1 基)。
    out.push({ seg: r.seg, first: r.a + offset + 1, last: r.z + offset, sections: list });
  });
  return { blocks: out, bounds: b };
}

/* 段标题是从正文里摘出来的,可能含有 `-->`(比如某个横幅里写了 HTML 注释)。
   直接放进目录会让注释提前闭合 → 剩下的内容全变成页面正文。 */
const sanitize = t => String(t)
  .replace(/<!--/g, '<!')
  .replace(/-->/g, '→')
  .replace(/--/g, '–');

function render(blocks, totalLines, tocLineCount) {
  const pad = n => String(n).padStart(5);
  const L = [];
  L.push(BEGIN);
  L.push('  目录 · 全文 ' + totalLines + ' 行,分 ' + blocks.reduce((a, b) => a + b.sections.length, 0) + ' 段。');
  L.push('  改动后跑 `npm run toc` 重新生成;`npm test` 会校验它与实际横幅一致。');
  // ⚠️ 这里不能出现字面量 `<!--` / `-->`:注释里一旦有 `-->` 就**提前结束**,
  // 后半段会变成页面上的可见正文(踩过 —— 探针发现 body 文本里有 "[样式]")。
  // 同理,下面的段标题也要过一遍 sanitize。
  L.push('  正文的分节横幅本来就有,只是 CSS 用 /* ===== */、JS 用 /* ======== */、');
  L.push('  HTML 用「等号注释」,三种写法各管各的,没有一处能把它们列全 —— 于是有了这份目录。');
  blocks.forEach(bl => {
    L.push('');
    L.push('  [' + sanitize(bl.seg.label) + ']  ' + bl.first + ' – ' + bl.last);
    bl.sections.forEach(s => L.push('    ' + pad(s.line) + '  ' + sanitize(s.title)));
  });
  L.push(END);
  return L;
}

/* ---- 主流程 ----
   ⚠️ 目录插在 `<head>` 之后、`<style>` 之前,**不能**放到 <!DOCTYPE html> 前面 ——
   doctype 之前多出内容有触发怪异模式(quirks mode)的风险,那会改掉默认盒模型,
   整个布局都要跟着变。插在 head 里同样是"打开文件就看到",但没有这个隐患。

   插入会把下面所有行号往下推,所以先迭代到"行数收敛"再生成最终内容(两轮就稳)。 */
const raw = fs.readFileSync(FILE, 'utf8');
const base = stripToc(raw);

const baseLines = base.split('\n');
const headAt = base.indexOf('<head>');
if (headAt < 0) { console.log('  FAIL  index.html 里找不到 <head>'); process.exit(1); }
const INSERT_AT = base.indexOf('\n', headAt) + 1;   // `<head>` 那一行之后
const headPart = base.slice(0, INSERT_AT);
const restPart = base.slice(INSERT_AT);

/* 迭代到行数收敛:目录多一行,下面所有行号就整体 +1 */
let toc = null, tocLen = 0;
for (let round = 0; round < 8; round++) {
  const { blocks } = collect(baseLines, tocLen);
  const now = render(blocks, baseLines.length - 1 + tocLen, 0);
  toc = now;
  if (now.length === tocLen) break;
  tocLen = now.length;
}

let finalText = headPart + toc.join('\n') + '\n' + restPart;
/* 收敛后把标题里的总行数改成实测值,免得写个错数字 */
const total = finalText.split('\n').length - 1;
const sectionCount = collect(finalText.split('\n'), 0).blocks
  .reduce((a, b) => a + b.sections.length, 0);
toc[1] = '  目录 · 全文 ' + total + ' 行,分 ' + sectionCount + ' 段。';
finalText = headPart + toc.join('\n') + '\n' + restPart;
const check = process.argv.includes('--check');

/* ---- 自检:每个行号指过去,那一行必须真的是一条横幅。
   没有这一步的话,"差一行"这种错只有肉眼才能发现 —— 而没人会去逐个核对。 ---- */
function verify(text) {
  const ls = text.split('\n');
  const blocks = collect(ls, 0).blocks;
  const bad = [];
  blocks.forEach(b => b.sections.forEach(s => {
    const line = ls[s.line - 1];
    if (!line || !HEAD.test(line)) bad.push(s.line + ' → ' + String(line).slice(0, 60));
  }));
  return { bad, count: blocks.reduce((a, b) => a + b.sections.length, 0) };
}

const chk = verify(finalText);
if (chk.bad.length) {
  console.log('  生成器自检失败:' + chk.bad.length + ' 个行号指不到横幅 ——');
  chk.bad.slice(0, 5).forEach(b => console.log('    ' + b));
  if (!check) process.exit(1);
}

/* 目录正文里绝不能出现注释定界符:注释一旦被提前闭合,
   后面的目录内容会变成页面上的可见文字(踩过)。 */
const tocBody = toc.slice(1, -1).join('\n');
if (/<!--|-->/.test(tocBody)) {
  console.log('  生成器自检失败:目录正文里出现了注释定界符,会导致注释提前闭合');
  process.exit(1);
}

if (check) {
  if (base === raw) { console.log('  FAIL  index.html 里找不到目录块'); process.exit(1); }
  if (raw !== finalText) {
    console.log('  FAIL  目录已过期 —— 横幅有改动但目录没重新生成。跑 `npm run toc` 修好。');
    process.exit(1);
  }
  console.log('  目录与正文一致,且 ' + chk.count + ' 个行号都指得准');
  process.exit(0);
}

fs.writeFileSync(FILE, finalText, 'utf8');
console.log('已写入目录:' + chk.count + ' 段 · 全文 ' + total + ' 行 · 行号自检'
  + (chk.bad.length ? '有 ' + chk.bad.length + ' 处不对' : '全部通过'));
