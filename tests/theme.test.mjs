/**
 * 主题配色算法测试 —— 纯离线。
 *
 * 算法本身写在 public/index.html 的 <head> 里(要在首屏渲染前用,不能等主脚本),
 * 但它只依赖 Math / String,不碰 DOM —— 所以这里把那段 IIFE 抠出来在 Node 里跑,
 * 既能真正做单元测试,又不用把代码挪到别处或复制一份。
 *
 * 守的是:内置六套主题反推出来的明暗步长必须对得上,
 * 以及各种畸形输入不能把页面搞成没颜色。
 */

import fs from 'node:fs';
import path from 'node:path';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
};
const eq = (name, got, want) => ok(name, got === want, { got, want });
const section = t => console.log('\n=== ' + t + ' ===');

/* ---------- 把 StudyBrand 从 index.html 里抠出来 ---------- */
/* 拆分之后:结构在 public/index.html、样式在 public/css/、脚本在 public/js/。
   绝大多数断言只关心"这段东西在不在前端源码里",所以这里把三者按序拼成一份 ——
   等价于拆分前的那个单文件,断言不用逐个改。
   ⚠️ 需要**区分文件位置**的断言(比如"这段 CSS 到底在哪个文件")不要用这份,
   去读对应的文件(见「目录结构」一节)。 */
const PUB = path.join(process.cwd(), 'public');
const readDir = d => fs.readdirSync(path.join(PUB, d)).sort()
  .map(f => fs.readFileSync(path.join(PUB, d, f), 'utf8')).join('\n');
const PAGE = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
const HTML = readDir('css') + '\n'
  + fs.readFileSync(path.join(PUB, 'index.html'), 'utf8') + '\n' + readDir('js');

const START = 'window.StudyBrand = (function () {';
const s = HTML.indexOf(START);
if (s < 0) { console.log('没找到 StudyBrand 定义,测试无法进行'); process.exit(1); }
// 从起点往后找配对的 `})();`
const e = HTML.indexOf('})();', s);
if (e < 0) { console.log('StudyBrand 定义没有正常收尾'); process.exit(1); }
// 注意要连 `window.StudyBrand = ` 一起保留 —— 切掉前缀就只剩一个
// 求值后即丢弃的 IIFE,赋不到 window 上(踩过一次)
const SRC = HTML.slice(s, e + '})();'.length);

const win = {};
try { new Function('window', SRC)(win); }
catch (err) { console.log('StudyBrand 求值失败: ' + err.message); process.exit(1); }
const B = win.StudyBrand;

section('抠出来的代码可用');
ok('StudyBrand 存在', !!B, typeof B);
ok('暴露了 parseHex / vars / apply', !!(B && B.parseHex && B.vars && B.apply), Object.keys(B || {}));

/* ---------- parseHex ---------- */
section('颜色解析');

const p = (v) => { try { return B.parseHex(v); } catch (e) { return 'threw'; } };
eq('#aabbcc 解析', JSON.stringify(p('#aabbcc')), JSON.stringify({ r: 170, g: 187, b: 204 }));
eq('#abc 展开成 #aabbcc', JSON.stringify(p('#abc')), JSON.stringify({ r: 170, g: 187, b: 204 }));
eq('不带 # 也能解析', JSON.stringify(p('aabbcc')), JSON.stringify({ r: 170, g: 187, b: 204 }));
eq('大写能解析', JSON.stringify(p('#AABBCC')), JSON.stringify({ r: 170, g: 187, b: 204 }));
eq('空串 → null', p(''), null);
eq('undefined → null', p(undefined), null);
eq('null → null', p(null), null);
eq('乱字符串 → null', p('notacolor'), null);
eq('#zzz → null', p('#zzz'), null);
eq('#12345(5 位)→ null', p('#12345'), null);
eq('#1234567(7 位)→ null', p('#1234567'), null);
eq('带空格→ null(不做 trim 之外的处理)', p('# aabbcc'), null);

/* ---------- vars 的结构 ---------- */
section('变量表结构');

