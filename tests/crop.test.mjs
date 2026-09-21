/**
 * 图片裁剪功能测试(纯离线)。
 *
 * 坐标映射 `cropRectOf` 是顶层纯函数,所以能像 StudyBrand 那样抠出来直接单测 ——
 * 这段一旦算错,用户裁出来的图就会整体偏移或多出半条边。
 * 其余部分(框选交互 / 弹窗)依赖 DOM,只能在源码结构上守:
 * 把这次踩到的两个坑固化成断言,免得以后改回去。
 */

import fs from 'node:fs';
import path from 'node:path';

let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); }
};
const eq = (n, got, want) => ok(n, got === want, { got, want });
const section = t => console.log('\n=== ' + t + ' ===');

/* 拆分之后:结构在 public/index.html、样式在 public/css/、脚本在 public/js/。
   绝大多数断言只关心"这段东西在不在前端源码里",所以这里把三者按序拼成一份 ——
   等价于拆分前的那个单文件,断言不用逐个改。
   ⚠️ 需要**区分文件位置**的断言(比如"这段 CSS 到底在哪个文件")不要用这份,
   去读对应的文件(见「目录结构」一节)。 */
const PUB = path.join(process.cwd(), 'public');
const readDir = d => fs.readdirSync(path.join(PUB, d)).sort()
  .map(f => fs.readFileSync(path.join(PUB, d, f), 'utf8')).join('\n');
const HTML = readDir('css') + '\n'
  + fs.readFileSync(path.join(PUB, 'index.html'), 'utf8') + '\n' + readDir('js');

/* ---------- 抠出 cropRectOf ---------- */
const START = 'function cropRectOf(';
const s = HTML.indexOf(START);
if (s < 0) { console.log('没找到 cropRectOf,测试无法进行'); process.exit(1); }
// 函数体结束:从起点开始数花括号配对
let depth = 0, e = -1;
for (let i = HTML.indexOf('{', s); i < HTML.length; i++) {
  if (HTML[i] === '{') depth++;
  else if (HTML[i] === '}') { depth--; if (depth === 0) { e = i + 1; break; } }
}
const SRC = HTML.slice(s, e);
const cropRectOf = new Function(SRC + '; return cropRectOf;')();

section('抠出来的函数可用');
ok('cropRectOf 是函数', typeof cropRectOf === 'function', typeof cropRectOf);

/* ---------- 基本映射 ---------- */
section('屏幕选区 → 源图像素');

const r1 = cropRectOf({ x: 0, y: 0, w: 200, h: 150 }, 400, 800, 600);
eq('2 倍缩小时:左半上角', JSON.stringify(r1), JSON.stringify({ sx: 0, sy: 0, sw: 400, sh: 300 }));

const r2 = cropRectOf({ x: 100, y: 50, w: 200, h: 100 }, 400, 800, 600);
eq('2 倍缩小时:偏移正确', JSON.stringify(r2), JSON.stringify({ sx: 200, sy: 100, sw: 400, sh: 200 }));

// 1:1(小图被放大到 2 倍上限时,dispW > natW,系数 < 1)
const r3 = cropRectOf({ x: 0, y: 0, w: 693, h: 520 }, 693, 400, 300);
eq('放大显示时也能反算回原图', JSON.stringify(r3), JSON.stringify({ sx: 0, sy: 0, sw: 400, sh: 300 }));

// 端点各自换算:346→199.71 取 200,692→399.42 取 399,宽 199(而不是分别取整得 199/200)
const r4 = cropRectOf({ x: 346, y: 259, w: 346, h: 259 }, 693, 400, 300);
eq('放大显示时:右下半区', JSON.stringify(r4), JSON.stringify({ sx: 200, sy: 149, sw: 199, sh: 150 }));

// 终点换算必须贴着用户的框:右边界落在 400,就该裁到 400 而不是 399
const r4b = cropRectOf({ x: 0, y: 0, w: 200, h: 150 }, 400, 800, 600);
eq('终点贴在边界时裁满(不被少算 1px)', r4b.sx + r4b.sw, 400);
eq('终点贴在边界时高度也裁满', r4b.sy + r4b.sh, 300);

