/* ▼ 自动生成,请勿手改本文件头 ▼
   js/06-toolbar.js  —— 中栏工具栏 & 底部操作按钮(收藏 / 分享 / 示例素材)

   本文件由 scripts/split.mjs 从 public/index.html 切出。
   ⚠️ 加载顺序在 index.html 里固定,不要调整 ——
      CSS 级联与 JS 执行都吃顺序,换了位置就会出问题。
   ===== 文件头结束(以下为原样切出的内容) ===== */
/* ==================== 中栏工具栏 & 底部操作按钮 ====================
   这几个按钮以前是"有样式、没逻辑"的纯装饰 —— 演示时被点两下就露馅。
   现在每个都接上真实行为,并且在"还没有素材"时明确告诉用户原因,
   而不是毫无反应。 */

/* 带超时的复制。
   坑:clipboard.writeText() 在有些环境下**既不 resolve 也不 reject** ——
   没有用户激活、内嵌 WebView、无头浏览器都会这样。直接 await 会让按钮
   看起来彻底坏掉(点了没任何反应)。所以必须给它一个上限。 */
function writeClipboard(text, timeoutMs) {
  if (!navigator.clipboard || !navigator.clipboard.writeText) return Promise.resolve(false);
  return Promise.race([
    navigator.clipboard.writeText(text).then(() => true, () => false),
    new Promise(r => setTimeout(() => r(false), timeoutMs || 1500)),
  ]);
}

/* 复制解析结果。复制不成时退回"选中文本让用户自己 Ctrl+C",
   每一步都兜住 —— 兜底路径本身再抛异常的话,用户就彻底没反馈了。 */
async function copyResult() {
  const text = AI.lastResult;
  if (!text) { toast('还没有解析结果可复制'); return; }
  if (await writeClipboard(text)) { toast('解析结果已复制到剪贴板'); return; }

  const card = document.querySelector('#resultContent .problem-card');
  // window.getSelection() 可能返回 null(无选区能力的上下文),必须判空
  const sel = window.getSelection ? window.getSelection() : null;
  if (card && sel) {
    try {
      const range = document.createRange();
      range.selectNodeContents(card);
      sel.removeAllRanges();
      sel.addRange(range);
      toast('已选中文本,按 Ctrl+C 复制');
      return;
    } catch (e2) { /* 选区 API 也不可用,继续往下兜底 */ }
  }
  toast('复制失败,请手动选择文本');
}

/* 重新解析最近一次上传的文件(识别不准时最有用) */
function reparse() {
  if (!AI.lastFile) { toast('还没有上传过素材'); return; }
  if (AI.parsing) { toast('正在解析中,请稍候'); return; }
  if (!AI.lastItem || !document.contains(AI.lastItem)) {
    toast('对应的文件已被移除,请重新上传');
    return;
  }
  toast('正在重新解析...');
  parseFile(AI.lastFile, AI.lastItem);
}

/* 收藏:存进 localStorage。查看收藏夹的界面还没做,
   但数据是真的存下来的,不会丢。 */
