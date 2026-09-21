/* ▼ 自动生成,请勿手改本文件头 ▼
   js/08-paste.js  —— Ctrl+V 粘贴上传

   本文件由 scripts/split.mjs 从 public/index.html 切出。
   ⚠️ 加载顺序在 index.html 里固定,不要调整 ——
      CSS 级联与 JS 执行都吃顺序,换了位置就会出问题。
   ===== 文件头结束(以下为原样切出的内容)=====
/* ==================== Ctrl+V 粘贴上传 ====================
   截图工具、微信、文件管理器复制之后直接 Ctrl+V,不用先存盘再点选择文件。
   纯文本粘贴不拦截 —— 那是用户想往输入框里粘字。 */
function filesFromClipboard(dt) {
  if (!dt) return [];
  const out = [];
  const push = f => { if (f && out.indexOf(f) < 0) out.push(f); };

  // 现代浏览器:复制文件时 dt.files 直接可用
  if (dt.files && dt.files.length) {
    for (let i = 0; i < dt.files.length; i++) push(dt.files[i]);
  }
  // 兜底:截图工具往往只出现在 items 里
  if (!out.length && dt.items) {
    for (let i = 0; i < dt.items.length; i++) {
      const it = dt.items[i];
      if (it.kind !== 'file') continue;
      const f = it.getAsFile && it.getAsFile();
      push(f);
    }
  }
  return out;
}

/* 只收图片和 PDF —— 和点选择文件时的规则保持一致 */
function acceptedOnly(files) {
  const okList = [];
  let rejected = 0;
  files.forEach(f => {
    const isImg = (f.type || '').startsWith('image/');
    const isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '');
    if (isImg || isPdf) okList.push(f);
    else rejected++;
  });
  return { okList, rejected };
}

document.addEventListener('paste', e => {
  // 背景上传弹窗开着时,粘进来的图应当当背景,而不是当成学习素材加入列表
  if (window.StudyBg && window.StudyBg.tryPaste(e)) return;

  const all = filesFromClipboard(e.clipboardData);
  if (!all.length) return;              // 纯文本:放行,交给浏览器默认行为

  e.preventDefault();                   // 有文件就别再往输入框里塞东西了
  const { okList, rejected } = acceptedOnly(all);

  if (!okList.length) {
    toast('剪贴板里的内容不是图片或 PDF');
    return;
  }

  // 粘贴来的文件常常没有有意义的名字,补一个,列表里才不会显示空白
  const stamped = okList.map((f, i) => {
    const named = f.name && f.name !== 'image.png' && f.name !== 'blob';
    if (named) return f;
    const ext = (f.type || '').startsWith('image/')
      ? '.' + ((f.type || '').split('/')[1] || 'png').replace('jpeg', 'jpg')
      : '.pdf';
    const ts = new Date();
    const pad = n => String(n).padStart(2, '0');
    const label = '粘贴-' + pad(ts.getHours()) + pad(ts.getMinutes()) + pad(ts.getSeconds())
      + (okList.length > 1 ? '-' + (i + 1) : '') + ext;
    try { return new File([f], label, { type: f.type || 'image/png' }); }
    catch (err) { return f; }
  });

  handleFiles(stamped);   // 内部已负责切到「解析」栏
  toast('已从剪贴板加入 ' + stamped.length + ' 个文件'
    + (rejected ? '(' + rejected + ' 个不支持的已跳过)' : ''));
});

