/* ▼ 自动生成,请勿手改本文件头 ▼
   js/10-brand-bg.js  —— 自定义主题色 + 上传背景

   本文件由 scripts/split.mjs 从 public/index.html 切出。
   ⚠️ 加载顺序在 index.html 里固定,不要调整 ——
      CSS 级联与 JS 执行都吃顺序,换了位置就会出问题。
   ===== 文件头结束(以下为原样切出的内容)=====
/* ==================== 自定义主题色 + 上传背景 ====================
   两个弹窗共用一套浮层样式与开合逻辑。
   背景图**单独存**在 localStorage['studyomni-bg'],不混进设置 JSON ——
   一张压缩后的图动辄几百 KB,塞进去会让导出文件变得没法看。 */
(function () {
  const root = document.documentElement;
  const B = window.StudyBrand;
  const BG_KEY = 'studyomni-bg';
  const MAX_SRC = 20 * 1024 * 1024;   // 原图上限,再大就该让用户先压一下
  const MAX_STORE = 1.6 * 1024 * 1024; // 存进 localStorage 的上限(一般为 5MB)

  /* ---- 通用弹窗 ----
     onClose 回调必须走这里,不能在外面覆盖返回的 close ——
     层内的关闭按钮 / 遮罩 / Esc 都调的是闭包里那个函数,
     外挂覆盖会被绕过(取消时还原颜色因此失效,踩过一次)。 */
  function makeModal(layerId, modalId, onClose) {
    const layer = document.getElementById(layerId);
    const modal = document.getElementById(modalId);
    if (!layer) return null;
    let lastFocus = null;
    const isOpen = () => layer.classList.contains('open');
    function open() {
      lastFocus = document.activeElement;
      layer.classList.add('open');
      layer.setAttribute('aria-hidden', 'false');
      // 等过渡开始再聚焦,免得 Safari 把滚动位置带跑
      setTimeout(() => { if (modal) modal.focus(); }, 60);
    }
    function close() {
      if (onClose) onClose();
      layer.classList.remove('open');
      layer.setAttribute('aria-hidden', 'true');
      if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (err) {} }
    }
    layer.addEventListener('click', e => {
      if (e.target.closest('[data-modal-close]')) close();
    });
    layer.addEventListener('keydown', e => {
      if (e.key === 'Escape') close();
    });
    return { layer, modal, open, close, isOpen };
  }

  /* ==================== 一、自定义主题色 ==================== */
  const colorModal = makeModal('colorLayer', 'colorModal', function () {
    // 取消 / 点遮罩 / Esc 都要把预览还原 —— 否则关了弹窗颜色却留在那儿
    if (!applied && revert && window.Settings) {
      window.Settings.previewBrand(revert.brand, revert.color);
    }
  });
  const previewEl = document.getElementById('pickerPreview');
  const hexEl = document.getElementById('pickerHex');
  const noteEl = document.getElementById('pickerNote');
  const nativeEl = document.getElementById('pickerNative');
  const presetsEl = document.getElementById('pickerPresets');

  const PRESETS = ['#10b981', '#34d399', '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7',
                   '#d946ef', '#ec4899', '#f43f5e', '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16'];

  let draft = '';      // 弹窗里正在编辑的颜色
  let revert = null;   // 打开前的 { brand, color },取消时还原
  let applied = false; // 已点「应用」—— 关闭时就不要再还原了

  function normalise(v) {
    const s = String(v == null ? '' : v).trim();
    if (!s) return null;
    const withHash = s.startsWith('#') ? s : '#' + s;
    if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(withHash)) return null;
    // 统一成 6 位,后面比较和存储都用一种形态
    let hex = withHash.slice(1);
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    return '#' + hex.toLowerCase();
  }

  function paintDraft(hex, keepInput) {
    draft = hex;
    if (previewEl) previewEl.style.setProperty('--pk', hex);
    if (!keepInput && hexEl) hexEl.value = hex.toUpperCase();
    if (hexEl) hexEl.classList.remove('bad');
    if (nativeEl) nativeEl.value = hex;
    if (presetsEl) {
      presetsEl.querySelectorAll('.picker-preset').forEach(b => {
        b.setAttribute('aria-pressed', b.dataset.color === hex ? 'true' : 'false');
      });
    }
    // 实时预览:直接改 DOM 变量,不落盘(取消时要能还原)
    if (window.Settings) window.Settings.previewBrand('custom', hex);
  }

  if (colorModal) {
    if (presetsEl) {
      PRESETS.forEach(hex => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'picker-preset';
        b.dataset.color = hex;
        b.style.setProperty('--pc', hex);
        b.setAttribute('aria-pressed', 'false');
        b.setAttribute('aria-label', hex);
        b.title = hex;
        b.addEventListener('click', () => paintDraft(hex));
        presetsEl.appendChild(b);
      });
    }

    if (hexEl) {
      hexEl.addEventListener('input', () => {
        const v = normalise(hexEl.value);
        if (!v) { hexEl.classList.add('bad'); return; }
        paintDraft(v, true);
      });
      hexEl.addEventListener('blur', () => {
        // 失焦时把输入框规范成标准形态(补 #、补成 6 位)
        const v = normalise(hexEl.value);
        if (v) paintDraft(v);
      });
    }
    // 点大色块 = 打开系统取色器(带吸管的那个)
    if (previewEl) previewEl.addEventListener('click', () => { if (nativeEl) nativeEl.click(); });
    if (nativeEl) nativeEl.addEventListener('input', () => paintDraft(normalise(nativeEl.value) || draft));

    const applyBtn = document.getElementById('pickerApply');
    if (applyBtn) {
      applyBtn.addEventListener('click', () => {
        if (!window.Settings) return;
        window.Settings.setBrand('custom', draft);
        applied = true;          // 标记已应用,关闭时不要再还原
        colorModal.close();
        toast('主题色已设为 ' + draft.toUpperCase());
      });
    }

    window.StudyColorPicker = {
      open: function () {
        const st = window.Settings ? window.Settings.getState() : {};
        revert = { brand: st.brand || 'green', color: st.brandColor || '' };
        applied = false;
        // 起始颜色:已经自定义过就从上次接着调,否则从当前主色开始
        let start = (st.brand === 'custom' && st.brandColor) ? st.brandColor : '';
        if (!start) {
          const cur = getComputedStyle(root).getPropertyValue('--primary').trim();
          start = (B && B.parseHex(cur)) ? cur : '#10b981';
        }
        paintDraft(normalise(start) || '#10b981');
        colorModal.open();
      },
      close: function () { colorModal.close(); }
    };
  }

  /* ==================== 二、上传背景 ==================== */
  const bgModal = makeModal('bgLayer', 'bgModal');
  const dropEl = document.getElementById('bgDrop');
  const fileEl = document.getElementById('bgFile');
  const extractEl = document.getElementById('bgExtract');
  const dotEl = document.getElementById('bgExtractDot');
  const hexOutEl = document.getElementById('bgExtractHex');
  const statusEl = document.getElementById('bgStatus');
  const applyBtn = document.getElementById('bgApply');
  const removeBtn = document.getElementById('bgRemove');
  const descEl = document.getElementById('bgDesc');

  let pending = null;   // { dataUrl, hex } —— 弹窗里选好但还没应用

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result || ''));
      fr.onerror = () => reject(new Error('读取文件失败'));
      fr.readAsDataURL(file);
    });
  }
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('图片解码失败'));
      img.src = src;
    });
  }

  /* 取主色:缩到 48×48 后按色相分桶,取像素最多的那一桶的平均色。
     直接算全图平均值会被大面积白墙/天空带偏,分桶更接近人眼看到的"主色"。
     近白、近黑、几乎无彩色的像素跳过 —— 它们不构成"颜色"。 */
  function extractDominant(img) {
    const S = 48;
    const c = document.createElement('canvas');
    c.width = S; c.height = S;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, S, S);
    let data;
    try { data = ctx.getImageData(0, 0, S, S).data; }
    catch (err) { return null; }         // 跨域图会抛 SecurityError
    const bins = new Map();
    let total = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 125) continue;                       // 透明
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const hsl = B.rgbToHsl(r, g, b);
      if (hsl.l > 0.92 || hsl.l < 0.08) continue;            // 近白 / 近黑
      if (hsl.s < 0.14) continue;                            // 几乎无彩色
      const key = Math.floor(hsl.h / 15);                    // 24 个色相桶
      let e = bins.get(key);
      if (!e) bins.set(key, e = { n: 0, r: 0, g: 0, b: 0 });
      e.n++; e.r += r; e.g += g; e.b += b; total++;
    }
    if (!total) return null;
    let best = null;
    bins.forEach(e => { if (!best || e.n > best.n) best = e; });
    return B.toHex(best.r / best.n, best.g / best.n, best.b / best.n);
  }

  /* 压到能存进 localStorage 的尺寸。
     转 JPEG 前必须铺白底 —— 否则透明 PNG 的透明区会变成黑块。 */
  async function toBackgroundDataUrl(file) {
    const raw = await fileToDataUrl(file);
    const img = await loadImage(raw);
    const maxSide = 1600;
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    let q = 0.82;
    let out = c.toDataURL('image/jpeg', q);
    while (out.length > MAX_STORE && q > 0.5) {
      q -= 0.12;
      out = c.toDataURL('image/jpeg', q);
    }
    return { dataUrl: out, hex: extractDominant(img) };
  }

  function paintStatus() {
    const cur = localStorage.getItem(BG_KEY);
    if (statusEl) statusEl.textContent = cur ? '当前:自定义背景' : '当前:默认渐变';
    if (removeBtn) removeBtn.hidden = !cur;
    if (descEl) {
      descEl.textContent = cur
        ? '自定义背景。恢复默认会同时把主题色留在现在的自定义色上'
        : '默认渐变。上传一张图会自动把主题色换成适配它的颜色';
    }
  }

  function accept(file) {
    if (!file) return;
    if (!/^image\//.test(file.type || '')) { toast('请选择图片文件'); return; }
    if (file.size > MAX_SRC) { toast('原图太大(上限 20MB),先压缩一下再传'); return; }
    toBackgroundDataUrl(file).then(res => {
      pending = res;
      if (dropEl) {
        dropEl.classList.add('has-image');
        dropEl.innerHTML = '';
        const im = document.createElement('img');
        im.src = res.dataUrl;
        im.alt = '待应用的背景预览';
        dropEl.appendChild(im);
      }
      if (res.hex) {
        if (extractEl) extractEl.hidden = false;
        if (dotEl) dotEl.style.setProperty('--ex', res.hex);
        if (hexOutEl) hexOutEl.textContent = res.hex.toUpperCase();
      } else {
        // 灰度图之类找不到主色,主题色保持不动
        if (extractEl) extractEl.hidden = true;
        toast('这张图里没找到明显的颜色,主题色保持不变');
      }
      if (applyBtn) applyBtn.disabled = false;
    }).catch(err => {
      toast('图片处理失败:' + (err && err.message ? err.message : err));
    });
  }

  function resetDropZone() {
    pending = null;
    if (dropEl) {
      dropEl.classList.remove('has-image');
      dropEl.innerHTML =
        '<span class="bg-drop-title">点击选择一张图片</span>' +
        '<span class="bg-drop-hint">也可以拖拽进来,或直接 <kbd>Ctrl</kbd>+<kbd>V</kbd> 粘贴</span>';
    }
    if (extractEl) extractEl.hidden = true;
    if (applyBtn) applyBtn.disabled = true;
  }

  if (bgModal) {
    if (dropEl) {
      dropEl.addEventListener('click', () => { if (fileEl) fileEl.click(); });
      dropEl.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (fileEl) fileEl.click(); }
      });
    }
    if (fileEl) {
      fileEl.addEventListener('change', () => {
        accept(fileEl.files && fileEl.files[0]);
        fileEl.value = '';    // 清空才能连续选同一个文件
      });
    }
    ['dragenter', 'dragover'].forEach(ev => {
      if (dropEl) dropEl.addEventListener(ev, e => {
        e.preventDefault(); e.stopPropagation();
        dropEl.classList.add('dragover');
      });
    });
    ['dragleave', 'drop'].forEach(ev => {
      if (dropEl) dropEl.addEventListener(ev, e => {
        e.preventDefault(); e.stopPropagation();
        dropEl.classList.remove('dragover');
      });
    });
    if (dropEl) dropEl.addEventListener('drop', e => {
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) accept(f);
    });

    if (applyBtn) {
      applyBtn.addEventListener('click', () => {
        if (!pending) return;
        let stored = true;
        try { localStorage.setItem(BG_KEY, pending.dataUrl); }
        catch (err) { stored = false; }
        root.style.setProperty('--user-bg', 'url("' + pending.dataUrl + '")');
        root.setAttribute('data-bg', 'on');
        // 识别到主色就顺手把主题色换过去 —— 用户要的就是这个
        let msg = '背景已应用';
        if (pending.hex && window.Settings) {
          window.Settings.setBrand('custom', pending.hex);
          msg += ',主题色已换成 ' + pending.hex.toUpperCase();
        }
        if (!stored) msg += '(图片较大,刷新后会恢复默认背景)';
        toast(msg);
        paintStatus();
        resetDropZone();
        bgModal.close();
      });
    }
    if (removeBtn) removeBtn.addEventListener('click', () => {
      window.StudyBg.clear();
      paintStatus();
      toast('已恢复默认背景');
    });

    window.StudyBg = {
      open: function () {
        resetDropZone();
        paintStatus();
        bgModal.open();
      },
      /* 供全局粘贴处理调用:弹窗开着时优先把剪贴板图片当背景,
         否则会被"加入素材"那条逻辑抢走 */
      tryPaste: function (e) {
        if (!bgModal.isOpen()) return false;
        const all = filesFromClipboard(e.clipboardData);
        const img = all.filter(f => /^image\//.test(f.type || ''))[0];
        if (!img) { toast('剪贴板里没有图片'); return true; }
        e.preventDefault();
        accept(img);
        return true;
      },
      clear: function () {
        try { localStorage.removeItem(BG_KEY); } catch (err) {}
        root.style.removeProperty('--user-bg');
        root.removeAttribute('data-bg');
        paintStatus();
      }
    };

    const btnUpload = document.getElementById('btnUploadBg');
    if (btnUpload) btnUpload.addEventListener('click', () => window.StudyBg.open());
    const btnClear = document.getElementById('btnClearBg');
    if (btnClear) btnClear.addEventListener('click', () => {
      window.StudyBg.clear();
      toast('已恢复默认背景');
    });

    paintStatus();
  }
})();

