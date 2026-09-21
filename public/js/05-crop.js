/* ▼ 自动生成,请勿手改本文件头 ▼
   js/05-crop.js  —— 图片裁剪(框选题目)

   本文件由 scripts/split.mjs 从 public/index.html 切出。
   ⚠️ 加载顺序在 index.html 里固定,不要调整 ——
      CSS 级联与 JS 执行都吃顺序,换了位置就会出问题。
   ===== 文件头结束(以下为原样切出的内容)=====
/* ==================== 图片裁剪(框选题目) ====================
   选好图片后弹窗让用户框出要用的部分,确定后只把裁剪结果往下传。
   非图片(如 PDF)原样跳过;多张图排成队逐张处理,一次只弹一个窗口。

   `run(list)` 返回处理后的文件列表,交给真正入库的 commitFiles。
   三态:确定(用裁剪结果) / 原图上传(不裁) / 取消(这张及之后都不要)。 */
(function () {
  const layer = document.getElementById('cropLayer');
  const stage = document.getElementById('cropStage');
  const viewport = document.getElementById('cropViewport');
  const handlesEl = document.getElementById('cropHandles');
  const imgEl = document.getElementById('cropImg');
  const boxEl = document.getElementById('cropBox');
  const sizeEl = document.getElementById('cropSize');
  const stepEl = document.getElementById('cropStep');
  if (!layer || !stage || !viewport) return;

  const MIN = 20;        // 选框最小边长(显示像素),太小了没法拖
  const MAX_OUT = 2400;  // 出图的最长边上限,再大也是白发

  let dispW = 0, dispH = 0;    // 图片在屏幕上的尺寸
  let natW = 0, natH = 0;      // 原图尺寸
  let sel = null;              // null = 还没框选
  let drag = null;
  let settle = null;           // 当前这一张的 resolve

  const isImage = f => (f.type || '').startsWith('image/');
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const hasSel = () => !!sel && sel.w >= MIN && sel.h >= MIN;

  function paint() {
    stage.classList.toggle('is-empty', !sel);
    if (!sel) {
      if (sizeEl) sizeEl.innerHTML = '尚未框选 · 原图 ' + natW + ' × ' + natH + ' px';
      return;
    }
    // 选框与手柄层几何完全相同,只是所在的层不同(一个被视口裁剪、一个不被裁)。
    // 两者都在各自的包含块里按「padding box」定位 —— viewport 没有内边距、
    // stage 的 14px 内边距正好被绝对定位抵消,所以可以用同一组数值。
    [boxEl, handlesEl].forEach(el => {
      if (!el) return;
      el.style.left = sel.x + 'px';
      el.style.top = sel.y + 'px';
      el.style.width = sel.w + 'px';
      el.style.height = sel.h + 'px';
    });
    // 报的是「源图像素」而不是屏幕像素 —— 用户关心的是裁出来多大
    const k = natW / Math.max(1, dispW);
    if (sizeEl) {
      sizeEl.innerHTML = '选区 <b>' + Math.round(sel.w * k) + ' × ' + Math.round(sel.h * k)
        + '</b> px(原图 ' + natW + ' × ' + natH + ')';
    }
  }

  function selectAll() {
    sel = { x: 0, y: 0, w: dispW, h: dispH };
    paint();
  }

  /* 宽度换算链(一处算清,别在几处各写一个魔法数):
       .modal-layer padding 20 | .modal 边框 1 | .modal-body padding 17
       | .crop-frame padding 14 → 图片
     漏算 crop-frame 那 14px 的话,内容会比弹窗宽,底下就会冒横向滚动条(踩过)。 */
  const MODAL_MAX = 880;          // 与 CSS 的 .modal-wide 保持一致
  const CHROME = (1 + 17 + 14) * 2;   // 单侧 1+17+14=32,两侧共 64

  /* 把图片按可用空间等比铺进舞台。小图允许放大一点(最多 2 倍),
     否则在手机上一张 200px 的图根本没法框。 */
  function layout() {
    const avail = Math.min(MODAL_MAX, window.innerWidth - 40);   // 40 = layer 左右 padding
    const maxW = Math.max(160, Math.min(820, avail - CHROME));
    const maxH = Math.max(180, window.innerHeight - 300);
    const k = Math.min(maxW / natW, maxH / natH, 2);
    dispW = Math.max(1, Math.round(natW * k));
    dispH = Math.max(1, Math.round(natH * k));
    // 尺寸给到 viewport(stage 靠 fit-content 自动跟上)
    viewport.style.width = dispW + 'px';
    viewport.style.height = dispH + 'px';
    // 弹窗宽度跟着图片走 —— 竖长的题目页配一个宽弹窗,两侧会空出一大片灰
    const modalEl = document.getElementById('cropModal');
    if (modalEl) {
      const want = Math.max(380, Math.min(MODAL_MAX, dispW + CHROME));
      modalEl.style.width = 'min(' + want + 'px, 100%)';
    }
  }

  /* ---- 指针交互:空白处拖=新画,框内拖=移动,手柄拖=缩放 ---- */
  // 一律以 viewport(= 图片区域)为原点算,不是 stage —— stage 外面还包了 14px 内边距
  function local(e) {
    const r = viewport.getBoundingClientRect();
    return { x: clamp(e.clientX - r.left, 0, dispW), y: clamp(e.clientY - r.top, 0, dispH) };
  }

  stage.addEventListener('pointerdown', e => {
    if (!settle) return;                 // 没在等结果就别接事件
    const p = local(e);
    const handle = e.target.closest('.crop-h');
    if (handle) {
      drag = { mode: 'resize', h: handle.dataset.h, sx: p.x, sy: p.y, from: Object.assign({}, sel) };
    } else if (e.target.closest('.crop-box')) {
      drag = { mode: 'move', sx: p.x, sy: p.y, from: Object.assign({}, sel) };
    } else {
      drag = { mode: 'draw', sx: p.x, sy: p.y };
      sel = { x: p.x, y: p.y, w: 0, h: 0 };
      paint();
    }
    try { stage.setPointerCapture(e.pointerId); } catch (err) {}
    e.preventDefault();
  });

  stage.addEventListener('pointermove', e => {
    if (!drag) return;
    const p = local(e);
    if (drag.mode === 'draw') {
      sel.x = Math.min(drag.sx, p.x);
      sel.y = Math.min(drag.sy, p.y);
      sel.w = Math.abs(p.x - drag.sx);
      sel.h = Math.abs(p.y - drag.sy);
    } else if (drag.mode === 'move') {
      sel.x = clamp(drag.from.x + (p.x - drag.sx), 0, dispW - drag.from.w);
      sel.y = clamp(drag.from.y + (p.y - drag.sy), 0, dispH - drag.from.h);
    } else {
      // 缩放:按手柄方向改对应边,再夹住不越界、不小于 MIN
      const f = drag.from;
      let l = f.x, t = f.y, r = f.x + f.w, b = f.y + f.h;
      const h = drag.h;
      if (h.indexOf('w') >= 0) l = clamp(p.x, 0, r - MIN);
      if (h.indexOf('e') >= 0) r = clamp(p.x, l + MIN, dispW);
      if (h.indexOf('n') >= 0) t = clamp(p.y, 0, b - MIN);
      if (h.indexOf('s') >= 0) b = clamp(p.y, t + MIN, dispH);
      sel = { x: l, y: t, w: r - l, h: b - t };
    }
    paint();
    e.preventDefault();
  });

  function endDrag(e) {
    if (!drag) return;
    // 只是点了一下没真拖动 → 丢掉,回到「未框选」,免得留个 0 面积的选框
    const wasDraw = drag.mode === 'draw';
    drag = null;
    try { stage.releasePointerCapture(e.pointerId); } catch (err) {}
    if (wasDraw && !hasSel()) sel = null;
    paint();
  }
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  const allBtn = document.getElementById('cropAll');
  if (allBtn) allBtn.addEventListener('click', selectAll);

  /* ---- 出图:屏幕选区 → 原图像素 → canvas → JPEG ---- */
  function cropToFile(file) {
    return new Promise((resolve, reject) => {
      const r = cropRectOf(sel, dispW, natW, natH);
      const sx = r.sx, sy = r.sy, sw = r.sw, sh = r.sh;
      const ds = Math.min(1, MAX_OUT / Math.max(sw, sh));
      const cw = Math.max(1, Math.round(sw * ds));
      const ch = Math.max(1, Math.round(sh * ds));
      const cv = document.createElement('canvas');
      cv.width = cw; cv.height = ch;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#ffffff';          // 透明 PNG 转 JPEG 会变黑,先铺白底
      ctx.fillRect(0, 0, cw, ch);
      ctx.drawImage(imgEl, sx, sy, sw, sh, 0, 0, cw, ch);
      cv.toBlob(blob => {
        if (!blob) return reject(new Error('裁剪失败'));
        const base = (file.name || 'image').replace(/\.[^.]+$/, '') || 'image';
        try { resolve(new File([blob], base + '-裁剪.jpg', { type: 'image/jpeg' })); }
        catch (err) { resolve(blob); }     // 个别浏览器 File 构造受限,退化成 Blob
      }, 'image/jpeg', 0.92);
    });
  }

  function openFor(file, seen, total) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = () => reject(new Error('读取图片失败'));
      fr.onload = ev => {
        const probe = new Image();
        probe.onerror = () => reject(new Error('图片解码失败'));
        probe.onload = () => {
          natW = probe.naturalWidth; natH = probe.naturalHeight;
          imgEl.src = ev.target.result;
          layout();
          sel = null;                   // 每张都从「未框选」开始
          paint();
          if (stepEl) stepEl.textContent = total > 1 ? '第 ' + seen + '/' + total + ' 张' : '';
          settle = resolve;
          layer.classList.add('open');
          layer.setAttribute('aria-hidden', 'false');
          setTimeout(() => { const b = document.getElementById('cropApply'); if (b) b.focus(); }, 60);
        };
        probe.src = ev.target.result;
      };
      fr.readAsDataURL(file);
    });
  }

  function finish(action, file) {
    const r = settle;
    settle = null;
    layer.classList.remove('open');
    layer.setAttribute('aria-hidden', 'true');
    drag = null;
    if (r) r(action === 'crop' ? { action: 'crop', file: file } : { action: action, file: file });
  }

  // 取消 / 点遮罩 / Esc:这一张不要了,后面的也不再问
  layer.addEventListener('click', e => {
    if (e.target.closest('[data-modal-close]')) finish('cancel');
  });
  layer.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.stopPropagation(); finish('cancel'); }
  });
  let currentFile = null;   // 正在处理的那一张(「确定」时要按它出图)

  const applyBtn = document.getElementById('cropApply');
  if (applyBtn) applyBtn.addEventListener('click', () => {
    // 没框选就按原图走 —— 不留「确定没反应」的死角
    if (!hasSel()) { toast('未框选,已按原图上传'); finish('original'); return; }
    // 框了整张也等于没裁,别再走一遍 canvas(白损一次画质)
    const k = natW / Math.max(1, dispW);
    if (sel.x < 1 && sel.y < 1 && sel.w * k >= natW - 1 && sel.h * k >= natH - 1) {
      finish('original'); return;
    }
    cropToFile(currentFile).then(f => finish('crop', f)).catch(err => {
      toast('裁剪失败:' + (err && err.message ? err.message : err));
    });
  });
  const origBtn = document.getElementById('cropOriginal');
  if (origBtn) origBtn.addEventListener('click', () => finish('original'));

  /* ---- 批次处理:串行执行,第二次粘贴/拖拽会排在后面 ---- */
  let chain = Promise.resolve();
  function processBatch(list) {
    const images = list.filter(isImage);
    if (!images.length) return Promise.resolve(list.slice());
    const out = [];
    let seen = 0;
    return (async () => {
      for (const f of list) {
        if (!isImage(f)) { out.push(f); continue; }
        seen++;
        currentFile = f;
        const r = await openFor(f, seen, images.length);
        if (r.action === 'cancel') break;      // 放弃当前及之后,前面已定的照常返回
        out.push(r.action === 'crop' ? r.file : f);
      }
      return out;
    })();
  }

  window.StudyCrop = {
    isImage: isImage,
    run: function (list) {
      const p = chain.then(() => processBatch(list));
      chain = p.catch(() => {});
      return p;
    }
  };
})();

