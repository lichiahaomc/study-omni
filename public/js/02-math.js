/* ▼ 自动生成,请勿手改本文件头 ▼
   js/02-math.js  —— 公式渲染(LaTeX 占位 → 按需升级)

   本文件由 scripts/split.mjs 从 public/index.html 切出。
   ⚠️ 加载顺序在 index.html 里固定,不要调整 ——
      CSS 级联与 JS 执行都吃顺序,换了位置就会出问题。
   ===== 文件头结束(以下为原样切出的内容) ===== */
/* ==================== 公式渲染(LaTeX) ====================
   为什么要拆成两步,而不是在 formatText 里直接调 KaTeX?
     ① formatText 是同步的字符串管线,流式输出每来一段字符就要重画一次,
        不能在这里 await 一个 CDN 请求
     ② KaTeX 有 270KB + 一整套字体,不该为了聊天就常驻 —— 沿用 pdf.js
        的按需策略:页面里真的出现公式才去拉
     ③ 离线 / 内网 / CDN 被挡时,页面还能读(退回到纯文本公式),不会白屏

   所以:formatText 只负责把公式抠成占位节点,这里负责异步把它换成真排版。 */
const KATEX_VER = '0.18.7';
const KATEX_BASE = 'https://cdn.jsdelivr.net/npm/katex@' + KATEX_VER + '/dist/';
const KATEX_OPTS = { throwOnError: false, strict: 'ignore', trust: false, maxSize: 40, maxExpand: 100 };
let katexLib = null, katexPending = null, katexBroken = false;

function loadKatex() {
  if (katexLib) return Promise.resolve(katexLib);
  if (katexBroken) return Promise.reject(new Error('KaTeX 不可用'));
  if (katexPending) return katexPending;
  katexPending = new Promise((resolve, reject) => {
    // 样式先挂上(幂等:已经挂过就不重复加)
    if (!document.getElementById('katex-css')) {
      const link = document.createElement('link');
      link.id = 'katex-css';
      link.rel = 'stylesheet';
      link.href = KATEX_BASE + 'katex.min.css';
      document.head.appendChild(link);
    }
    const s = document.createElement('script');
    s.src = KATEX_BASE + 'katex.min.js';
    s.async = true;
    s.onload = () => {
      const lib = window.katex;
      if (!lib || typeof lib.renderToString !== 'function') {
        katexBroken = true;
        return reject(new Error('KaTeX 加载异常'));
      }
      katexLib = lib;
      resolve(lib);
    };
    s.onerror = () => {
      katexBroken = true;
      katexPending = null;
      reject(new Error('无法加载 KaTeX(可能处于离线状态)'));
    };
    document.head.appendChild(s);
  });
  return katexPending;
}

/* 把容器里的公式节点升级成真排版;开关关掉时反向退回纯文本。
   data-math-done 用来记账,避免重复渲染。 */
async function renderMath(root) {
  const scope = root || document;
  const enabled = document.documentElement.getAttribute('data-latex') !== 'off';
  const nodes = [].slice.call(scope.querySelectorAll('.math-node'));
  if (!nodes.length) return;

  const todo = [], undo = [];
  nodes.forEach(n => {
    const done = n.getAttribute('data-math-done') === '1';
    if (enabled && !done) todo.push(n);
    else if (!enabled && done) undo.push(n);
  });

  // 关掉公式渲染:退回可读的纯文本(比 $...$ 源码友好得多)
  undo.forEach(n => {
    n.textContent = latexPlain(n.dataset.tex || '');
    n.removeAttribute('data-math-done');
  });
  if (!todo.length) return;

  let lib;
  try { lib = await loadKatex(); }
  catch (e) { return; }   // 拉不到就保持现有的纯文本兜底

  todo.forEach(n => {
    const display = n.getAttribute('data-display') === '1';
    let html = null;
    try {
      html = lib.renderToString(n.dataset.tex || '',
        Object.assign({}, KATEX_OPTS, { displayMode: display }));
    } catch (e) { html = null; }
    // 记完账就收工:即便这条公式本身有语法错误,也别下次再重试一遍
    n.setAttribute('data-math-done', '1');
    if (html) n.innerHTML = html;
  });
}

let mathTick = null, mathFirst = 0;
/* 合并成一次批处理,但对"持续有 DOM 变动"的场景留一条底线:
   流式输出时每来一段字符都会触发,纯 debounce 会被无限推后 ——
   所以最多攒 500ms 必定跑一次,保证公式不会卡住不出现。 */
function scheduleMath() {
  const now = Date.now();
  if (!mathTick) mathFirst = now;
  else clearTimeout(mathTick);
  const wait = Math.min(24, Math.max(0, 500 - (now - mathFirst)));
  mathTick = setTimeout(() => { mathTick = null; mathFirst = 0; renderMath(document.body); }, wait);
}

/* 消息 / 解析结果随时会插入 DOM(流式输出更是一段一段插),
   用 MutationObserver 统一兜住所有入口,不用在每个地方手写调用。 */