const FAV_KEY = 'studyomni-favorites';
function readFavorites() {
  try {
    const raw = localStorage.getItem(FAV_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}
/* 去重键就用内容本身。
   ⚠️ 原来是 `学科|内容`,结果是:从收藏夹把题目载回中栏时,
   当前学科跟当初收藏时选的学科对不上 → 按钮明明该显示"已收藏"却显示未收藏,
   而且再点一下还会存出一条重复。题目内容本身就足以标识一道题。 */
function favIndexOf(list, content) {
  return list.findIndex(f => f.content === content);
}
function isFavorited() {
  if (!AI.lastResult) return false;
  return favIndexOf(readFavorites(), AI.lastResult) >= 0;
}
function syncFavoriteBtn() {
  const btn = document.getElementById('btnFavorite');
  if (!btn) return;
  const on = isFavorited();
  // 用 innerHTML 而不是 textContent:图标要包在 .btn-i 里,窄屏才有得藏
  btn.innerHTML = '<span class="btn-i" aria-hidden="true">' + (on ? '✅' : '📌') + '</span>'
    + (on ? '已收藏' : '收藏题目');
  btn.classList.toggle('is-on', on);
}
function toggleFavorite() {
  if (!AI.lastResult) { toast('还没有解析结果可收藏'); return; }
  let list = readFavorites();
  const at = favIndexOf(list, AI.lastResult);
  if (at >= 0) {
    list.splice(at, 1);
    toast('已取消收藏');
  } else {
    list.push({ subject: getSubject(), content: AI.lastResult, source: AI.lastSource, at: Date.now() });
    list = list.slice(-50);          // 只留最近 50 条,别把 localStorage 撑爆
    toast('已收藏(共 ' + list.length + ' 题)');
  }
  saveFavorites(list);
  syncFavoriteBtn();
  syncFavBadge();
}

/* ---- 收藏夹查看界面 ----
   数据本来就真存着(最多 50 条),之前只是没有地方看 ——
   点「收藏题目」只弹一句"已收藏(共 N 题)",像个半截功能。
   这里补上:列表、点一条载回中栏、单条删除、清空。 */
function saveFavorites(list) {
  try { localStorage.setItem(FAV_KEY, JSON.stringify(list)); } catch (e) {}
}

function fmtFavTime(ts) {
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  const ymd = (d.getFullYear() === new Date().getFullYear() ? '' : d.getFullYear() + '-')
    + p(d.getMonth() + 1) + '-' + p(d.getDate());
  return ymd + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

function syncFavBadge() {
  const badge = document.getElementById('favBadge');
  if (!badge) return;
  const n = readFavorites().length;
  badge.textContent = n;
  badge.hidden = n === 0;
}

function renderFavList() {
  const box = document.getElementById('favList');
  if (!box) return;
  const arr = readFavorites();
  syncFavBadge();
  if (!arr.length) {
    box.innerHTML = '<div class="fav-empty">还没有收藏。<br>'
      + '解析完一道题后点「📌 收藏题目」,就会出现在这里。</div>';
    return;
  }
  // 新的排前面。用**下标**做标识而不是 key —— key 里含任意正文,
  // 塞进 HTML 属性还得处理引号转义,不划算。
  box.innerHTML = arr.map((f, i) => ({ f, i })).reverse().map(({ f, i }) => `
    <div class="fav-item" data-i="${i}" role="button" tabindex="0">
      <div class="fav-meta">
        <span class="fav-subject">${escapeHtml(f.subject || '未分类')}</span>
        <span class="fav-time">${escapeHtml(fmtFavTime(f.at || Date.now()))}</span>
      </div>
      <div class="fav-text">${escapeHtml(String(f.content || '').replace(/\s+/g, ' ').slice(0, 120))}</div>
      <button class="fav-del" data-del="${i}" aria-label="删除这条收藏" title="删除">✕</button>
    </div>`).join('');
}

/* 开合放在顶层:loadFavorite 要用 closeFav,
   写在 initFavList 的闭包里就调不到了(踩过:直接报 ReferenceError) */
function openFav() {
  const layer = document.getElementById('favLayer');
  if (!layer) return;
  renderFavList();
  layer.classList.add('open');
  layer.setAttribute('aria-hidden', 'false');
  setTimeout(() => { const m = document.getElementById('favModal'); if (m) m.focus(); }, 60);
}
function closeFav() {
  const layer = document.getElementById('favLayer');
  if (!layer) return;
  layer.classList.remove('open');
  layer.setAttribute('aria-hidden', 'true');
}

/* 把收藏的题目载回中栏,并同步「收藏 / 复制 / 分享」的指向 */
function loadFavorite(f) {
  if (!f) return;
  AI.lastResult = f.content;
  AI.lastSource = f.source || '收藏夹';
  AI.lastKind = '收藏';
  renderResult({ content: f.content, subject: f.subject, source: AI.lastSource, kind: '收藏' });
  syncFavoriteBtn();
  closeFav();
  if (window.StudyTabs && StudyTabs.isCompact() && StudyTabs.isCompact()) StudyTabs.show('result');
  toast('已载入收藏的题目');
}

(function initFavList() {
  const layer = document.getElementById('favLayer');
  const box = document.getElementById('favList');
  if (!layer || !box) return;

  layer.addEventListener('click', e => {
    if (e.target.closest('[data-modal-close]')) { closeFav(); return; }
    const del = e.target.closest('[data-del]');
    if (del) {
      e.stopPropagation();
      const arr = readFavorites();
      arr.splice(Number(del.dataset.del), 1);
      saveFavorites(arr);
      renderFavList();
      syncFavoriteBtn();
      toast('已删除');
      return;
    }
    const item = e.target.closest('.fav-item');
    if (item) loadFavorite(readFavorites()[Number(item.dataset.i)]);
  });
  layer.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.stopPropagation(); closeFav(); return; }
    // 列表项是 role=button,要能用键盘打开
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('fav-item')) {
      e.preventDefault();
      loadFavorite(readFavorites()[Number(e.target.dataset.i)]);
    }
  });

  const btn = document.getElementById('btnFavList');
  if (btn) btn.addEventListener('click', openFav);
  const clear = document.getElementById('favClear');
  if (clear) clear.addEventListener('click', () => {
    if (!readFavorites().length) { toast('收藏夹已经是空的'); return; }
    if (!confirm('确定清空全部收藏?此操作不可撤销。')) return;
    saveFavorites([]);
    renderFavList();
    syncFavoriteBtn();
    toast('收藏夹已清空');
  });

  syncFavBadge();
})();

