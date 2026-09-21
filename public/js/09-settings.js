/* ▼ 自动生成,请勿手改本文件头 ▼
   js/09-settings.js  —— 设置中心

   本文件由 scripts/split.mjs 从 public/index.html 切出。
   ⚠️ 加载顺序在 index.html 里固定,不要调整 ——
      CSS 级联与 JS 执行都吃顺序,换了位置就会出问题。
   ===== 文件头结束(以下为原样切出的内容) ===== */
/* ==================== 设置中心 ====================
   所有偏好存两份:
     localStorage['studyomni-theme']    主题(单独存,便于 <head> 里同步读取防 FOUC)
     localStorage['studyomni-settings'] 其余偏好(JSON,便于整体导出 / 重置)
   改任何一个都走 saveSettings(),保证持久化不会漏。 */
const Settings = (function () {
  const THEME_KEY = 'studyomni-theme';
  const DATA_KEY = 'studyomni-settings';
  const root = document.documentElement;

  const DEFAULTS = {
    // brand 是内置六套之一;选了自定义色时 brand === 'custom',
    // 具体颜色存在 brandColor 里(两者配套,缺一就回退到 green)
    brand: 'green',
    brandColor: '',
    fontSize: 14,
    density: 'comfortable',
    motion: 'on',
    // 档位名(不是模型名)。真实模型 id 由服务端映射 —— 见 providers.js 的 TIERS
    tier: 'fast',
    style: 'balanced',
    temperature: 0.3,
    maxLen: 2048,
    autoParse: true,
    // 上传图片时是否先弹裁剪窗。关掉后所有图片都按原图上传
    cropPrompt: true,
    latex: true,
    maxSize: 10,
    col1: 300,
    col3: 400
  };

  const TIER_DESC = {
    fast: '响应最快、成本最低,适合日常问答与连续追问',
    deep: '推理更强,适合数学推导与多步讲解;实测明显更慢'
  };
  const TIERS = Object.keys(TIER_DESC);

  const BRANDS = ['green', 'indigo', 'blue', 'violet', 'rose', 'cyan'];
  let state = Object.assign({}, DEFAULTS);
  let theme = 'auto';

  /* 颜色统一收敛成 6 位小写。手写的 #abc / #AABBCC / 大小写混写都归一,
     否则导出文件里会出现好几种写法,来回导入还会漂移。
     非法值一律清空(由 apply() 兜回内置主题)。 */
  function canonColor(v) {
    if (!window.StudyBrand) return v;
    const c = window.StudyBrand.parseHex(v);
    return c ? window.StudyBrand.toHex(c.r, c.g, c.b) : '';
  }

  function readJSON() {
    try {
      const raw = localStorage.getItem(DATA_KEY);
      // 只认 DEFAULTS 里声明过的键。老版本存下的废弃键(比如已经删掉的
      // 假功能开关)不该被 Object.assign 悄悄带进来。
      if (raw) {
        const saved = JSON.parse(raw);
        Object.keys(DEFAULTS).forEach(k => {
          if (saved[k] !== undefined) state[k] = saved[k];
        });
        state.brandColor = canonColor(state.brandColor);
      }
    } catch (e) {}
    try {
      const t = localStorage.getItem(THEME_KEY);
      if (t === 'light' || t === 'dark' || t === 'auto') theme = t;
    } catch (e) {}
  }

  function saveSettings() {
    try { localStorage.setItem(DATA_KEY, JSON.stringify(state)); } catch (e) {}
  }
  function saveTheme() {
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
  }

  const prefersDark = () =>
    !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);

  /* ---- 应用:把 state 落到 DOM 上 ---- */
  function applyTheme() {
    const dark = theme === 'dark' || (theme === 'auto' && prefersDark());
    if (dark) root.setAttribute('data-theme', 'dark');
    else root.removeAttribute('data-theme');
    root.setAttribute('data-theme-mode', theme);
    syncSeg('segTheme', theme);
  }

  function apply() {
    root.style.setProperty('--font-scale', (state.fontSize / 14).toFixed(4));
    if (state.density === 'compact') root.setAttribute('data-density', 'compact');
    else root.removeAttribute('data-density');
    if (state.motion === 'off') root.setAttribute('data-motion', 'off');
    else root.removeAttribute('data-motion');
    // 品牌:内置六套走 CSS 规则;自定义色要算出整套 --primary* 变量。
    // 用 head 里定义好的 StudyBrand,避免配色数学在两处各写一遍。
    if (state.brand === 'custom') {
      // 自定义色必须有效,缺了或格式不对就退回绿色 —— 否则整套变量都没值,页面会失色
      if (!window.StudyBrand || !window.StudyBrand.vars(state.brandColor)) {
        state.brand = 'green';
        state.brandColor = '';
      }
    } else if (BRANDS.indexOf(state.brand) < 0) {
      state.brand = 'green';
    }
    if (window.StudyBrand) window.StudyBrand.apply(root, state.brand, state.brandColor);
    else root.setAttribute('data-brand', state.brand);
    setBrandSwatch();
    // 旧版本存的是 'omni-pro' 这类已废弃的档位名,或者导入的文件里写了别的值 ——
    // 兜回默认档,否则界面会没有任何一项选中
    if (TIERS.indexOf(state.tier) < 0) state.tier = DEFAULTS.tier;

    root.style.setProperty('--col-1', state.col1 + 'px');
    root.style.setProperty('--col-3', state.col3 + 'px');

    // 回填控件
    setRange('fontSize', state.fontSize, 'fontSizeOut');
    setRange('temperature', state.temperature.toFixed(1), 'tempOut');
    setRange('maxLen', state.maxLen, 'maxLenOut');
    setSeg('segDensity', state.density);
    setSeg('segMotion', state.motion);
    setSeg('segModel', state.tier);
    setSeg('segStyle', state.style);
    setSeg('segMaxSize', String(state.maxSize));
    setSwatch('swatchBrand', state.brand);
    setSwitch('swAutoParse', state.autoParse);
    setSwitch('swCropPrompt', state.cropPrompt);
    setSwitch('swLatex', state.latex);
    root.setAttribute('data-latex', state.latex ? 'on' : 'off');

    const md = document.getElementById('modelDesc');
    if (md) md.textContent = TIER_DESC[state.tier] || '';
    const c1 = document.getElementById('col1Out');
    const c3 = document.getElementById('col3Out');
    if (c1) c1.textContent = state.col1;
    if (c3) c3.textContent = state.col3;
  }
  /* 把进度填充宽度算出来写进 --fill。
     不能直接用百分比:原生 range 的拇指中心在两端时会往里收半个拇指宽
     (即可用行程 ≈ 宽度 - 拇指宽),若按 0~100% 线性铺,填充的末端
     会和拇指中心差最多 7~8px —— 拖到底时最明显。
     所以按"拇指中心的实际位置"插值,填充就永远咬住拇指。 */
  function paintRange(el) {
    if (!el) return;
    const min = Number(el.min || 0);
    const max = Number(el.max || 100);
    const val = Number(el.value);
    const w = el.clientWidth || 152;
    const cs = getComputedStyle(el);
    const thumb = parseFloat(cs.getPropertyValue('--thumb-size')) || 15;
    const usable = Math.max(0, w - thumb);
    const ratio = max === min ? 0 : (val - min) / (max - min);
    const fill = thumb / 2 + usable * Math.min(1, Math.max(0, ratio));
    el.style.setProperty('--fill', fill.toFixed(2) + 'px');
  }

  function setRange(id, val, outId) {
    const el = document.getElementById(id);
    if (el) el.value = val;
    paintRange(el);
    const out = document.getElementById(outId);
    if (out) out.textContent = val;
  }
  function setSeg(groupId, val) {
    const g = document.getElementById(groupId);
    if (!g) return;
    g.querySelectorAll('.seg-item').forEach(b => {
      b.setAttribute('aria-checked', b.dataset.value === val ? 'true' : 'false');
    });
  }
  const syncSeg = setSeg;
  function setSwitch(id, val) {
    const el = document.getElementById(id);
    if (el) el.setAttribute('aria-checked', val ? 'true' : 'false');
  }
  function setSwatch(groupId, val) {
    const g = document.getElementById(groupId);
    if (!g) return;
    g.querySelectorAll('.swatch-item').forEach(b => {
      b.setAttribute('aria-checked', b.dataset.value === val ? 'true' : 'false');
    });
  }
  /* 主题色那一排:六个预设 + 一个「更多」。
     「更多」的圆点要显示当前自定义色,没选过就留彩虹渐变(见 CSS 的 --sw 兜底)。 */
  function setBrandSwatch() {
    setSwatch('swatchBrand', state.brand);
    const more = document.getElementById('swatchMore');
    if (!more) return;
    if (state.brand === 'custom' && state.brandColor) more.style.setProperty('--sw', state.brandColor);
    else more.style.removeProperty('--sw');
    const desc = document.getElementById('brandDesc');
    if (desc) {
      desc.textContent = state.brand === 'custom'
        ? '自定义 ' + state.brandColor.toUpperCase()
        : '界面与光晕的强调色,默认绿色';
    }
  }

  /* ---- 绑定:分段控件(事件委托,后续加选项不用改 JS) ---- */
  function bindSeg(groupId, key, onApply) {
    const g = document.getElementById(groupId);
    if (!g) return;
    g.addEventListener('click', e => {
      const btn = e.target.closest('.seg-item');
      if (!btn) return;
      const val = btn.dataset.value;
      if (key === 'theme') { theme = val; saveTheme(); applyTheme(); }
      else {
        // 数值型字段(如 maxSize)要转回数字,否则后面比较会踩坑
        state[key] = /^\d+$/.test(val) && typeof DEFAULTS[key] === 'number' ? Number(val) : val;
        saveSettings();
        apply();
      }
      if (onApply) onApply(val);
      root.dispatchEvent(new CustomEvent('settingschange', { bubbles: true, detail:{ key, value: val, state: getState() } }));
    });
    // 键盘:左右箭头在组内移动
    g.addEventListener('keydown', e => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      const items = [...g.querySelectorAll('.seg-item')];
      const i = items.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      items[(i + 1) % items.length].focus();
    });
  }

  function bindRange(id, key, outId, transform) {
    const el = document.getElementById(id);
    if (!el) return;
    // 拖动期间关掉填充的过渡,松手再恢复 —— 否则填充永远慢半拍追着拇指跑
    el.addEventListener('pointerdown', () => el.classList.add('is-dragging'));
    ['pointerup', 'pointercancel', 'blur'].forEach(ev =>
      el.addEventListener(ev, () => el.classList.remove('is-dragging')));
    el.addEventListener('input', () => {
      const raw = transform ? transform(el.value) : Number(el.value);
      state[key] = raw;
      const out = document.getElementById(outId);
      if (out) out.textContent = typeof raw === 'number' ? (key === 'temperature' ? raw.toFixed(1) : raw) : raw;
      apply();
      saveSettings();
      root.dispatchEvent(new CustomEvent('settingschange', { bubbles: true, detail:{ key, value: raw, state: getState() } }));
    });
  }

  function bindSwitch(id, key) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('click', () => {
      state[key] = !state[key];
      apply();
      saveSettings();
      root.dispatchEvent(new CustomEvent('settingschange', { bubbles: true, detail:{ key, value: state[key], state: getState() } }));
    });
  }

  /* 主题色色板:点击换色,方向键在色板内移动焦点 */
  function bindSwatches(groupId, key) {
    const g = document.getElementById(groupId);
    if (!g) return;
    g.addEventListener('click', e => {
      const btn = e.target.closest('.swatch-item');
      if (!btn) return;
      // 「更多」不是直接选色,而是打开取色器 —— 真正的赋值在弹窗里做
      if (btn.dataset.value === 'custom' && key === 'brand') {
        if (window.StudyColorPicker) window.StudyColorPicker.open();
        return;
      }
      state[key] = btn.dataset.value;
      // 切回内置主题时把自定义色清掉,免得下次再选 custom 时冒出旧颜色
      if (key === 'brand') state.brandColor = '';
      saveSettings();
      apply();
      root.dispatchEvent(new CustomEvent('settingschange', { bubbles: true, detail:{ key, value: btn.dataset.value, state: getState() } }));
    });
    g.addEventListener('keydown', e => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      const items = [...g.querySelectorAll('.swatch-item')];
      const i = items.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      // 左/上往回退,右/下往前进,符合方向直觉
      const back = (e.key === 'ArrowLeft' || e.key === 'ArrowUp');
      items[(i + (back ? items.length - 1 : 1)) % items.length].focus();
    });
  }

  /* ---- 自定义 API(BYOK) ----
     密钥不进 state,所以这里直接读写那两个独立的 localStorage 键。
     前端只做"形态检查"给即时反馈;真正的管束在服务端(resolveUserEndpoint),
     那边拒绝的地址会静默回落到默认端点。 */
  function bindUserAPI() {
    const keyEl = document.getElementById('apiKeyInput');
    const baseEl = document.getElementById('apiBaseInput');
    const descEl = document.getElementById('apiModeDesc');
    const tipEl = document.getElementById('apiState');
    if (!keyEl || !baseEl) return;

    /* 只填域名时补上对话路径 —— 否则会把请求 POST 到站点根路径拿 404 */
    const DEFAULT_PATH = '/chat/completions';

    function normBase(raw) {
      if (!raw) return { ok: true, value: '' };
      let u;
      try { u = new URL(raw); } catch { return { ok: false, why: 'API 地址格式不对' }; }
      if (u.protocol !== 'https:') return { ok: false, why: 'API 地址必须是 https' };
      if (u.username || u.password) return { ok: false, why: 'API 地址不能带账号密码' };
      if (u.search || u.hash) return { ok: false, why: 'API 地址不能带查询串' };
      if (!u.pathname || u.pathname === '/') u.pathname = DEFAULT_PATH;
      return { ok: true, value: u.toString().replace(/\/+$/, '') };
    }

    function refresh(saved) {
      const has = UserAPI.active();
      keyEl.value = UserAPI.key();
      baseEl.value = UserAPI.base();
      if (descEl) {
        descEl.textContent = has
          ? (UserAPI.base() ? '使用你填写的密钥与 API 地址' : '使用你填写的密钥(地址仍是官方)')
          : '当前使用服务端配置的密钥';
      }
      if (tipEl) {
        tipEl.textContent = saved || (has ? '已生效' : '');
        tipEl.hidden = !tipEl.textContent;
      }
    }

    function save() {
      const b = normBase(baseEl.value.trim());
      if (!b.ok) { toast(b.why); return; }
      const k = keyEl.value.trim();
      UserAPI.save(k, b.value);
      baseEl.value = b.value;
      AI.backendOK = null;      // 探测结论作废,下次请求重新判断
      refresh('已保存');
      toast(k ? '已启用自定义 API' : '已恢复默认 API');
    }

    function reset() {
      keyEl.value = '';
      baseEl.value = '';
      UserAPI.clear();
      AI.backendOK = null;
      refresh('已恢复默认');
      toast('已恢复默认 API');
    }

    const onEnter = e => { if (e.key === 'Enter') { e.preventDefault(); save(); } };
    keyEl.addEventListener('keydown', onEnter);
    baseEl.addEventListener('keydown', onEnter);
    const saveBtn = document.getElementById('apiSave');
    if (saveBtn) saveBtn.addEventListener('click', save);
    const resetBtn = document.getElementById('apiReset');
    if (resetBtn) resetBtn.addEventListener('click', reset);
    refresh('');
  }

  function getState() { return Object.assign({}, state, { theme: theme }); }

  function repaintRanges() {
    document.querySelectorAll('.range').forEach(paintRange);
  }

  /* ---- 导入:逐项校验 ----
     外部 JSON 一律当不可信输入处理:
       1. 只认 DEFAULTS 里声明过的键(+ 单独存的 theme),多余字段直接忽略 ——
          万一导出的文件里混进了别的站点的键,不会被写进 localStorage。
       2. 每个键都要过取值范围。手改坏的 JSON(比如 fontSize: 999、
          brand: "evil")不该把页面搞成白屏,直接跳过并在结果里报告。
       3. 数字字段可能是字符串(分段控件的 data-value 就是 "10"),
          先按数字形态转回来再校验。 */
  const RULES = {
    // brand 可以是内置六套之一,也可以是 'custom'(配 brandColor 用)
    brand:        v => v === 'custom' || BRANDS.indexOf(v) >= 0,
    brandColor:   v => typeof v === 'string' && (v === '' || /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim())),
    fontSize:     v => typeof v === 'number' && v >= 12 && v <= 18,
    density:      v => v === 'comfortable' || v === 'compact',
    motion:       v => v === 'on' || v === 'off',
    tier:         v => TIERS.indexOf(v) >= 0,
    style:        v => v === 'concise' || v === 'balanced' || v === 'step',
    temperature:  v => typeof v === 'number' && v >= 0 && v <= 1,
    maxLen:       v => typeof v === 'number' && v >= 256 && v <= 8192,
    autoParse:    v => typeof v === 'boolean',
    cropPrompt:   v => typeof v === 'boolean',
    latex:        v => typeof v === 'boolean',
    maxSize:      v => v === 5 || v === 10 || v === 20,
    col1:         v => typeof v === 'number' && v >= 220 && v <= 700,
    col3:         v => typeof v === 'number' && v >= 220 && v <= 700
  };

  function importState(text) {
    let obj;
    try { obj = JSON.parse(text); } catch (e) { return null; }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;

    const applied = [], skipped = [];
    Object.keys(DEFAULTS).forEach(k => {
      if (obj[k] === undefined) return;
      let v = obj[k];
      if (typeof DEFAULTS[k] === 'number' && typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) {
        v = Number(v);
      }
      const ok = RULES[k] ? RULES[k](v) : typeof v === typeof DEFAULTS[k];
      if (!ok) { skipped.push(k); return; }
      state[k] = v;
      applied.push(k);
    });

    // theme 不在 DEFAULTS 里(它单独存一份),单独处理
    let themeOk = false;
    if (obj.theme === 'light' || obj.theme === 'dark' || obj.theme === 'auto') {
      theme = obj.theme;
      saveTheme();
      themeOk = true;
    }

    // 规范化要在 saveSettings **之前**做 —— 否则存下去的还是原始写法,
    // 下次导出的文件就又变成另一种形态(踩过:saveSettings 在 apply 之前)
    state.brandColor = canonColor(state.brandColor);

    if (applied.length) saveSettings();
    applyTheme();
    apply();
    root.dispatchEvent(new CustomEvent('settingschange', {
      bubbles: true,
      detail: { key: 'import', value: applied, state: getState() }
    }));
    return { applied: applied, skipped: skipped, theme: themeOk };
  }

  function init() {
    readJSON();
    applyTheme();
    apply();

    bindSeg('segTheme', 'theme');
    bindSeg('segDensity', 'density');
    bindSeg('segMotion', 'motion');
    bindSeg('segModel', 'tier');
    bindSeg('segStyle', 'style');
    bindSeg('segMaxSize', 'maxSize');
    bindRange('fontSize', 'fontSize', 'fontSizeOut');
    bindRange('temperature', 'temperature', 'tempOut', v => Number(Number(v).toFixed(1)));
    bindRange('maxLen', 'maxLen', 'maxLenOut');
    bindSwitch('swAutoParse', 'autoParse');
    bindSwitch('swCropPrompt', 'cropPrompt');
    bindSwitch('swLatex', 'latex');
    bindSwatches('swatchBrand', 'brand');
    bindUserAPI();

    // 跟随系统主题变化(仅 auto 模式生效)
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (theme === 'auto') applyTheme();
      });
    }

    /* 窗口尺寸变了,滑块的行程也跟着变,填充必须重算。
       用一个 resize 监听兜住所有宽度变化(拖分隔条改栏宽也会触发)。 */
    let rzTick = null;
    window.addEventListener('resize', () => {
      clearTimeout(rzTick);
      rzTick = setTimeout(repaintRanges, 80);
    });

    // 字体加载完尺寸可能还会抖一下,再补一次
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => repaintRanges()).catch(() => {});
    }
  }

  return {
    init, getState, apply, importState,
    repaintRanges,
    defaults: function () { return Object.assign({}, DEFAULTS); },
    prefersDark,
    /* 主题统一入口。主页图标和设置面板都走这里,避免两套逻辑各改一半 */
    setTheme: function (val) {
      if (val !== 'light' && val !== 'dark' && val !== 'auto') return;
      theme = val;
      saveTheme();
      applyTheme();
    },
    set: function (key, val) {
      state[key] = val;
      saveSettings();
      apply();
    },
    /* 设置主题色。brand 传 'custom' 时 colour 必须是合法十六进制;
       传内置名时 colour 留空。由取色器 / 背景上传调用。 */
    setBrand: function (brand, colour) {
      state.brand = brand;
      state.brandColor = brand === 'custom' ? canonColor(colour) : '';
      saveSettings();
      apply();
      root.dispatchEvent(new CustomEvent('settingschange', {
        bubbles: true, detail: { key: 'brand', value: brand, state: getState() }
      }));
    },
    /* 只改 DOM 不落盘 —— 取色器拖动时做实时预览用 */
    previewBrand: function (brand, colour) {
      if (window.StudyBrand) window.StudyBrand.apply(root, brand, colour);
    },
    reset: function () {
      state = Object.assign({}, DEFAULTS);
      theme = 'auto';
      saveSettings();
      saveTheme();
      applyTheme();
      apply();
      // 背景图单独存,也要一起清掉
      if (window.StudyBg) window.StudyBg.clear();
    },
    isDark: function () {
      return root.getAttribute('data-theme') === 'dark';
    }
  };
})();
/* 顶层 `const Settings = ...` **不会**自动挂到 window 上,
   别的模块写 `window.Settings` 会拿到 undefined(踩过一次:
   取色器的实时预览与"应用"因此全部静默失效)。这里显式挂出去。 */
window.Settings = Settings;