/* ---------- 夹取:不能越界 ---------- */
section('越界夹取');

const r5 = cropRectOf({ x: -50, y: -50, w: 900, h: 900 }, 400, 800, 600);
ok('负起点被夹到 0', r5.sx === 0 && r5.sy === 0, r5);
ok('尺寸不超出源图', r5.sx + r5.sw <= 800 && r5.sy + r5.sh <= 600, r5);

const r6 = cropRectOf({ x: 395, y: 295, w: 100, h: 100 }, 400, 800, 600);
ok('右下单点拖出:不越界', r6.sx + r6.sw <= 800 && r6.sy + r6.sh <= 600, r6);
ok('右下单点拖出:至少 1px', r6.sw >= 1 && r6.sh >= 1, r6);

// 浮点误差:选区右下正好贴边时,四舍五入可能算出 801
const r7 = cropRectOf({ x: 0.4, y: 0.4, w: 399.2, h: 599.2 }, 400, 800, 600);
ok('贴边时的浮点误差不会多出像素', r7.sx + r7.sw <= 800 && r7.sy + r7.sh <= 600, r7);

const r8 = cropRectOf({ x: 0, y: 0, w: 0, h: 0 }, 400, 800, 600);
ok('零面积选区:尺寸兜底为 1px(而不是 0)', r8.sw >= 1 && r8.sh >= 1, r8);

/* ---------- 不变量 ---------- */
section('不变量');

const CASES = [
  [{ x: 0, y: 0, w: 400, h: 300 }, 400, 400, 300],
  [{ x: 13, y: 27, w: 100, h: 55 }, 250, 1000, 1400],
  [{ x: 199, y: 199, w: 1, h: 1 }, 200, 999, 999],
  [{ x: 0, y: 0, w: 1000, h: 1000 }, 333, 640, 480]
];
CASES.forEach(([sel, dispW, natW, natH], i) => {
  const r = cropRectOf(sel, dispW, natW, natH);
  const inside = r.sx >= 0 && r.sy >= 0 && r.sw >= 1 && r.sh >= 1 &&
                 r.sx + r.sw <= natW && r.sy + r.sh <= natH;
  ok('用例 ' + (i + 1) + ': 结果始终落在源图内且非空', inside, { sel, dispW, natW, natH, r });
});

// dispW 传 0(图还没布局完)不能除出 NaN 或 Infinity
const rz = cropRectOf({ x: 0, y: 0, w: 10, h: 10 }, 0, 800, 600);
ok('dispW=0 不产生 NaN/Infinity',
   [rz.sx, rz.sy, rz.sw, rz.sh].every(v => Number.isFinite(v)), rz);

/* ---------- 源码结构的防回归 ---------- */
section('结构防回归');

ok('裁剪弹窗的三个入口都在',
   /id="cropLayer"/.test(HTML) && /id="cropStage"/.test(HTML) && /id="cropBox"/.test(HTML));
ok('三个动作按钮齐全(取消 / 原图上传 / 确定)',
   /id="cropApply"/.test(HTML) && /id="cropOriginal"/.test(HTML) && /id="cropAll"/.test(HTML));
ok('八个缩放手柄',
   (HTML.match(/class="crop-h"/g) || []).length === 8,
   (HTML.match(/class="crop-h"/g) || []).length);