function initMathAuto() {
  const go = () => {
    if (window.MutationObserver) {
      new MutationObserver(list => {
        for (const m of list) {
          if (m.addedNodes.length) { scheduleMath(); break; }
        }
      }).observe(document.body, { childList: true, subtree: true });
    }
    document.addEventListener('settingschange', e => {
      // 换主题/字号不用重画公式,只有开关本身才需要
      if (!e.detail || e.detail.key === 'latex') scheduleMath();
    });
    renderMath(document.body);
  };
  if (document.body) go();
  else document.addEventListener('DOMContentLoaded', go);
}

/* --------------------------------------------------------------
   极简 LaTeX -> 可读文本。
   只用在两个地方:KaTeX 尚未到达时的兜底、以及公式本身有语法错误时的降级。
   不追求还原排版,只求别让用户看到 \frac / \mathbb 这样的源码。   */
const LP_FRAC = ['frac', 'dfrac', 'tfrac', 'cfrac', 'binom'];
const LP_FONT = ['mathbb', 'mathbf', 'mathrm', 'mathsf', 'mathtt', 'mathit',
  'text', 'textrm', 'textbf', 'textit', 'operatorname', 'boldsymbol', 'bm', 'boxed',
  'mathcal', 'overline', 'underline', 'widehat', 'widetilde', 'hat', 'bar', 'vec', 'dot', 'ddot'];
const LP_DROP = ['left', 'right', 'displaystyle', 'textstyle', 'scriptstyle',
  'scriptscriptstyle', 'limits', 'nolimits', 'nonumber', 'notag'];
const LP_SPACE = [' ', 'quad', 'qquad', '~', ',', ';', ':', '!', 'enspace', 'thinspace'];
const LP_SYMBOL = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', zeta: 'ζ', eta: 'η',
  theta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', omicron: 'ο',
  pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  varepsilon: 'ε', vartheta: 'θ', varphi: 'φ',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
  Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  infty: '∞', partial: '∂', nabla: '∇', angle: '∠', triangle: '△', perp: '⊥',
  forall: '∀', exists: '∃', emptyset: '∅', degree: '°', prime: '′', dots: '…',
  ldots: '…', cdots: '⋯', vdots: '⋮',
  times: '×', div: '÷', pm: '±', mp: '∓', cdot: '·', ast: '∗', circ: '∘', bullet: '•',
  'in': '∈', notin: '∉', ni: '∋', subset: '⊂', subseteq: '⊆', supset: '⊃', supseteq: '⊇',
  cup: '∪', cap: '∩', setminus: '∖', complement: '∁',
  le: '≤', ge: '≥', leq: '≤', geq: '≥', neq: '≠', ne: '≠', equiv: '≡',
  sim: '∼', simeq: '≃', approx: '≈', cong: '≅', propto: '∝', cp: '≺',
  to: '→', rightarrow: '→', longrightarrow: '⟶', leftarrow: '←', leftrightarrow: '↔',
  Rightarrow: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔', mapsto: '↦',
  uparrow: '↑', downarrow: '↓', langle: '⟨', rangle: '⟩', ll: '≪', gg: '≫',
  sum: '∑', prod: '∏', coprod: '∐', int: '∫', iint: '∬', oint: '∮',
  bigcup: '⋃', bigcap: '⋂', sqrt: '√', therefore: '∴', because: '∵',
  lceil: '⌈', rceil: '⌉', lfloor: '⌊', rfloor: '⌋', ln: 'ln', lg: 'lg', sin: 'sin',
  cos: 'cos', tan: 'tan', cot: 'cot', sec: 'sec', csc: 'csc', arcsin: 'arcsin',
  arccos: 'arccos', arctan: 'arctan', log: 'log', exp: 'exp', lim: 'lim', max: 'max', min: 'min',
};
const SUP_MAP = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷',
  '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', 'n': 'ⁿ', 'i': 'ⁱ',
};
const SUB_MAP = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇',
  '8': '₈', '9': '₉', '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎',
  a: 'ₐ', e: 'ₑ', i: 'ᵢ', o: 'ₒ', x: 'ₓ', h: 'ₕ', k: 'ₖ', l: 'ₗ', m: 'ₘ',
  n: 'ₙ', p: 'ₚ', s: 'ₛ', t: 'ₜ',
};

/* 找到与 s[start] 那对花括号,返回 {body, end};不是花括号或不闭合则返回 null */
function matchBrace(s, start) {
  if (s[start] !== '{') return null;
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (ch === '{') depth++;
    else if (ch === '}') { if (--depth === 0) return { body: s.slice(start + 1, i), end: i + 1 }; }
    else if (ch === '\\' && (s[i + 1] === '{' || s[i + 1] === '}')) i++;  // 跳过 \{ \}
  }
  return null;
}

function toScript(body, map, ch, walk, depth) {
  const t = walk(body, depth + 1);
  if (!t) return '';
  let r = '', ok = true;
  for (const c of t) { if (map[c] === undefined) { ok = false; break; } r += map[c]; }
  return ok ? r : ch + '(' + t + ')';
}