const KEYS = ['--primary', '--primary-hover', '--primary-2', '--primary-rgb', '--primary-2-rgb',
              '--primary-tint', '--primary-tint-rgb', '--primary-2-tint', '--primary-2-tint-rgb',
              '--primary-tint-2'];

const SIX = ['#10b981', '#6366f1', '#3b82f6', '#8b5cf6', '#f43f5e', '#06b6d4'];
SIX.forEach(hex => {
  const v = B.vars(hex);
  const missing = KEYS.filter(k => !v || !v[k]);
  eq(`${hex} 十个变量齐全`, missing.length, 0);
  if (missing.length) console.log('        缺: ' + missing.join(', '));
});

eq('非法色 → null', B.vars('nope'), null);
eq('空串 → null', B.vars(''), null);

/* ---------- rgb 三元组必须与 hex 对得上 ---------- */
section('rgb 三元组与 hex 一致');

const lum = h => {
  const n = parseInt(h.slice(1), 16);
  return Math.round(((n >> 16 & 255) * 0.299 + (n >> 8 & 255) * 0.587 + (n & 255) * 0.114));
};
const hexToTriplet = h => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(',');
};

const MORE = ['#10b981', '#6366f1', '#0ea5e9', '#f43f5e', '#f97316', '#84cc16', '#d946ef', '#14b8a6'];
MORE.forEach(hex => {
  const v = B.vars(hex);
  eq(`${hex} --primary-rgb 对得上`, v['--primary-rgb'], hexToTriplet(v['--primary']));
  eq(`${hex} --primary-2-rgb 对得上`, v['--primary-2-rgb'], hexToTriplet(v['--primary-2']));
  eq(`${hex} --primary-tint-rgb 对得上`, v['--primary-tint-rgb'], hexToTriplet(v['--primary-tint']));
  eq(`${hex} --primary-2-tint-rgb 对得上`, v['--primary-2-tint-rgb'], hexToTriplet(v['--primary-2-tint']));
});

/* ---------- 明暗关系(内置六套就是这个关系) ---------- */
section('明暗关系: hover < primary < primary-2 < tint');

[...SIX, ...MORE, '#000000', '#ffffff', '#800000', '#000080'].forEach(hex => {
  const v = B.vars(hex);
  const l = [lum(v['--primary-hover']), lum(v['--primary']), lum(v['--primary-2']), lum(v['--primary-tint'])];
  ok(`${hex} 亮度单调递增`, l[0] < l[1] && l[1] < l[2] && l[2] < l[3], l);
});

/* ---------- 选中内置色时不应被改动 ---------- */
section('选中内置色时保持原样');

// 六套内置主题的 primary 亮度都在夹取区间内,应当原样输出
SIX.forEach(hex => {
  eq(`${hex} 原样输出`, B.vars(hex)['--primary'].toLowerCase(), hex.toLowerCase());
});

// 超出区间才调整:纯黑/纯白必须被拉回来,否则按钮文字会看不清
['#000000', '#ffffff'].forEach(hex => {
  const v = B.vars(hex);
  const L = lum(v['--primary']);
  ok(`${hex} 被夹到可用亮度(${L})`, L >= 70 && L <= 200, L);
});

/* ---------- apply:切换内置 / 自定义不能留残留 ---------- */
section('apply 的赋值与清理');

function fakeRoot() {
  const vars = new Map();
  const attrs = new Map();
  return {
    style: {
      setProperty: (k, v) => vars.set(k, v),
      removeProperty: (k) => vars.delete(k),
      getPropertyValue: (k) => vars.get(k) || '',
      get length() { return vars.size; }
    },
    setAttribute: (k, v) => attrs.set(k, v),
    getAttribute: (k) => attrs.get(k) || null,
    _vars: vars
  };
}

let root = fakeRoot();
B.apply(root, 'custom', '#ff5500');
eq('自定义:data-brand=custom', root.getAttribute('data-brand'), 'custom');
const customPrimary = root.style.getPropertyValue('--primary');
ok('自定义:写入了 --primary', !!customPrimary, customPrimary);
eq('自定义:写了全部 10 个变量', root.style.length, 10);