/* ---- 学科选择器:自定义玻璃下拉 ---- */
(function () {
  const picker  = document.getElementById('subjectPicker');
  const trigger = document.getElementById('subjectTrigger');
  const menu    = document.getElementById('subjectMenu');
  const labelEl = document.getElementById('subjectLabel');
  const badgeEl = document.getElementById('subjectBadge');
  const options = Array.from(menu.querySelectorAll('.subject-option'));
  const listEl  = document.getElementById('subjectList');
  const searchEl = document.getElementById('subjectSearch');
  const emptyEl = document.getElementById('subjectEmpty');
  const labelCountEl = document.getElementById('subjectMenuLabel');
  const groups  = listEl ? Array.from(listEl.querySelectorAll('.subject-group')) : [];
  if (!picker || !trigger || !menu) return;

  /* 标题里的学科数量按实际选项算出来 —— 以前是写死的"共 29 项",
     加了学科以后就一直是错的。搜索时顺带显示命中数,比干等更清楚。 */
  function syncLabelCount(shown) {
    if (!labelCountEl) return;
    const q = searchEl ? searchEl.value.trim() : '';
    labelCountEl.textContent = q
      ? '选择学科 · 命中 ' + shown + ' / ' + options.length
      : '选择学科 · 共 ' + options.length + ' 项';
  }

  /* ---- 搜索过滤:按学科名匹配,空结果的学段分组整组隐藏 ---- */
  function applyFilter(q) {
    const s = String(q || '').trim().toLowerCase();
    let shown = 0;
    options.forEach(o => {
      const hit = !s || o.dataset.value.toLowerCase().indexOf(s) >= 0;
      o.style.display = hit ? '' : 'none';
      if (hit) shown++;
    });
    groups.forEach(g => {
      const any = Array.from(g.querySelectorAll('.subject-option')).some(o => o.style.display !== 'none');
      g.style.display = any ? '' : 'none';
    });
    if (emptyEl) emptyEl.style.display = shown ? 'none' : '';
    syncLabelCount(shown);
  }
  // 键盘导航只在可见项之间循环,否则会跳到被过滤掉的选项上
  const visible = () => options.filter(o => o.style.display !== 'none');
  function resetFilter() {
    if (searchEl) searchEl.value = '';
    applyFilter('');
  }

  const isOpen = () => picker.classList.contains('open');

  function open() {
    picker.classList.add('open');
    trigger.setAttribute('aria-expanded', 'true');
    resetFilter();
  }
  function close() {
    picker.classList.remove('open');
    trigger.setAttribute('aria-expanded', 'false');
  }

  function select(opt) {
    options.forEach(o => {
      o.classList.remove('is-selected');
      o.setAttribute('aria-selected', 'false');
    });
    opt.classList.add('is-selected');
    opt.setAttribute('aria-selected', 'true');

    // 触发器的徽章文字与强调色跟随所选学科
    labelEl.textContent = opt.dataset.value;
    badgeEl.textContent = opt.dataset.badge;
    picker.dataset.accent = opt.dataset.accent;

    close();
    resetFilter();
    trigger.focus();

    // 不需要通知 AI 模块:每次提问会实时读取 #subjectLabel,
    // 由服务端的 buildSystemPrompt 生成对应学科的 prompt
    document.dispatchEvent(new CustomEvent('subjectchange', { detail: opt.dataset.value }));
  }

  trigger.addEventListener('click', e => {
    e.stopPropagation();
    isOpen() ? close() : open();
  });

  options.forEach(opt => opt.addEventListener('click', e => {
    e.stopPropagation();
    select(opt);
  }));

  // 点击面板外关闭
  document.addEventListener('click', e => {
    if (isOpen() && !picker.contains(e.target)) close();
  });

  // 键盘:↑↓ 移动、Enter/Space 选中、Esc 关闭、Tab 移出后关闭
  if (searchEl) {
    searchEl.addEventListener('input', () => applyFilter(searchEl.value));
    // 搜索框里按回车:直接选中当前第一个可见项
    searchEl.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const vis = visible();
        if (vis.length) { e.preventDefault(); select(vis[0]); }
      } else if (e.key === 'Escape') {
        e.stopPropagation();
        resetFilter();
      }
    });
  }
  trigger.addEventListener('keydown', e => {
    if (!isOpen() && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      open();
      const vis = visible();
      const start = vis.find(o => o.classList.contains('is-selected')) || vis[0];
      if (start) start.focus();
    }
  });
  menu.addEventListener('keydown', e => {
    const vis = visible();
    if (!vis.length) return;
    const idx = vis.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      vis[(idx + 1 + vis.length) % vis.length].focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      vis[(idx - 1 + vis.length) % vis.length].focus();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (idx >= 0) select(vis[idx]);
    } else if (e.key === 'Tab') {
      close();
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && isOpen()) {
      close();
      trigger.focus();
    }
  });

  // 初始化就把数量算出来,别等用户点开才发现标题里的数字是旧的
  applyFilter('');
})();


/* ---- 按钮果冻动效:按住时轻微挤压,拖动跟随形变,松手回弹 ---- */
(function () {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const SEL = '.icon-btn, .subject-trigger, .subject-option, .seg-item, .swatch-item, ' +
              '.send-btn, .btn, .ghost-btn, .suggestion-chip, .file-remove';
  let active = null;
  document.addEventListener('pointerdown', e => {
    if (e.button !== undefined && e.button !== 0) return;
    const el = e.target.closest(SEL);
    if (!el) return;
    active = el;
    // 按下瞬间先给一次预挤压,否则不移动指针就没有任何反馈
    el.style.setProperty('--jsx', '.94');
    el.style.setProperty('--jsy', '1.06');
    el.classList.add('is-jelly');
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const move = ev => {
      if (!active) return;
      // 指针偏离按钮中心的量,限幅后映射成轻微位移 + 旋转 + 挤压
      const dx = Math.max(-16, Math.min(16, ev.clientX - cx));
      const dy = Math.max(-16, Math.min(16, ev.clientY - cy));
      el.style.setProperty('--jx', (dx * .4).toFixed(1) + 'px');
      el.style.setProperty('--jy', (dy * .4).toFixed(1) + 'px');
      el.style.setProperty('--jr', (dx * .25).toFixed(2) + 'deg');
      const sq = (Math.abs(dx) * .005).toFixed(3);
      el.style.setProperty('--jsx', String(1 - Number(sq)));
      el.style.setProperty('--jsy', String(1 + Number(sq)));
    };
    const up = () => {
      if (!active) return;
      const el2 = active; active = null;
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', up);
      ['--jx', '--jy', '--jr', '--jsx', '--jsy'].forEach(p => el2.style.removeProperty(p));
      el2.classList.remove('is-jelly');
      el2.classList.add('is-jelly-release');
      el2.addEventListener('animationend', () => el2.classList.remove('is-jelly-release'), { once: true });
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
  });
})();

// ---- 工具函数 ----
function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 自动滚动到底部(初始)
window.addEventListener('load', () => {
  const wrap = document.getElementById('chatMessages');
  wrap.scrollTop = wrap.scrollHeight;
});