/* Unicode 数学字母转写(\mathbf 的退化方案:A-Z a-z 0-9 都有对应码位) */
function toMathAlnum(body, upper, lower, digit) {
  let r = '';
  for (const c of body) {
    const code = c.charCodeAt(0);
    if (code >= 65 && code <= 90) r += String.fromCodePoint(upper + code - 65);
    else if (code >= 97 && code <= 122) r += String.fromCodePoint(lower + code - 97);
    else if (code >= 48 && code <= 57) r += String.fromCodePoint(digit + code - 48);
    else r += c;
  }
  return r;
}
/* \mathbb 特殊一点:Unicode 里只零星收录了 7 个双线体字母(ℂℍℕℙℚℝℤ),
   其余字母没有对应码位 —— 千万别去推算偏移量,推出来的会是德文尖体。 */
const BB_MAP = { C: 'ℂ', H: 'ℍ', N: 'ℕ', P: 'ℙ', Q: 'ℚ', R: 'ℝ', Z: 'ℤ' };
const toBb = s => [].map.call(s, c => BB_MAP[c] || c).join('');
const toBf = s => toMathAlnum(s, 0x1D400, 0x1D41A, 0x1D7CE);   // 𝐀 𝐚 𝟎

function latexPlain(src) {
  // 矩阵、方程组这类环境结构太复杂,与其拼出个半成品,不如原样透出源码
  if (/\\begin\s*\{/.test(String(src))) return String(src).replace(/\s+/g, ' ').trim();

  // 只有出现运算符号 / 空格时才补括号:\frac{1}{2}->1/2,\frac{a+b}{c}->(a+b)/c
  const wrap = t => (/[\s+\-*/=<>≤≥≠±]/.test(t) && t.length > 1) ? '(' + t + ')' : t;

  function walk(s, depth) {
    if (depth > 10) return String(s);      // 防止病态嵌套把栈跑穿
    let out = '', k = 0;
    while (k < s.length) {
      const c = s[k];

      if (c === '{') {
        const g = matchBrace(s, k);
        if (g) { out += walk(g.body, depth + 1); k = g.end; continue; }
        out += c; k++; continue;
      }

      if (c === '\\') {
        const m = /^\\([a-zA-Z]+|.)/.exec(s.slice(k));
        if (!m) { k++; continue; }
        const cmd = m[1];
        const after = k + m[0].length;
        const g1 = matchBrace(s, after);

        if (LP_FRAC.indexOf(cmd) >= 0 && g1) {
          const g2 = matchBrace(s, g1.end);
          if (g2) {
            out += wrap(walk(g1.body, depth + 1)) + '/' + wrap(walk(g2.body, depth + 1));
            k = g2.end; continue;
          }
        }
        if (cmd === 'sqrt') {
          // \sqrt[3]{x}:可选的开方次数写在花括号前面,要先吃掉
          let rad = '', scan = after, g = null;
          if (s[scan] === '[') {
            const close = s.indexOf(']', scan);
            if (close > 0) { rad = walk(s.slice(scan + 1, close), depth + 1); scan = close + 1; }
          }
          g = matchBrace(s, scan);
          if (g) {
            out += (rad ? rad + '√' : '√') + wrap(walk(g.body, depth + 1));
            k = g.end; continue;
          }
        }
        if (LP_FONT.indexOf(cmd) >= 0 && g1) {
          const body = walk(g1.body, depth + 1);
          if (cmd === 'mathbb' || cmd === 'Bbb') out += toBb(body);
          else if (cmd === 'mathbf' || cmd === 'boldsymbol' || cmd === 'bm') out += toBf(body);
          else out += body;
          k = g1.end; continue;
        }
        if (LP_DROP.indexOf(cmd) >= 0) { k = after; continue; }
        if (LP_SPACE.indexOf(cmd) >= 0) { out += ' '; k = after; continue; }
        if (LP_SYMBOL[cmd]) { out += LP_SYMBOL[cmd]; k = after; continue; }
        out += cmd; k = after; continue;      // 认不出的命令:至少把反斜杠吃掉
      }

      if (c === '^' || c === '_') {
        const map = c === '^' ? SUP_MAP : SUB_MAP;
        const nxt = s[k + 1];
        if (nxt === '{') {
          const g = matchBrace(s, k + 1);
          if (g) { out += toScript(g.body, map, c, walk, depth); k = g.end; continue; }
        }
        const cm = nxt === '\\' ? /^\\([a-zA-Z]+)/.exec(s.slice(k + 1)) : null;
        if (cm) {
          const sym = LP_SYMBOL[cm[1]] || '';
          out += (sym && map[sym]) ? map[sym] : (c + (sym || cm[1]));
          k = k + 1 + cm[0].length; continue;
        }
        if (nxt && !/\s/.test(nxt)) { out += map[nxt] || (c + nxt); k += 2; continue; }
        out += c; k++; continue;
      }

      out += c; k++;
    }
    return out;
  }

  return walk(String(src ?? ''), 0).replace(/\s{2,}/g, ' ').trim();
}