// ⚠️ 踩过的坑:未框选时只加 is-empty 变暗,选框元素还留着上一张图的几何 ——
// 会显示成幽灵框,而且往里拖会被判成「移动」而不是「画新框」
ok('未框选时必须把选框整个藏起来',
   /\.crop-stage\.is-empty \.crop-box[^{]*\{\s*display:\s*none/.test(HTML));
ok('未框选时手柄也要一起藏(它跟选框同进退)',
   /\.crop-stage\.is-empty [^{]*\.crop-handles[^{]*\{\s*display:\s*none/.test(HTML));

// ⚠️ 踩过的坑:绝对定位子元素的包含块是内边距盒,被 1.5px 边框内缩,
// 偏移写 -11px 的话手柄圆心会偏进角内、拖角落点跟着差几像素
const handleOffsets = [...HTML.matchAll(/\.crop-h\[data-h="(\w+)"\][^}]*?(-?[\d.]+)px/g)]
  .map(m => parseFloat(m[2]));
ok('手柄偏移按边框 12.5px 计算(不是 11px)',
   handleOffsets.length > 0 && handleOffsets.every(v => Math.abs(v) === 12.5),
   handleOffsets);
ok('手柄偏移写的是小数(考虑边框才可能带 .5)', /-12\.5px/.test(HTML));

// 初始不能默认选中整张:选框铺满图片的话,往里拖只会「移动」,画不出新框
ok('初始状态是「未框选」(stage 带 is-empty)',
   /class="crop-stage is-empty"/.test(HTML));
ok('有引导文案', /class="crop-hint"/.test(HTML));

// 三分线要双色描边,单色在浅色试卷或深色照片上会有一边看不见
ok('三分线是白+黑双色', (function () {
  const i = HTML.indexOf('.crop-box::before');
  const block = HTML.slice(i, HTML.indexOf('}', i));
  return /rgba\(255, 255, 255/.test(block) && /rgba\(0, 0, 0/.test(block);
})());

// 取某个选择器规则块的文本(注意同一选择器可能出现多次,这里取第一条带目标的)
function ruleOf(sel, needle) {
  let from = 0;
  for (;;) {
    const i = HTML.indexOf(sel, from);
    if (i < 0) return '';
    const block = HTML.slice(i, HTML.indexOf('}', i));
    if (!needle || block.indexOf(needle) >= 0) return block;
    from = i + 1;
  }
}

// ⚠️ 踩过的坑:给 .crop-stage 加 padding 来给手柄留余地是不行的 ——
// 绝对定位的包含块是「内边距盒」,原点是**边框内缘**,left:0 并不等于图片左边,
// 结果手柄整体偏移 14px。留白必须交给外层 .crop-frame。
ok('留白在外层 .crop-frame 上', /padding:\s*14px/.test(ruleOf('.crop-frame {', 'padding')));
ok('.crop-stage 上不能有 padding(否则手柄会整体偏移)',
   !/\bpadding\s*:/.test(ruleOf('.crop-stage {', 'position')), ruleOf('.crop-stage {', 'position').slice(0, 90));

// ⚠️ 踩过的坑:手柄层跟选框等大,虽然透明仍是命中目标,会把框内点击截走,
// 导致「框内拖 = 移动」被判成「画新框」
ok('手柄层本身不吃事件', /pointer-events:\s*none/.test(ruleOf('.crop-handles {', 'position')) ||
                          /\.crop-handles\s*\{[^}]*pointer-events:\s*none/.test(HTML));
ok('只有手柄圆点可点', /\.crop-h\s*\{\s*pointer-events:\s*auto/.test(HTML));

// 手柄必须与选框分层:选框那一层要被 overflow:hidden 裁掉超大阴影,
// 手柄若同层就会被一起裁(「全选」时八个角全被砍一半)
ok('视口负责裁剪阴影', /overflow:\s*hidden/.test(ruleOf('.crop-viewport {', 'position')) ||
                        /\.crop-viewport\s*\{[^}]*overflow:\s*hidden/.test(HTML));
ok('手柄不在 crop-box 里面(是兄弟层)', (function () {
  const i = HTML.indexOf('<div class="crop-box"');
  const j = HTML.indexOf('</div>', i);
  return HTML.slice(i, j).indexOf('crop-h') < 0;
})());

// 坐标基准必须是 viewport:stage 外面还有 frame 的 14px 留白
ok('交互以 viewport 为坐标原点', /viewport\.getBoundingClientRect\(\)/.test(HTML));
ok('图片尺寸设到 viewport 上', /viewport\.style\.width = dispW/.test(HTML));

/* ⚠️ 踩过的坑:弹窗宽度按 `图片宽 + 38` 算,漏了 .crop-frame 的 14px 内边距,
   内容比弹窗宽 26px → .modal-body 是 overflow-y:auto,另一轴被提升成 auto,
   底部冒出一条横向滚动条(用户报的「框移到最右侧时底下出现的拖拽条」)。
   修法是把这个换算链一处算清,这里再把手写常量与 CSS 对齐 ——
   以后谁改了任一处的内边距,这条会立刻失败。 */
section('弹窗宽度的换算链(别再算漏)');

function padX(sel) {
  const b = ruleOf(sel, 'padding');
  const m = b.match(/padding:\s*([^;]+);/);
  if (!m) return null;
  const parts = m[1].trim().split(/\s+/).map(v => parseFloat(v));
  return parts.length === 1 ? parts[0] : parts[1];   // 两值时第二个是左右
}
const layerPad = padX('.modal-layer {');
const modalBorder = (function () {
  const b = ruleOf('.modal {', 'border');
  const m = b.match(/border:\s*([\d.]+)px/);
  return m ? parseFloat(m[1]) : null;
})();
const bodyPad = padX('.modal-body {');
const framePad = padX('.crop-frame {');

eq('.modal-layer 左右内边距 = 20px(JS 里按 -40 估算可用宽)', layerPad, 20);
eq('.modal-body 左右内边距 = 17px', bodyPad, 17);
eq('.crop-frame 左右内边距 = 14px(给手柄留的余量)', framePad, 14);
eq('.modal 边框 = 1px', modalBorder, 1);

const expectChrome = (modalBorder + bodyPad + framePad) * 2;
ok('JS 的 CHROME 常量与 CSS 三处内边距之和一致(' + expectChrome + ')',
   new RegExp('const CHROME = \\(' + modalBorder + ' \\+ ' + bodyPad + ' \\+ ' + framePad + '\\) \\* 2')
     .test(HTML),
   expectChrome);

ok('图片可用宽度从弹窗可用宽里减掉 CHROME',
   /Math\.min\(820, avail - CHROME\)/.test(HTML));
ok('弹窗宽度公式加的是同一个 CHROME(不是写死的数字)',
   /Math\.min\(MODAL_MAX, dispW \+ CHROME\)/.test(HTML));
ok('.modal-wide 的最大宽度与 JS 的 MODAL_MAX 一致',
   new RegExp('\\.modal-wide \\{ width: min\\(' + (/const MODAL_MAX = (\d+)/.exec(HTML) || [])[1] + 'px, 100%\\); \\}').test(HTML),
   (/const MODAL_MAX = (\d+)/.exec(HTML) || [])[1]);

// 兜底:即便哪天真算漏了 1px,也绝不能冒出横向滚动条
ok('裁剪弹窗的正文显式关掉横向滚动',
   /#cropModal \.modal-body\s*\{\s*overflow-x:\s*hidden/.test(HTML));

section('接入上传链路');

ok('handleFiles 会先过裁剪队列', /window\.StudyCrop\.run\(list\)/.test(HTML));
ok('真正入库的是 commitFiles', /function commitFiles\(files\)/.test(HTML));
ok('裁剪模块没起来时直接入库(不能让文件消失)',
   /if \(!wantsCrop \|\| !window\.StudyCrop[\s\S]{0,160}?commitFiles\(list\)/.test(HTML));
ok('裁剪链路异常时退回原图入库', /StudyCrop\.run\(list\)[\s\S]{0,400}?catch\(/.test(HTML));
ok('非图片跳过裁剪', /list\.some\(window\.StudyCrop\.isImage\)/.test(HTML));

section('设置开关');

ok('DEFAULTS 里有 cropPrompt 且默认开', /cropPrompt:\s*true/.test(HTML));
ok('导入校验表认 cropPrompt', /cropPrompt:\s*v => typeof v === 'boolean'/.test(HTML));
ok('apply() 里会回填开关状态', /setSwitch\('swCropPrompt',\s*state\.cropPrompt\)/.test(HTML));
ok('开关已绑定', /bindSwitch\('swCropPrompt',\s*'cropPrompt'\)/.test(HTML));
ok('设置面板里有这一行', /id="swCropPrompt"/.test(HTML));

console.log('\n========== ' + (pass + fail) + ' 项:' + pass + ' PASS / ' + fail + ' FAIL ==========');
process.exit(fail ? 1 : 0);