/* ---- 设置抽屉开合 ---- */
(function () {
  const layer = document.getElementById('settingsLayer');
  const drawer = document.getElementById('settingsDrawer');
  const btn = document.getElementById('settingsBtn');
  const scrim = document.getElementById('settingsScrim');
  const closeBtn = document.getElementById('settingsClose');
  if (!layer || !btn) return;

  let lastFocus = null;

  function open() {
    lastFocus = document.activeElement;
    layer.classList.add('open');
    layer.setAttribute('aria-hidden', 'false');
    btn.setAttribute('aria-expanded', 'true');
    // 等过渡开始后再聚焦,避免 Safari 把滚动位置带跑
    setTimeout(() => drawer && drawer.focus(), 60);
    // 抽屉在关闭状态量不到宽度(clientWidth 为 0),打开后必须补一次滑块重绘,
    // 否则两个滑块的填充宽度会是错的
    setTimeout(() => {
      if (window.Settings && window.Settings.repaintRanges) window.Settings.repaintRanges();
    }, 380);   // 等抽屉的宽度过渡跑完
  }
  function close() {
    layer.classList.remove('open');
    layer.setAttribute('aria-hidden', 'true');
    btn.setAttribute('aria-expanded', 'false');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  btn.addEventListener('click', () => {
    layer.classList.contains('open') ? close() : open();
  });
  scrim && scrim.addEventListener('click', close);
  closeBtn && closeBtn.addEventListener('click', close);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && layer.classList.contains('open')) close();
  });
  // 抽屉内 Tab 循环,避免焦点跑到背后的页面上
  layer.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const focusables = drawer.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const list = [...focusables].filter(el => !el.disabled && el.offsetParent !== null);
    if (!list.length) return;
    const first = list[0], last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
})();