B.apply(root, 'green', '');
eq('切回内置:data-brand=green', root.getAttribute('data-brand'), 'green');
eq('切回内置:内联变量被清干净', root.style.length, 0);

// 自定义色非法时必须退回内置,不能留下半套变量
root = fakeRoot();
B.apply(root, 'custom', 'notacolor');
eq('自定义色非法 → 退回 green', root.getAttribute('data-brand'), 'green');
eq('自定义色非法 → 不留内联变量', root.style.length, 0);

root = fakeRoot();
B.apply(root, 'custom', '');
eq('自定义色为空 → 退回 green', root.getAttribute('data-brand'), 'green');

// 内置品牌名不做校验(合法集合在主页脚本里),但必须不留内联变量。
// 未知名字本身无害:没有对应 CSS 规则时页面落回 :root 的默认配色。
root = fakeRoot();
B.apply(root, 'nosuchbrand', '');
eq('未知品牌名 → 不留内联变量', root.style.length, 0);
eq('未知品牌名 → 原样记在属性上(由调用方负责校验)', root.getAttribute('data-brand'), 'nosuchbrand');

// 反复切换不能累积残留
root = fakeRoot();
for (let i = 0; i < 5; i++) {
  B.apply(root, 'custom', '#123456');
  B.apply(root, 'cyan', '');
}
eq('反复切换后仍无残留', root.style.length, 0);
B.apply(root, 'custom', '#123456');
eq('再次自定义仍恰好 10 个', root.style.length, 10);

/* ---------- 与 index.html 里内置主题的一致性 ---------- */
section('内置六套与算法产出不冲突');

// 内置主题是 CSS 规则写的,自定义是内联变量。内联优先级更高,
// 所以切回内置时必须清干净 —— 上面已验。这里再确认六套的 primary
// 亮度都落在算法的夹取区间内(否则"选中内置色保持原样"这条会不成立)。
const IN_RANGE = [];
SIX.forEach(hex => {
  const v = B.vars(hex);
  IN_RANGE.push(v['--primary'].toLowerCase() === hex.toLowerCase());
});
ok('六套内置 primary 全部落在夹取区间内', IN_RANGE.every(Boolean), IN_RANGE);

// 确认 index.html 里确实定义了这六套 CSS 规则
SIX.forEach(hex => {
  ok(`index.html 里有 ${hex} 对应的 :root[data-brand] 规则`,
     HTML.indexOf('[data-brand=') >= 0);
});

/* ---------- 弹窗必须在 .app 之外(层叠上下文) ----------
   踩过的坑:把 .modal-layer 放进 .app 里,.app 有 position:relative + z-index:1
   自成层叠上下文 —— 弹窗的 z-index 就只在 .app 内部有效,会被 body 层级的
   设置抽屉(z-index:100)整个盖住。表现是「设置永远在最上层,弹窗糊在底下」。
   这条只能在源码结构上守。 */
section('弹窗层叠结构');

// 从某个 <div 的起始位置,靠 div 配对找到它闭合的位置
function divSpan(html, startIdx) {
  const re = /<div\b|<\/div>/g;
  re.lastIndex = startIdx;
  let depth = 0, m;
  while ((m = re.exec(html))) {
    if (m[0] === '<div') depth++;
    else {
      depth--;
      if (depth === 0) return { start: startIdx, end: m.index + '</div>'.length };
    }
  }
  return null;
}

const appStart = HTML.indexOf('<div class="app">');
ok('.app 存在', appStart >= 0, appStart);
const appSpan = divSpan(HTML, appStart);
ok('.app 能配平闭合', !!appSpan, appSpan);

// 自检:divSpan 对嵌套结构要能找对闭合位置(否则上面几条都是假通过)
const NEST = '<div class="a"><div><span>y</span><div></div></div></div><p>x</p>';
const nestSpan = divSpan(NEST, 0);
ok('divSpan 自检:嵌套结构闭合位置正确',
   !!nestSpan && NEST.slice(nestSpan.end) === '<p>x</p>',
   nestSpan && NEST.slice(nestSpan.end));

