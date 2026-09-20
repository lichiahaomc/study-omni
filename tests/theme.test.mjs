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
const HTML = fs.readFileSync(
  path.join(process.cwd(), 'public', 'index.html'), 'utf8');

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

console.log('\n========== ' + (pass + fail) + ' 项:' + pass + ' PASS / ' + fail + ' FAIL ==========');
process.exit(fail ? 1 : 0);