/* 入口:先过一遍裁剪弹窗,再把结果交给 commitFiles 入库。
   没开「上传图片时先裁剪」、整批都不是图片、或裁剪模块没起来,就直接入库。 */
function handleFiles(files) {
  const list = Array.from(files);
  if (!list.length) return;
  const st = (window.Settings && Settings.getState) ? Settings.getState() : {};
  const wantsCrop = st.cropPrompt !== false;

  if (!wantsCrop || !window.StudyCrop || !list.some(window.StudyCrop.isImage)) {
    commitFiles(list);
    return;
  }
  window.StudyCrop.run(list).then(out => {
    // 用户可能全取消了 —— 那就什么都不加,也不用切栏
    if (out.length) commitFiles(out);
  }).catch(err => {
    // 裁剪链路出任何岔子都不能把文件吞掉,退回原图入库
    console.warn('[StudyOmni] 裁剪流程异常,改为原图入库:', err);
    commitFiles(list);
  });
}

/* 真正入库:建列表项、出缩略图、按设置触发解析 */
function commitFiles(files) {
  const list = Array.from(files);
  list.forEach(file => {
    const item = document.createElement('div');
    item.className = 'file-item';
    item.innerHTML = `
      <div class="file-thumb">⏳</div>
      <div class="file-info">
        <div class="file-name">${escapeHtml(file.name)}</div>
        <div class="file-meta">
          <span class="pulse"></span>
          <span>等待处理...</span>
        </div>
      </div>
      <button class="file-remove" aria-label="移除">✕</button>
    `;
    fileList.prepend(item);
    bindRemove(item);
    updateFileCount();

    // 图片先出本地缩略图,解析结果稍后覆盖状态
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = e => {
        item.querySelector('.file-thumb').innerHTML = `<img src="${e.target.result}" alt="">`;
      };
      reader.readAsDataURL(file);
    } else {
      // PDF 没有缩略图,给个图标 —— 否则一直停在校时器上,看着像卡住了
      item.querySelector('.file-thumb').textContent = '📄';
    }

    parseFile(file, item);
  });

  // 手机上人还在「上传」栏,自动切到「解析」看进度;宽屏三栏并排,不用切
  if (list.length && window.StudyTabs && window.StudyTabs.isCompact()) {
    window.StudyTabs.show('result');
  }
}