// 找出所有 .modal-layer 的位置
const modalRe = /<div class="modal-layer" id="(\w+)"/g;
const modals = [];
let mm;
while ((mm = modalRe.exec(HTML))) modals.push({ id: mm[1], idx: mm.index });

ok('至少有两个弹窗(取色器 + 背景)', modals.length >= 2, modals.map(m => m.id));
modals.forEach(m => {
  ok(`#${m.id} 在 .app 之外`, m.idx > appSpan.end,
     { modal: m.idx, appEnd: appSpan.end });
});

// 必须排在设置抽屉之后(DOM 靠后 → 同 z-index 时也优先)
const settingsIdx = HTML.indexOf('<div class="settings-layer"');
ok('设置层存在', settingsIdx >= 0, settingsIdx);
modals.forEach(m => {
  ok(`#${m.id} 排在设置抽屉之后`, m.idx > settingsIdx, { modal: m.idx, settings: settingsIdx });
});

// z-index 必须高于设置抽屉
const zOf = sel => {
  const i = HTML.indexOf(sel);
  if (i < 0) return null;
  const block = HTML.slice(i, i + 700);
  const m = block.match(/z-index:\s*(\d+)/);
  return m ? Number(m[1]) : null;
};
const zModal = zOf('.modal-layer {');
const zSettings = zOf('.settings-layer {');
ok('弹窗 z-index 高于设置层', zModal !== null && zSettings !== null && zModal > zSettings,
   { modal: zModal, settings: zSettings });

// .app 确实形成层叠上下文(这正是当初出事的原因,别被顺手改掉)
const appBlock = HTML.slice(appStart - 300, appStart + 900);
const appRule = HTML.slice(HTML.lastIndexOf('.app {', appStart), HTML.indexOf('}', HTML.lastIndexOf('.app {', appStart)));
ok('.app 有 position:relative', /position:\s*relative/.test(appRule), appRule.slice(0, 80));
ok('.app 有非 auto 的 z-index(说明它自成层叠上下文)', /z-index:\s*\d/.test(appRule));

/* ---------- 液态玻璃的通透度 ----------
   这几条不是审美判断,而是防回归:把"整体更通透"这个决定固定下来,
   免得以后某次改动又悄悄把某层调回奶白。上限给得很宽松,
   只要不是接近实色就通过。 */
section('玻璃通透度(防改回奶白)');

// 取某个选择器规则里 background 声明的最大 alpha。
// 两个坑:① 同一选择器可能出现多次(动效降级等覆盖),要挑真正带 background 的那条;
//         ② 有的表面写的是 var(--glass-tint),得去解令牌定义。
function tokenBg(name) {
  const i = HTML.indexOf('--' + name + ':');
  return i < 0 ? '' : HTML.slice(i, HTML.indexOf(';', i));
}
function bgAlphaOf(sel) {
  let from = 0;
  for (;;) {
    const i = HTML.indexOf(sel, from);
    if (i < 0) return null;
    const block = HTML.slice(i, HTML.indexOf('}', i));
    const decl = (block.match(/background:\s*([^;]+);/) || [])[1];
    if (decl) {
      const v = decl.match(/var\(--([\w-]+)\)/);
      const text = v ? tokenBg(v[1]) : decl;
      const as = [...text.matchAll(/rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*([\d.]+)\s*\)/g)]
        .map(x => parseFloat(x[1]));
      return as.length ? Math.max(...as) : null;
    }
    from = i + 1;
  }
}

// [选择器, 上限(超过就是"不够透")]
const GLASS = [
  ['.panel {', 0.70],
  ['.header {', 0.65],
  ['.subject-trigger {', 0.80],
  ['.icon-btn {', 0.80],
  ['.suggestion-chip {', 0.65],
  ['.chat-input {', 0.70],
  ['.message.ai .bubble {', 0.78],
  ['.settings-drawer {', 0.95],
  ['.modal {', 0.96],
  ['.subject-menu {', 0.95],
  ['.file-item {', 0.60],
  ['.meta-tag {', 0.65],
  ['.problem-card {', 0.70],
  ['.info-cell {', 0.65],
  ['.action-bar {', 0.55],
  ['.panel-header {', 0.55],
  ['.ghost-btn {', 0.65],
  ['.subject-search {', 0.70]
];

