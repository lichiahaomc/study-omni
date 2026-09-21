/**
 * 把 public/index.html 拆成 index.html + css/*.css + js/*.js。
 *
 * 三条硬约束:
 *
 * 1. **严格保持原有顺序**。CSS 级联吃顺序、JS 执行也吃顺序 ——
 *    切片只允许按行号连续切,绝不允许把某段挪到别处。所以每个切点都选在
 *    分节横幅上,不会把任何一条规则或一个函数劈成两半。
 *
 * 2. **切完必须能原样拼回去**。落盘前先做一次"把各片正文按序拼接 == 原文对应区间"
 *    的逐字节比对,不通过就直接退出,不写任何文件。落盘后再读回来验一遍。
 *
 * 3. **head 里的预初始化脚本保持内联**。它必须在首次绘制前跑完,
 *    拆成外部文件会引入一次网络往返,首帧闪一下再变(深色用户看到白屏)。
 *
 * 用法:
 *   node scripts/split.mjs --check   只做比对,不写文件
 *   node scripts/split.mjs           执行切分
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'public', 'index.html');
const CHECK = process.argv.includes('--check');

const HEAD_END = '   ===== 文件头结束(以下为原样切出的内容)=====';
/* ⚠️ 头的起始行**不能用 `/* ===== … ===== *\/` 那种分节横幅的写法** ——
   否则 toc.mjs 扫描分节时会把它当成一条真分节收进索引(踩过)。 */
const header = (file, what) => [
  '/* ▼ 自动生成,请勿手改本文件头 ▼',
  '   ' + file + '  —— ' + what,
  '',
  '   本文件由 scripts/split.mjs 从 public/index.html 切出。',
  '   ⚠️ 加载顺序在 index.html 里固定,不要调整 ——',
  '      CSS 级联与 JS 执行都吃顺序,换了位置就会出问题。',
  HEAD_END,
].join('\n') + '\n';

/* 1-based 闭区间。切点都落在分节横幅上 */
const CSS_CHUNKS = [
  ['css/01-tokens.css', '设计令牌 / 排版层级 / 投影 / 间距 / 动效曲线', 80, 176],
  ['css/02-shell.css', '液态玻璃 / 氛围光斑 / 自定义背景 / 底部导航条 / 布局 / 学科选择器 / 栏间拖拽手柄', 177, 856],
  ['css/03-panels.css', 'Left: Upload / Center: Result / 共享控件规则 / Right: Chat', 857, 1842],
  ['css/04-dark.css', '优雅降级(不支持 backdrop-filter)/ 暗色主题', 1843, 2348],
  ['css/05-features.css', '设置抽屉 / 自定义 API / 通用弹窗 / 图片裁剪 / 收藏夹 / 密度 / 提示条 / 无障碍 / 公式 / 已收藏状态', 2349, 3299],
  ['css/06-responsive.css', '窄屏 / 竖屏:一次一栏 + 底部导航', 3300, 3504],
  ['css/07-brand-motion.css', '主题色调色板 / 按钮果冻动效', 3505, 3542],
];

const JS_CHUNKS = [
  ['js/01-core.js', '通用交互逻辑(转义 / 主题切换 / 开关等)', 4704, 4875],
  ['js/02-math.js', '公式渲染(LaTeX 占位 → 按需升级)', 4876, 5165],
  ['js/03-ai.js', 'AI 后端接入 + 自定义 API(BYOK)', 5166, 5637],
  ['js/04-parse.js', '素材解析(图片 / PDF 文本 / 扫描件)', 5638, 5774],
  ['js/05-crop.js', '图片裁剪(框选题目)', 5775, 6184],
  ['js/06-toolbar.js', '中栏工具栏 & 底部操作按钮(收藏 / 分享 / 示例素材)', 6185, 6508],
  ['js/07-tabs.js', '移动端底部导航', 6509, 6639],
  ['js/08-paste.js', 'Ctrl+V 粘贴上传', 6640, 6917],
  ['js/09-settings.js', '设置中心', 6918, 7441],
  ['js/10-brand-bg.js', '自定义主题色 + 上传背景', 7442, 7975],
  ['js/11-resizer.js', '三栏拖拽调整宽度', 7976, 8157],
];

/* ---------- 读原文 ----------
   ⚠️ 这里**不能**先把顶部目录块剥掉:切点是按带目录时的行号量出来的,
   剥掉目录会让后面所有行号整体上移,切点就全错位了。
   目录块只在最后写 head 的时候才剥。 */
const src = fs.readFileSync(SRC, 'utf8');