/* 分享:优先用系统分享面板(移动端),桌面上退回复制链接 */
async function sharePage() {
  const url = location.href;
  const data = { title: 'StudyOmni · 多模态教学智能体', text: '上传题目图片即可获得即时讲解', url };
  if (navigator.share) {
    try { await navigator.share(data); return; } catch (e) { /* 用户取消或不可用,继续走复制 */ }
  }
  if (await writeClipboard(url)) { toast('页面链接已复制'); return; }
  toast('复制失败,请手动复制地址栏链接');
}

/* 「开始答疑」:把焦点送到输入框。这是个导航按钮,不该什么都不做。
   手机上它还得负责切栏 —— 输入框在「答疑」栏里,不切过去根本看不到。 */
function focusAsk() {
  if (window.StudyTabs && window.StudyTabs.isCompact()) window.StudyTabs.show('chat');
  const input = document.getElementById('chatInput');
  if (!input) return;
  input.focus();
  const box = document.getElementById('chatMessages');
  if (box) box.scrollTop = box.scrollHeight;
  if (!AI.lastResult) toast('先上传一道题,或者在下面直接问我');
}

/* 把上面这些接到按钮上。缺了某个元素也不报错,只是少接一个 */
(function bindResultActions() {
  const on = (id, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', fn);
  };
  on('btnCopyResult', copyResult);
  on('btnReparse', reparse);
  on('btnFavorite', toggleFavorite);
  on('btnShare', sharePage);
  on('btnAsk', focusAsk);
})();

/* 把解析结果渲染到中栏,并关掉空态 */
function renderResult({ content, subject, source, kind }) {
  const box = document.getElementById('resultContent');
  const empty = document.getElementById('emptyState');
  if (!box) return;
  if (empty) empty.style.display = 'none';

  const tag = t => `<span class="meta-tag"><span class="dot"></span>${escapeHtml(t)}</span>`;
  box.innerHTML = `
    <div class="meta-row">
      <span class="meta-tag primary"><span class="dot"></span>${escapeHtml(subject)}</span>
      ${tag(kind)}
      ${tag(source)}
    </div>
    <div class="result-section">
      <h5>解析结果</h5>
      <div class="problem-card">${formatText(content)}</div>
    </div>
  `;
  box.classList.add('active');
}

function bindRemove(item) {
  item.querySelector('.file-remove').addEventListener('click', () => {
    item.style.transition = 'all .2s';
    item.style.opacity = '0';
    item.style.transform = 'translateX(20px)';
    setTimeout(() => {
      item.remove();
      updateFileCount();
      // 移除的正是最近解析的那个文件 -> 断掉「重新解析」的指向
      if (AI.lastItem === item) { AI.lastItem = null; AI.lastFile = null; }
    }, 200);
  });
}

document.querySelectorAll('.file-item').forEach(bindRemove);

function updateFileCount() {
  fileCount.textContent = fileList.children.length;
  // 顺手同步底部导航上的数量角标。
  // 注意这里必须用 window.StudyTabs 而不是直接引 Tabs —— 初始化时
  // updateFileCount() 会先跑,那时 const Tabs 还在暂时性死区,直接引用会抛 ReferenceError。
  if (window.StudyTabs) window.StudyTabs.refresh();
}
// 初始化时对一次账:HTML 里写的数字只是占位,真实数量以实际列表为准
updateFileCount();

function clearFiles() {
  fileList.innerHTML = '';
  updateFileCount();
  // 素材没了,上下文和中栏都要回到初始状态
  AI.material = null;
  AI.history = [];
  // 解析相关的记录一并清掉,否则「重新解析」会指向一个已不存在的文件
  AI.lastResult = '';
  AI.lastSource = '';
  AI.lastKind = '';
  AI.lastFile = null;
  AI.lastItem = null;
  const box = document.getElementById('resultContent');
  const empty = document.getElementById('emptyState');
  if (box) { box.classList.remove('active'); box.innerHTML = ''; }
  if (empty) empty.style.display = '';
  syncFavoriteBtn();
}

