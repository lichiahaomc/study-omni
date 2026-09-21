/* ▼ 自动生成,请勿手改本文件头 ▼
   js/11-resizer.js  —— 三栏拖拽调整宽度

   本文件由 scripts/split.mjs 从 public/index.html 切出。
   ⚠️ 加载顺序在 index.html 里固定,不要调整 ——
      CSS 级联与 JS 执行都吃顺序,换了位置就会出问题。
   ===== 文件头结束(以下为原样切出的内容) ===== */
/* ==================== 三栏拖拽调整宽度 ====================
   设计要点:
   1. 只改 --col-1 / --col-3 两个 CSS 变量,中间栏用 1fr 自动吃掉剩余空间 ——
      不重排整张网格,DOM 开销最小。
   2. 手柄绝对定位,left 由 JS 按"实测列边界"写入。用实测而不是算数推导,
      是为了在 1100px 断点(列宽变 260/360)下也能对准。
   3. 拖拽用 pointer 事件统一鼠标与触摸;setPointerCapture 保证快速拖动
      移出手柄也不会丢事件。 */
(function () {
  const main = document.getElementById('mainGrid');
  if (!main) return;
  const panels = main.querySelectorAll(':scope > .panel');
  const r1 = document.getElementById('resizer1');
  const r2 = document.getElementById('resizer2');
  if (panels.length < 3 || !r1 || !r2) return;

  const MIN_SIDE = 220;   // 左右两栏最小宽度
  const MIN_MID = 300;    // 中间栏最小宽度

  function cols() { return main.querySelectorAll(':scope > .panel'); }

  /* 把两个手柄摆到对应列边界的中线上 */
  function positionResizers() {
    const cs = getComputedStyle(main);
    const gap = parseFloat(cs.columnGap) || 16;
    const mainRect = main.getBoundingClientRect();
    const list = cols();

    [r1, r2].forEach((r, i) => {
      if (!r) return;
      const left = list[i].getBoundingClientRect().right - mainRect.left;
      r.style.left = (left + gap / 2) + 'px';
    });
  }

  /* 小屏是纵向堆叠,手柄要隐藏(否则会出现无意义的分隔条) */
  function isStacked() {
    return getComputedStyle(main).gridTemplateColumns.split(' ').length < 3;
  }

  function updateVisibility() {
    const hide = isStacked();
    [r1, r2].forEach(r => { if (r) r.style.display = hide ? 'none' : ''; });
    if (!hide) positionResizers();
    // 栏宽变化会改滑块的可用宽度,填充要一起重算
    if (window.Settings && window.Settings.repaintRanges) window.Settings.repaintRanges();
  }

  function startDrag(e, which) {
    if (isStacked()) return;
    e.preventDefault();
    const list = cols();
    const rectA = list[which - 1].getBoundingClientRect();
    const rectB = list[which].getBoundingClientRect();
    const startX = e.clientX;
    const startA = rectA.width;
    const startB = rectB.width;
    const handle = which === 1 ? r1 : r2;
    const total = startA + startB;

    main.classList.add('is-resizing');
    handle.classList.add('active');
    try { handle.setPointerCapture(e.pointerId); } catch (err) {}

    function onMove(ev) {
      const dx = ev.clientX - startX;
      let a = startA + dx;
      // 双向夹紧:两栏各自不越界,且合计宽度守恒(不会把中间栏挤没)
      a = Math.max(MIN_SIDE, Math.min(total - MIN_SIDE, a));
      if (which === 1) {
        // 拖第一根:左侧栏变宽,中间栏相应变窄
        const mid = main.querySelectorAll(':scope > .panel')[1].getBoundingClientRect().width;
        const midTarget = mid - (a - startA);
        if (midTarget < MIN_MID) a = startA + (mid - MIN_MID);
        Settings.set('col1', Math.round(a));
      } else {
        // 拖第二根:右侧栏宽度 = 起始宽度 - 位移
        const right = total - a;
        Settings.set('col3', Math.round(right));
      }
      requestAnimationFrame(positionResizers);
    }

    function onUp() {
      main.classList.remove('is-resizing');
      handle.classList.remove('active');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      try { handle.releasePointerCapture(e.pointerId); } catch (err) {}
      positionResizers();
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  [[r1, 1], [r2, 2]].forEach(([handle, idx]) => {
    handle.addEventListener('pointerdown', e => startDrag(e, idx));
    // 双击恢复默认
    handle.addEventListener('dblclick', () => {
      Settings.set('col1', 300);
      Settings.set('col3', 400);
      positionResizers();
      toast('已恢复默认栏宽');
    });
    // 键盘可调:方向键微调,Home 恢复默认
    handle.addEventListener('keydown', e => {
      const step = e.shiftKey ? 40 : 12;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const dir = e.key === 'ArrowRight' ? 1 : -1;
        const st = Settings.getState();
        if (idx === 1) Settings.set('col1', Math.max(MIN_SIDE, st.col1 + dir * step));
        else Settings.set('col3', Math.max(MIN_SIDE, st.col3 - dir * step));
        positionResizers();
      } else if (e.key === 'Home') {
        e.preventDefault();
        Settings.set('col1', 300);
        Settings.set('col3', 400);
        positionResizers();
      }
    });
  });

  // 设置面板里的「恢复默认布局」按钮
  const resetBtn = document.getElementById('resetLayout');
  resetBtn && resetBtn.addEventListener('click', () => {
    Settings.set('col1', 300);
    Settings.set('col3', 400);
    positionResizers();
    toast('已恢复默认栏宽');
  });

  window.addEventListener('resize', updateVisibility);
  // 面板内容变化会影响列宽,用 ResizeObserver 兜住
  if (window.ResizeObserver) new ResizeObserver(positionResizers).observe(main);

  /* 对外只暴露"重新对准分隔条"。导入设置会改 col1 / col3,
     但 main 自身尺寸没变,ResizeObserver 不会触发,得手动叫一次。 */
  window.StudyLayout = { refresh: positionResizers };

  Settings.init();
  updateVisibility();
  initMathAuto();   // 公式渲染:接管所有后续进入 DOM 的 math-node
  // 字体 / 图标加载完再校一次位置,避免测量到未稳定的布局
  window.addEventListener('load', () => { updateVisibility(); });
  setTimeout(updateVisibility, 300);
})();

/* ---- 主题按钮:只做 浅色 <-> 深色 两态切换,永不进入"跟随系统" ---- */
(function () {
  const btn = document.getElementById('themeToggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme-mode') || 'auto';
    // 当前是"跟随系统"时,先解析出实际显现的外观,再翻到相反的一侧。
    // 这样图标只负责调明暗,同时把设置面板从"跟随系统"固化成具体的
    // 浅色 / 深色 —— 而不是点完还停在"跟随系统"上,让人以为没生效。
    const shown = cur === 'auto' ? (Settings.prefersDark() ? 'dark' : 'light') : cur;
    const next = shown === 'dark' ? 'light' : 'dark';
    // 走设置系统的统一入口:内部负责写 localStorage、设 data-theme 并同步面板
    Settings.setTheme(next);
    toast(next === 'dark' ? '主题:深色' : '主题:浅色');
  });
})();

/* ---- 设置联动到具体功能 ---- */
document.addEventListener('settingschange', e => {
  const { key } = e.detail || {};
  // 'import' 是导入设置时发的一次性事件,可能同时改了很多项
  if (key === 'maxSize' || key === 'import') {
    const hint = document.querySelector('.upload-zone .hint');
    if (hint) hint.textContent = '支持 PNG · JPG · PDF · 最大 ' + Settings.getState().maxSize + 'MB';
  }
  // 注:style / tier 不用在这里另做处理 —— sendMessage 组装请求体时直接读
  // Settings.getState(),改完下一次提问就生效。
  // 这里原先有一句 console.log 假装"请求参数已更新",但请求体里根本没带这些值。
  // 已删(同类隐患:别用日志把未生效的功能包装成已生效)。
});