async function parseFile(file, item) {
  const st = (typeof Settings !== 'undefined' && Settings.getState) ? Settings.getState() : {};
  if (st.autoParse === false) {
    setFileMeta(item, '已加入 · 未自动解析', true);
    return;
  }

  const isImage = file.type.startsWith('image/');
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (!isImage && !isPdf) {
    setFileMeta(item, '暂不支持该文件类型', false);
    return;
  }

  // 记下来,「重新解析」按钮要用
  AI.lastFile = file;
  AI.lastItem = item;
  AI.parsing = true;
  try {
    setFileMeta(item, isImage ? '识别题目中...' : '抽取文本中...', false);

    let body, kind = '图片识别';
    if (isImage) {
      body = { type: 'image', imageBase64: await compressImage(file), subject: getSubject() };
    } else {
      const doc = await openPdf(file);
      const r = await pdfText(doc);

      if (!looksScanned(r)) {
        // 有文本层:走便宜的纯文本通道
        kind = 'PDF 文本';
        body = { type: 'text', text: r.text, subject: getSubject() };
      } else {
        // 扫描件:没有文本层,把页面渲染成图交给视觉模型
        setFileMeta(item, '扫描件 · 渲染页面中...', false);
        const images = await pdfToImages(doc, MAX_SCAN_PAGES);
        if (!images.length) { setFileMeta(item, 'PDF 内容为空', false); return; }
        kind = 'PDF 扫描页' + (doc.numPages > images.length ? '(前 ' + images.length + ' 页)' : '');
        setFileMeta(item, 'AI 识别扫描页中...', false);
        body = { type: 'images', images, subject: getSubject() };
      }
    }

    setFileMeta(item, 'AI 解析中...', false);
    const res = await fetch('/api/parse', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, UserAPI.headers()),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await readError(res));
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || '解析失败');

    setFileMeta(item, '已解析 · ' + (data.provider || ''), true);
    AI.material = data.content;          // 之后的追问会自动带上这份素材
    AI.lastResult = data.content;
    AI.lastSource = file.name;
    AI.lastKind = kind;
    renderResult({
      content: data.content,
      subject: getSubject(),
      source: file.name,
      kind: AI.lastKind,
    });
    syncFavoriteBtn();
    if (typeof toast === 'function') toast('解析完成,可以开始追问了');
    // 手机上如果人还在「上传」栏,提示「解析」栏有结果了
    if (window.StudyTabs) window.StudyTabs.mark('result');
  } catch (e) {
    const msg = (e && e.message) || String(e);
    // 纯静态打开时没有后端,退回演示行为,不要吓用户
    if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
      setFileMeta(item, '已解析 · 演示模式', true);
      return;
    }
    setFileMeta(item, '解析失败', false);
    if (typeof toast === 'function') toast('解析失败:' + msg.slice(0, 40));
    console.error('[StudyOmni parse]', msg);
  } finally {
    AI.parsing = false;   // 无论成功、失败还是提前 return 都要复位
  }
}

