/* ▼ 自动生成,请勿手改本文件头 ▼
   js/04-parse.js  —— 素材解析(图片 / PDF 文本 / 扫描件)

   本文件由 scripts/split.mjs 从 public/index.html 切出。
   ⚠️ 加载顺序在 index.html 里固定,不要调整 ——
      CSS 级联与 JS 执行都吃顺序,换了位置就会出问题。
   ===== 文件头结束(以下为原样切出的内容)=====
/* ==================== 素材解析 ==================== */

function setFileMeta(item, text, done) {
  const meta = item.querySelector('.file-meta');
  if (!meta) return;
  meta.classList.toggle('done', !!done);
  const span = meta.querySelector('span:last-child');
  if (span) span.textContent = text;
}

/* 图片压缩:按最长边等比缩放后转 JPEG。
   手机拍的题目照片动辄 4~6MB,base64 还要再膨胀 33%,
   不压很容易顶到 Workers 的请求体上限。 */
function compressImage(file, maxSide = 1600, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.onload = e => {
      const img = new Image();
      img.onerror = () => reject(new Error('图片解码失败'));
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const ctx = cv.getContext('2d');
        ctx.fillStyle = '#ffffff';            // 透明 PNG 转 JPEG 会变黑,先铺白底
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(cv.toDataURL('image/jpeg', quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

/* PDF:按需从 CDN 取 pdf.js 抽文本。
   平时完全不加载,不破坏"零依赖";只有真的传了 PDF 才联网取一次。 */
let pdfJsPromise = null;
function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (pdfJsPromise) return pdfJsPromise;
  pdfJsPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/pdfjs-dist/build/pdf.min.js';
    s.onload = () => {
      const lib = window.pdfjsLib;
      if (!lib) return reject(new Error('pdf.js 加载异常'));
      lib.GlobalWorkerOptions.workerSrc =
        'https://cdn.jsdelivr.net/npm/pdfjs-dist/build/pdf.worker.min.js';
      resolve(lib);
    };
    s.onerror = () => reject(new Error('无法加载 pdf.js(可能处于离线状态)'));
    document.head.appendChild(s);
  });
  return pdfJsPromise;
}

/* ---- PDF:两条路 ----
   ① 有文本层的电子版 → 直接抽文字,便宜又快
   ② 扫描件(整页是图片,没有文本层)→ 把页面渲染成图,交给视觉模型
   ②这条是演示最容易翻车的地方:真实的卷子/课本扫描件极多,
   以前遇到就直接放弃,现在兜住了。 */
const MAX_PDF_TEXT_PAGES = 20;   // 抽文本最多看这么多页,别把整本书塞进 prompt
const MAX_SCAN_PAGES = 3;        // 扫描件最多渲染这么多页(每页都是一次视觉调用)
const SCAN_CHARS_PER_PAGE = 30;  // 每页平均字数低于这个值,就判定为扫描件

async function openPdf(file) {
  const lib = await loadPdfJs();
  return lib.getDocument({ data: await file.arrayBuffer() }).promise;
}

/* 抽文本层。除了正文,还返回字数,用来判断是不是扫描件 */
async function pdfText(doc, maxPages) {
  const n = Math.min(doc.numPages, maxPages || MAX_PDF_TEXT_PAGES);
  let text = '', chars = 0;
  for (let i = 1; i <= n; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    const s = tc.items.map(it => it.str).join(' ');
    chars += s.replace(/\s/g, '').length;
    text += s + '\n';
  }
  return { text: text.trim(), chars, readPages: n, totalPages: doc.numPages };
}

/* 把前几页渲染成 JPEG dataURL。
   2 倍缩放是为了让小字号的题目也清晰;超过 1600px 再缩回去,
   和 compressImage 的上限保持一致,免得顶到请求体限制。 */
async function pdfToImages(doc, maxPages) {
  const n = Math.min(doc.numPages, maxPages || MAX_SCAN_PAGES);
  const out = [];
  for (let i = 1; i <= n; i++) {
    const page = await doc.getPage(i);
    let vp = page.getViewport({ scale: 2 });
    const maxSide = Math.max(vp.width, vp.height);
    if (maxSide > 1600) vp = page.getViewport({ scale: 2 * 1600 / maxSide });

    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(vp.width));
    cv.height = Math.max(1, Math.round(vp.height));
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#ffffff';           // 有些页面是透明的,不铺白底会变黑
    ctx.fillRect(0, 0, cv.width, cv.height);
    // 同时给 canvas 和 canvasContext:不同 pdf.js 大版本取的名字不一样
    await page.render({ canvas: cv, canvasContext: ctx, viewport: vp }).promise;
    out.push(cv.toDataURL('image/jpeg', 0.85));
  }
  return out;
}

/* 判定:每页平均字数太少 → 没有可用的文本层 */
function looksScanned(r) {
  if (!r.chars) return true;
  return r.chars / Math.max(1, r.readPages) < SCAN_CHARS_PER_PAGE;
}

/* 屏幕上的选区 → 源图像素矩形(带夹取)。
   抽成顶层纯函数是为了能在 Node 里单测 —— 这段映射一旦算错,
   裁出来的图就会整体偏移、或者右边多出半条边。
   `sel` 是相对图片左上角的显示坐标,`dispW` 是图片在屏幕上的宽度。 */
function cropRectOf(sel, dispW, natW, natH) {
  const k = natW / Math.max(1, dispW);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  // 起点和终点**各自**换算完再相减,而不是分别取整起点与尺寸 ——
  // 后者两边各舍一次,合起来会凭空少掉 1px(用户框到哪儿就该裁到哪儿)。
  // 顺序也有讲究:先把起点夹进 [0, natW-1],终点再夹到 [起点+1, natW],
  // 这样宽高天然 ≥1、右边界也绝不会越出源图。
  const sx = clamp(Math.round(sel.x * k), 0, Math.max(0, natW - 1));
  const ex = clamp(Math.round((sel.x + sel.w) * k), sx + 1, natW);
  const sy = clamp(Math.round(sel.y * k), 0, Math.max(0, natH - 1));
  const ey = clamp(Math.round((sel.y + sel.h) * k), sy + 1, natH);
  return { sx: sx, sy: sy, sw: ex - sx, sh: ey - sy };
}

