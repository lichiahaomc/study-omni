/* ▼ 自动生成,请勿手改本文件头 ▼
   js/07-tabs.js  —— 移动端底部导航

   本文件由 scripts/split.mjs 从 public/index.html 切出。
   ⚠️ 加载顺序在 index.html 里固定,不要调整 ——
      CSS 级联与 JS 执行都吃顺序,换了位置就会出问题。
   ===== 文件头结束(以下为原样切出的内容) ===== */
/* ==================== 移动端底部导航 ====================
   宽屏三栏并排,一屏看全,不需要导航;窄屏才切成"一次一栏"。
   所以这里的逻辑只管切换 class,布局全靠 CSS 媒体查询决定。 */
const Tabs = (function () {
  const KEY = 'studyomni-tab';
  const PANES = ['upload', 'result', 'chat'];
  const bar = document.getElementById('tabbar');
  if (!bar) return { show() {}, mark() {}, refresh() {}, current: () => 'upload' };

  const items = Array.from(bar.querySelectorAll('.tab-item'));
  const panels = {};
  PANES.forEach(p => { panels[p] = document.querySelector('.panel[data-pane="' + p + '"]'); });

  let current = 'upload';

  function paint(name) {
    items.forEach(it => {
      const on = it.dataset.tab === name;
      it.classList.toggle('is-active', on);
      if (on) it.setAttribute('aria-current', 'page');
      else it.removeAttribute('aria-current');
    });
    PANES.forEach(p => {
      if (panels[p]) panels[p].classList.toggle('is-active', p === name);
    });
    bar.dataset.active = name;
  }

  /* 切栏目。滚动位置不重置 —— 来回切换时保留各自的阅读位置更自然 */
  function show(name, opts) {
    if (!PANES.includes(name)) return;
    const changed = name !== current;
    current = name;
    paint(name);
    if (opts && opts.markSeen !== false) markSeen(name);
    if (name === 'chat') {
      const box = document.getElementById('chatMessages');
      if (box) box.scrollTop = box.scrollHeight;
      const input = document.getElementById('chatInput');
      if (opts && opts.focus && input) input.focus();
    }
    if (changed && opts && opts.toast) toast(opts.toast);
  }

  /* 未读小红点。人就在这个栏里的时候不点灯 —— 那是干扰 */
  function dotName(name) { return name === 'result' ? 'tabDotResult' : name === 'chat' ? 'tabDotChat' : null; }
  function mark(name) {
    if (name === current) return;
    const id = dotName(name);
    if (!id) return;
    const el = document.getElementById(id);
    const item = el && el.closest('.tab-item');
    if (item) item.classList.add('has-dot');
  }
  function markSeen(name) {
    const id = dotName(name);
    if (!id) return;
    const el = document.getElementById(id);
    const item = el && el.closest('.tab-item');
    if (item) item.classList.remove('has-dot');
  }

  /* 上传数量角标 */
  function refresh() {
    const n = (typeof fileList !== 'undefined' && fileList) ? fileList.children.length : 0;
    const el = document.getElementById('tabCountUpload');
    if (!el) return;
    el.textContent = n > 99 ? '99+' : String(n);
    const item = el.closest('.tab-item');
    if (item) item.classList.toggle('has-count', n > 0);
  }

  items.forEach(it => {
    it.addEventListener('click', () => show(it.dataset.tab));
  });

  // 记住上次看的栏目;刷新后回到原处
  try {
    const saved = localStorage.getItem(KEY);
    if (PANES.includes(saved)) { current = saved; paint(saved); }
  } catch (e) {}

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      try { if (localStorage.getItem(KEY) !== current) localStorage.setItem(KEY, current); } catch (e) {}
    }
  });

  return {
    show,
    mark,
    markSeen,
    refresh,
    current: () => current,
    /* 当前是不是手机上的"单栏模式":用媒体查询判断,和 CSS 保持同一套条件 */
    isCompact: () => window.matchMedia(
      '(max-width: 860px), (orientation: portrait) and (max-width: 1024px)'
    ).matches,
  };
})();

/* 挂到 window 上,给初始化更早的 updateFileCount() 用(见那里的注释)。
   const 声明的 Tabs 在 TDZ 里,连 typeof 都会抛错,所以只能走 window。 */
window.StudyTabs = Tabs;
Tabs.refresh();

/* 手机上"Enter 发送 · Shift+Enter 换行"这句提示既没意义也会被截断,
   窄屏换一句短的。 */
(function () {
  const ta = document.getElementById('chatInput');
  if (!ta || !window.matchMedia) return;
  const mq = window.matchMedia('(max-width: 860px)');
  const LONG = ta.placeholder;
  const SHORT = '输入你的问题...';
  const apply = () => { ta.placeholder = mq.matches ? SHORT : LONG; };
  apply();
  if (mq.addEventListener) mq.addEventListener('change', apply);
  else if (mq.addListener) mq.addListener(apply);
})();

// 每次切换都记一下,下次打开还原
(function () {
  const bar = document.getElementById('tabbar');
  if (!bar) return;
  bar.addEventListener('click', e => {
    const it = e.target.closest('.tab-item');
    if (!it) return;
    try { localStorage.setItem('studyomni-tab', it.dataset.tab); } catch (err) {}
  });
})();