const TOC_BEGIN = '<!-- ▼ 目录 · 由 `npm run toc` 生成,请勿手改 ▼';
const TOC_END = '▲ 目录结束 ▲ -->';
const stripToc = text => {
  const a = text.indexOf(TOC_BEGIN), b = text.indexOf(TOC_END);
  if (a < 0 || b < 0) return text;
  return text.slice(0, a) + text.slice(b + TOC_END.length).replace(/^\n+/, '');
};

const L = src.split('\n');
const find = (pat, from = 0) => L.findIndex((l, i) => i >= from && l.trim().startsWith(pat));
const styleOpen = find('<style>');
const styleClose = find('</style>', styleOpen + 1);
const preOpen = find('<script>', styleClose + 1);
const preClose = find('</script>', preOpen + 1);
const bodyOpen = find('<body', preClose + 1);
const jsOpen = find('<script>', bodyOpen + 1);
const jsClose = find('</script>', jsOpen + 1);

/* 这个脚本是**一次性迁移工具**:只对"还没拆过"的 index.html 有意义。
   拆完之后 css/ 与 js/ 本身就是源码,没有可对照的原文了 ——
   所以检测到已拆状态就明确说出来并退出,而不是抛一句看不懂的错。
   (拆完之后真正该守的不变量是"引用顺序 == 文件名顺序",那条在 npm test 里。) */
if (styleOpen < 0) {
  const cssN = fs.existsSync(path.join(ROOT, 'public', 'css'))
    ? fs.readdirSync(path.join(ROOT, 'public', 'css')).length : 0;
  const jsN = fs.existsSync(path.join(ROOT, 'public', 'js'))
    ? fs.readdirSync(path.join(ROOT, 'public', 'js')).length : 0;
  console.log('index.html 已经是拆分后的形态(没有 <style> 块)。');
  console.log('当前 public/css/ ' + cssN + ' 个、public/js/ ' + jsN + ' 个。');
  console.log('');
  console.log('本脚本只在需要**重新切一次**时使用:先把 css/ 与 js/ 的内容合回');
  console.log('index.html(恢复成单文件),再跑 `npm run split`。');
  console.log('平时改样式/脚本直接改 css/ 与 js/ 即可,然后 `npm run toc` 更新索引。');
  process.exit(CHECK ? 0 : 1);
}

const slice = (a, b) => L.slice(a - 1, b).join('\n');   // 1-based 闭区间

/* ---------- 切 ---------- */
function build(chunks, label, open, close) {
  const out = [];
  let expect = open + 1;
  for (const [file, what, a, b] of chunks) {
    if (a !== expect) {
      console.error('✗ ' + label + ' 切片不连续:' + file + ' 从 ' + a + ' 开始,但上一片结束于 ' + (expect - 1));
      process.exit(1);
    }
    out.push({ file, what, a, b, body: slice(a, b) });
    expect = b + 1;
  }
  if (expect !== close) {
    console.error('✗ ' + label + ' 没覆盖完整:' + (close - 1) + ' 行后还有 ' + (close - expect + 1) + ' 行没分到');
    process.exit(1);
  }
  return out;
}

/* open / close 传**标签所在行的 1-based 行号**;内容区间是 open+1 .. close-1 */
const css = build(CSS_CHUNKS, 'CSS', styleOpen + 1, styleClose + 1);
const js = build(JS_CHUNKS, '主脚本', jsOpen + 1, jsClose + 1);

/* ---------- 自检:拼回去必须与原文逐字节一致 ---------- */
function verify(label, parts, a, b) {
  const joined = parts.map(p => p.body).join('\n');
  const original = slice(a, b);
  if (joined === original) {
    const bytes = Buffer.byteLength(joined, 'utf8');
    console.log('  ✓ ' + label + ' 拼回一致:' + parts.length + ' 片 / ' + (b - a + 1) + ' 行 / ' + bytes + ' 字节');
    return true;
  }
  console.error('  ✗ ' + label + ' 拼回**不一致** —— 拒绝落盘');
  for (let i = 0; i < Math.max(joined.length, original.length); i++) {
    if (joined[i] !== original[i]) {
      console.error('    首个差异在第 ' + i + ' 字符:');
      console.error('      拼回: ' + JSON.stringify(joined.slice(i - 40, i + 40)));
      console.error('      原文: ' + JSON.stringify(original.slice(i - 40, i + 40)));
      break;
    }
  }
  return false;
}

console.log('=== 自检:切片能否原样拼回 ===');
const okCss = verify('CSS', css, styleOpen + 2, styleClose);
const okJs = verify('主脚本', js, jsOpen + 2, jsClose);
if (!okCss || !okJs) process.exit(1);
if (CHECK) { console.log('\n--check 通过(未写任何文件)'); process.exit(0); }