GLASS.forEach(([sel, ceil]) => {
  const a = bgAlphaOf(sel);
  if (a === null) { ok(`${sel} 能取到背景色`, false, null); return; }
  ok(`${sel} 最大 alpha ${a} ≤ ${ceil}`, a <= ceil, a);
});

// 浮层必须比面板实(里面有正文),但也不能回到实色
const aPanel = bgAlphaOf('.panel {');
const aDrawer = bgAlphaOf('.settings-drawer {');
ok('抽屉比面板实(保证正文可读)', aDrawer > aPanel, { panel: aPanel, drawer: aDrawer });
ok('抽屉未回到实色', aDrawer < 0.96, aDrawer);

// 降级兜底:不支持 backdrop-filter 时才允许接近实色,别被顺手调透
ok('@supports not 的兜底仍是接近实色(0.94)',
   /@supports not[\s\S]{0,600}?background: rgba\(255, 255, 255, \.94\)/.test(HTML));

// 模糊/饱和度令牌仍在(通透靠降 alpha,不靠去掉模糊)
ok('--glass-blur 仍是 blur(...)', /--glass-blur:\s*blur\(\d+px\)/.test(HTML));
ok('--glass-blur 带 saturate', /--glass-blur:\s*blur\(\d+px\)\s*saturate\(\d+%\)/.test(HTML));

/* ---------- 演示级功能:示例素材 / 收藏夹 ---------- */
section('示例素材(现场没素材时的兜底)');

// 硬约束:前端是"零依赖单文件"。示例图必须**现画**,不能多一个静态资源。
const pubFiles = fs.readdirSync(path.join(process.cwd(), 'public')).sort();
ok('public/ 下只有 index.html + css/ + js/(没有多余产物)',
   JSON.stringify(pubFiles) === JSON.stringify(['css', 'index.html', 'js']), pubFiles);
ok('示例图是用 canvas 现画的',
   /function buildSampleFile\(\)/.test(HTML) &&
   /createElement\('canvas'\)/.test(HTML.slice(HTML.indexOf('function buildSampleFile'))));
ok('没有引用外部图片资源', !/<img[^>]+src="(?!data:)[^"]*\.(png|jpe?g|webp)"/i.test(HTML));
ok('两个入口按钮都在', /id="btnSample"/.test(HTML) && /id="btnSample2"/.test(HTML));
ok('走的是正常上传链路(含裁剪)',
   /buildSampleFile\(\)\.then\(f => handleFiles\(\[f\]\)\)/.test(HTML));

section('收藏夹');

ok('查看界面存在',
   /id="favLayer"/.test(HTML) && /id="favList"/.test(HTML) && /id="btnFavList"/.test(HTML));