/* ---- 导出 / 导入 / 重置设置 ----
   导出与导入是一对:导出落成一个 JSON 文件,导入把这个文件读回来。
   注意原来只往剪贴板写 —— 那样"导出"出来的东西没法被"导入"读回来(读剪贴板
   需要额外授权, silent 场景下常被拒),两个功能根本接不上。 */
(function () {
  const exp = document.getElementById('exportSettings');
  const imp = document.getElementById('importSettings');
  const impFile = document.getElementById('importSettingsFile');
  const rst = document.getElementById('resetSettings');

  function stamp() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
           '-' + p(d.getHours()) + p(d.getMinutes());
  }

  /* 用 Blob + <a download> 落盘。返回是否成功 —— 某些内嵌 WebView
     会静默拦掉下载,这时要退回剪贴板,不能让用户点了没反应。 */
  function downloadJSON(name, text) {
    try {
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      return true;
    } catch (e) {
      return false;
    }
  }

  exp && exp.addEventListener('click', async () => {
    const data = JSON.stringify(Settings.getState(), null, 2);
    const downloaded = downloadJSON('studyomni-settings-' + stamp() + '.json', data);
    // 顺手也放一份到剪贴板:方便直接粘给同学 / 贴到 issue 里。
    // 必须走 writeClipboard —— navigator.clipboard.writeText 在无用户激活的
    // 场景里会既不 resolve 也不 reject,await 它会让按钮点了毫无反应。
    const copied = await writeClipboard(data);
    if (downloaded && copied) toast('设置已导出为 JSON 文件,并复制到剪贴板');
    else if (downloaded) toast('设置已导出为 JSON 文件');
    else if (copied) toast('下载被拦截,已改为复制到剪贴板');
    else toast('导出失败,请重试');
  });

  imp && imp.addEventListener('click', () => { impFile && impFile.click(); });

  impFile && impFile.addEventListener('change', () => {
    const f = impFile.files && impFile.files[0];
    impFile.value = '';            // 清空,否则连续导入同一个文件不会再触发 change
    if (!f) return;
    const reader = new FileReader();
    reader.onerror = () => toast('文件读取失败');
    reader.onload = () => {
      let res = null;
      try {
        res = Settings.importState(String(reader.result || ''));
      } catch (e) {
        res = null;
      }
      if (!res) { toast('不是合法的设置文件(需要 JSON)'); return; }
      if (!res.applied.length && !res.theme) {
        // 区分"文件里压根没有我们认识的键"和"键认识但值不合法" ——
        // 笼统说一句"没有可识别的设置项"会让人以为文件完全错了。
        if (res.skipped.length) toast(res.skipped.length + ' 项设置的值不合法,已忽略');
        else toast('文件里没有可识别的设置项');
        return;
      }
      // 栏宽可能变了,分隔条要重新对准
      if (window.StudyLayout && window.StudyLayout.refresh) window.StudyLayout.refresh();
      const n = res.applied.length + (res.theme ? 1 : 0);
      toast('已导入 ' + n + ' 项设置' +
            (res.skipped.length ? ',' + res.skipped.length + ' 项无效已忽略' : ''));
    };
    reader.readAsText(f);
  });

  rst && rst.addEventListener('click', () => {
    if (!confirm('确定把所有设置恢复为默认值吗?此操作不可撤销。')) return;
    Settings.reset();
    toast('已恢复默认设置');
  });
})();

/* ---- 轻量提示条 ---- */
let toastTimer = null;
function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2000);
}