/* ---------- 写 CSS / JS ---------- */
for (const c of [...css, ...js]) {
  const target = path.join(ROOT, 'public', c.file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, header(c.file, c.what) + c.body + '\n', 'utf8');
  console.log('  ' + c.file.padEnd(26) + String(c.b - c.a + 1).padStart(4) + ' 行');
}

/* ---------- 写新的 index.html ---------- */
const headLines = L.slice(0, styleOpen);                 // ...<style> 之前(不含 <style>)
const preScript = L.slice(preOpen, preClose + 1).join('\n');   // 内联的预初始化脚本
/* ⚠️ `</script>` 与 `<body>` **之间还夹着东西**(原文件里是 `</head>`)。
   第一版把这段直接跳过了,结果 `</head>` 被悄悄吞掉 —— 而且我当时只校验了
   "切出去的 CSS/JS 能否拼回",完全没覆盖留下的 HTML,所以自检是绿的。
   现在单独切出 gap,并且下面加了行覆盖自检,这类漏行藏不住了。 */
const gapLines = L.slice(preClose + 1, bodyOpen);
const bodyLines = L.slice(bodyOpen, jsOpen);             // <body> ... 到主脚本之前
const tail = L.slice(jsClose + 1);                        // </script> 之后

const linkTags = css.map(c => '<link rel="stylesheet" href="' + c.file + '" />').join('\n');
const scriptTags = js.map(c => '<script src="' + c.file + '"></script>').join('\n');

const newIndex = [
  stripToc(headLines.join('\n')),   // 目录块只在这里剥掉
  linkTags,
  preScript,                     // 仍然是内联的:必须在首帧前跑完
  gapLines.join('\n'),           // </head> 之类
  bodyLines.join('\n'),          // <body> ... 主脚本之前
  scriptTags,
  tail.join('\n'),
].join('\n');

/* ---------- 自检二:行覆盖 ----------
   原文的每一行都必须被某个产物认领(切出的 CSS/JS、或新的 index.html),
   不能凭空少一行、也不能多出来。上面那个 `</head>` 就是被这条抓出来的。 */
{
  const tocFrom = L.findIndex(l => l.includes(TOC_BEGIN));
  const tocTo = L.findIndex(l => l.includes(TOC_END));
  const inR = (i, a, b) => i >= a && i <= b;
  /* ⚠️ 这里**不能**把内联预初始化脚本那段也排除 —— 它并没有被切出去,
     仍然留在 index.html 里。第一版把它排除了,于是 X 和 Y 必然对不上。 */
  const X = L.filter((_, i) => !inR(i, tocFrom, tocTo)
    && !inR(i, styleOpen, styleClose) && !inR(i, jsOpen, jsClose));
  const Y = newIndex.split('\n').filter(l =>
    !/^<link rel="stylesheet" href="css\//.test(l) && !/^<script src="js\//.test(l));

  if (X.join('\n') === Y.join('\n')) {
    console.log('  ✓ 行覆盖:原文留下的 ' + X.length + ' 行,新 index.html 里一行不多一行不少');
  } else {
    console.error('  ✗ 行覆盖**不一致** —— 拒绝落盘');
    const n = Math.max(X.length, Y.length);
    for (let i = 0; i < n; i++) {
      if (X[i] !== Y[i]) {
        console.error('    第 ' + (i + 1) + ' 行起开始不同:');
        console.error('      原文应有: ' + JSON.stringify(String(X[i]).slice(0, 70)));
        console.error('      新文件是: ' + JSON.stringify(String(Y[i]).slice(0, 70)));
        break;
      }
    }
    process.exit(1);
  }
}

fs.writeFileSync(SRC, newIndex, 'utf8');

/* ---------- 落盘后再读回来验一遍 ---------- */
console.log('\n=== 落盘后复核 ===');
let bad = 0;
for (const c of [...css, ...js]) {
  const got = fs.readFileSync(path.join(ROOT, 'public', c.file), 'utf8');
  const i = got.indexOf(HEAD_END);
  const body = i < 0 ? got : got.slice(i + HEAD_END.length + 1).replace(/\n$/, '');
  if (body !== c.body) { bad++; console.error('  ✗ ' + c.file + ' 读回来与切出时不一致'); }
}
console.log(bad ? '  ✗ ' + bad + ' 个文件有问题' : '  ✓ ' + (css.length + js.length) + ' 个文件读回一致');
console.log('\nindex.html: ' + (src.split('\n').length) + ' 行 → ' + newIndex.split('\n').length + ' 行');
console.log('新增 ' + css.length + ' 个 CSS + ' + js.length + ' 个 JS');