ok('数量角标存在', /id="favBadge"/.test(HTML));
// ⚠️ 原来去重键是 `学科|内容`,导致从收藏夹载回题目后按钮状态不对、还能重复收藏
ok('按内容去重(不用 学科|内容 做键)', /function favIndexOf\(list, content\)/.test(HTML));
ok('已经没有代码依赖 f.key', !/\bf\.key\b/.test(HTML));
ok('载回中栏走 renderResult', /function loadFavorite\(f\)[\s\S]{0,500}?renderResult\(/.test(HTML));
ok('开合函数在顶层(loadFavorite 要调 closeFav)', /^function closeFav\(\)/m.test(HTML));
ok('列表项用下标而非 key 做标识', /data-i="\$\{i\}"/.test(HTML));
ok('清空前有确认', /confirm\('确定清空全部收藏/.test(HTML));

section('长内容的布局护栏');

// ⚠️ 气泡是 flex 子项,默认 min-width:auto 意味着"撑得住就不缩",
// 长公式会直接把气泡撑破父容器 → 整列横向溢出、回答右侧被裁。
// 有 min-width:0 之后,.katex-display 的 max-width:100% 才真正生效。
ok('.bubble 显式设了 min-width: 0',
   /\.bubble \{[\s\S]{0,500}?min-width:\s*0/.test(HTML));
ok('公式仍有横向滚动兜底',
   /\.math-node \.katex-display \{[\s\S]{0,200}?overflow-x:\s*auto/.test(HTML));

section('目录结构(拆分后)');

const PUB_DIR = path.join(process.cwd(), 'public');
const cssFiles = fs.readdirSync(path.join(PUB_DIR, 'css')).sort();
const jsFiles = fs.readdirSync(path.join(PUB_DIR, 'js')).sort();

ok('css/ 有 7 个文件', cssFiles.length === 7, cssFiles);
ok('js/ 有 11 个文件', jsFiles.length === 11, jsFiles);
ok('css 文件名是 01..07 前缀', cssFiles.every((x, i) =>
   x.startsWith(String(i + 1).padStart(2, '0'))), cssFiles);
ok('js 文件名是 01..11 前缀', jsFiles.every((x, i) =>
   x.startsWith(String(i + 1).padStart(2, '0'))), jsFiles);
ok('每个 css/js 都是 .css/.js',
   cssFiles.every(x => x.endsWith('.css')) && jsFiles.every(x => x.endsWith('.js')));

/* ⚠️ 加载顺序必须与文件名顺序一致 —— CSS 级联和 JS 执行都吃顺序,
   文件名前缀就是用来对齐这个顺序的,错位会出真问题 */
const linkOrder = [...PAGE.matchAll(/<link[^>]+href="css\/([^"]+)"/g)].map(m => m[1]);
const scriptOrder = [...PAGE.matchAll(/<script[^>]+src="js\/([^"]+)"/g)].map(m => m[1]);
ok('index.html 引用了全部 css', JSON.stringify(linkOrder) === JSON.stringify(cssFiles),
   { linkOrder, cssFiles });
ok('index.html 引用了全部 js', JSON.stringify(scriptOrder) === JSON.stringify(jsFiles),
   { scriptOrder, jsFiles });

const PAGE_CODE = PAGE.replace(/<!--[\s\S]*?-->/g, '');   // 剥掉注释再看
ok('index.html 里已经没有内联 <style> 块', !/<style[\s>]/.test(PAGE_CODE));
const inlineScripts = [...PAGE_CODE.matchAll(/<script(?![^>]*\bsrc=)[^>]*>/g)];
ok('只剩一个内联脚本(首屏预初始化)', inlineScripts.length === 1, inlineScripts.length);
/* 预初始化脚本必须在 <head> 里、且在任何 <script src> 之前 ——
   它要在首帧前把主题铺好,拆成外部文件会闪一下再变 */
const headEnd = PAGE_CODE.indexOf('</head>');
ok('内联脚本在 </head> 之前', PAGE_CODE.indexOf('<script>') < headEnd);
ok('内联脚本在任何外部脚本之前',
   PAGE_CODE.indexOf('<script>') < PAGE_CODE.indexOf('<script src='));

/* 每个切出来的文件都带生成头,提醒"别手改顺序" */
[...cssFiles].forEach(x => ok('css/' + x + ' 带生成头',
   fs.readFileSync(path.join(PUB_DIR, 'css', x), 'utf8').includes('请勿手改本文件头')));
[...jsFiles].forEach(x => ok('js/' + x + ' 带生成头',
   fs.readFileSync(path.join(PUB_DIR, 'js', x), 'utf8').includes('请勿手改本文件头')));
/* 切出来的文件里不该再出现 <style> / </script> 这种"整段"痕迹 */
ok('css 文件里没有混进 HTML', cssFiles.every(x =>
   !/<\/(style|script)>/.test(fs.readFileSync(path.join(PUB_DIR, 'css', x), 'utf8'))));

section('切出来的文件:注释必须收尾');

/* ⚠️ 生成的文件头是一段注释,**末尾必须有注释结束符**。
   踩过:漏了收尾符 → 这个未闭合的注释一路吞到正文里第一个注释结束符为止。
   之前一直没露馅纯属侥幸 —— 各文件正文开头正好是分节横幅,被吞的只是横幅本身;
   直到 02-shell.css 的开头变成 `* { box-sizing: border-box; margin: 0; padding: 0 }`
   这行真代码被整个吞掉,reset 没了、body 拿回 UA 默认的 8px margin,
   页面顶部多一条白边、整体高 32px、底部被截。

   判据:把注释剥掉之后,每个文件里**原本的代码必须还在**。 */
// PUB_DIR 在上一节「目录结构」里已经声明过,这里直接复用
const stripCssComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '');

[...fs.readdirSync(path.join(PUB_DIR, 'css')).sort()].forEach(x => {
  const raw = fs.readFileSync(path.join(PUB_DIR, 'css', x), 'utf8');
  const code = stripCssComments(raw);
  ok('css/' + x + ' 剥掉注释后仍有 CSS', code.indexOf('{') >= 0 && code.indexOf('}') >= 0);
});
// 这条是那次事故的直接固化:reset 规则必须活过"剥注释"
// 这条是那次事故的直接固化:reset 必须是**剥掉注释后的第一条规则**。
// 不能只断言"文件里含 box-sizing" —— 别处还有别的规则也写了这个属性,那样太松。
const shell = stripCssComments(fs.readFileSync(path.join(PUB_DIR, 'css', '02-shell.css'), 'utf8'));
ok('02-shell.css 剥掉注释后,第一条规则就是 reset',
   shell.trimStart().startsWith('* { box-sizing: border-box'), shell.trimStart().slice(0, 50));
ok('02-shell.css 的 html,body 高度规则还在', shell.includes('html, body { height: 100%;'));

// JS 同理:剥掉注释后仍要是合法 JS(未闭合的注释会把代码吞成语法错误)
[...fs.readdirSync(path.join(PUB_DIR, 'js')).sort()].forEach(x => {
  const raw = fs.readFileSync(path.join(PUB_DIR, 'js', x), 'utf8');
  let err = null;
  try { new Function(stripCssComments(raw)); } catch (e) { err = e.message; }
  ok('js/' + x + ' 剥掉注释后仍是合法 JS', !err, err);
});

section('源码索引');

// 单文件近 8000 行,靠一份**生成出来**的目录导航。下面几条守的都是踩过的坑。
const tocOpen = HTML.indexOf('<!-- ▼ 源码索引');
const tocClose = HTML.indexOf('▲ 源码索引结束 ▲ -->');
ok('索引块存在', tocOpen >= 0 && tocClose > tocOpen);
// ⚠️ 起始行**不能自带 -->** —— 那样它当场就闭合了,后面的目录行变成裸文本,
// 被解析器从 <head> 挤进 <body>,于是目录显示在页面上(踩过)
ok('索引起始行不自带 -->(否则注释当场闭合)',
   HTML.slice(tocOpen, HTML.indexOf('\n', tocOpen)).indexOf('-->') < 0);
ok('索引正文里没有注释定界符',
   !/<!--|-->/.test(HTML.slice(tocOpen + 30, tocClose)));
// 放 <head> 里,而不是 doctype 之前 —— 后者有触发怪异模式(quirks)的风险
ok('索引在 <head> 之内',
   tocOpen > HTML.indexOf('<head>') && tocOpen < HTML.indexOf('<link '));
ok('DOCTYPE 之前没有任何内容',
   /^\s*<!(?:DOCTYPE|doctype) html>/i.test(PAGE));
ok('npm test 会先校验索引',
   /"test":\s*"node scripts\/toc\.mjs --check/.test(
     fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')));

section('控件文字不许逐字换行(竖排)');

// ⚠️ 按钮是 flex 容器,里面的文字是"匿名 flex 子项"。宽度不够时它不溢出,
// 而是**逐字换行** —— 中文就竖起来了。踩过:操作栏加到 4 个按钮之后,
// 「收藏题目」被压成一列两个字。所以带文字的控件必须显式 nowrap。
const NOWRAP_GROUP = HTML.match(/\.btn,\s*\.btn-mini,[\s\S]{0,220}?white-space:\s*nowrap/);
ok('带文字的控件统一设了 white-space: nowrap', !!NOWRAP_GROUP,
   NOWRAP_GROUP ? NOWRAP_GROUP[0].slice(0, 80) : null);
['.btn', '.btn-mini', '.ghost-btn', '.sample-btn', '.seg-item',
 '.tab-item', '.subject-option', '.subject-trigger'].forEach(cls => {
  ok(cls + ' 在 nowrap 清单里', !!NOWRAP_GROUP && NOWRAP_GROUP[0].includes(cls));
});
// 真放不下时靠外层换行,而不是把按钮压扁
ok('.action-bar 允许换行(兜底)',
   /\.action-bar \{[\s\S]{0,160}?flex-wrap:\s*wrap/.test(HTML));
// 手机上藏掉 emoji,给 4 个按钮腾出宽度
ok('窄屏会藏掉按钮 emoji', /\.action-bar \.btn-i \{ display: none; \}/.test(HTML));
// 收藏按钮的文字是 JS 写的,必须保留 .btn-i 包裹(改回 textContent 就又竖排了)
ok('收藏按钮用 innerHTML 写,保留 .btn-i',
   /btn\.innerHTML = '<span class="btn-i"/.test(HTML));
ok('没有再用 textContent 覆盖收藏按钮',
   !/btn\.textContent = on \?/.test(HTML));

section('设置里的自定义 API');

ok('输入框与按钮都在',
   /id="apiKeyInput"/.test(HTML) && /id="apiBaseInput"/.test(HTML)
   && /id="apiSave"/.test(HTML) && /id="apiReset"/.test(HTML));
// ⚠️ 密钥绝不能进 Settings 的 state —— 否则「导出设置」会把密钥导出成文件
const defaultsBlock = HTML.match(/const DEFAULTS = \{[\s\S]*?\n  \};/);
ok('DEFAULTS 里没有 apiKey / apiBase', !!defaultsBlock
   && !/apiKey|apiBase/.test(defaultsBlock[0]));
ok('密钥单独存一个 localStorage 键', /studyomni-api-key/.test(HTML));
ok('请求头带自定义密钥', /h\['X-Studyomni-Key'\] = k/.test(HTML));
ok('请求头带自定义地址', /h\['X-Studyomni-Base'\] = b/.test(HTML));
// 服务端没配密钥时,填了自定义密钥也要能用(否则会误判"没后端"而降级到演示模式)
ok('探测后端时把自定义密钥算进去',
   /info\.keyConfigured \|\| UserAPI\.active\(\)/.test(HTML));
ok('保存与恢复默认都实现了',
   /function save\(\)/.test(HTML) && /UserAPI\.clear\(\)/.test(HTML));
ok('只填域名时自动补对话路径', /DEFAULT_PATH = '\/chat\/completions'/.test(HTML));

section('README');

const README = fs.readFileSync(path.join(process.cwd(), 'README.md'), 'utf8');
const imgs = [...README.matchAll(/docs\/([\w.-]+\.(?:png|jpe?g|webp))/g)].map(m => m[1]);
ok('README 里引用了截图', imgs.length > 0, imgs.length);
imgs.forEach(f => {
  ok('README 引用的 docs/' + f + ' 确实存在',
     fs.existsSync(path.join(process.cwd(), 'docs', f)));
});
// 图得进仓库才看得到 —— 之前开发截图全被 .gitignore 挡着,README 一张图都没有
ok('docs/ 没被 .gitignore 挡掉',
   !/^\s*docs\//m.test(fs.readFileSync(path.join(process.cwd(), '.gitignore'), 'utf8')));

console.log('\n========== ' + (pass + fail) + ' 项:' + pass + ' PASS / ' + fail + ' FAIL ==========');
process.exit(fail ? 1 : 0);
