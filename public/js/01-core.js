/* ▼ 自动生成,请勿手改本文件头 ▼
   js/01-core.js  —— 通用交互逻辑(转义 / 主题切换 / 开关等)

   本文件由 scripts/split.mjs 从 public/index.html 切出。
   ⚠️ 加载顺序在 index.html 里固定,不要调整 ——
      CSS 级联与 JS 执行都吃顺序,换了位置就会出问题。
   ===== 文件头结束(以下为原样切出的内容) ===== */
/* ==================== 交互逻辑 ==================== */

// ---- Chat 输入 ----
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');

chatInput.addEventListener('input', () => {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
  sendBtn.disabled = chatInput.value.trim().length === 0;
});

chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

/* 注意必须包一层箭头函数:sendMessage 的第一个参数是「预设问题文本」,
   直接把函数名当监听器传,点击时 preset 会变成 MouseEvent 对象,
   `preset.trim()` 抛 TypeError —— 表现就是「点发送按钮毫无反应」,
   只有按回车能用。 */
sendBtn.addEventListener('click', () => sendMessage());

function sendMessage(preset) {
  // preset 只在「点建议芯片」时是字符串;正常情况下取输入框的值。
  // 再加一道类型判断,避免以后又有人把事件对象当文本传进来。
  const content = (typeof preset === 'string' ? preset : chatInput.value).trim();
  if (!content) return;
  if (AI.pending) return;                 // 正在作答时不接受新的提问
  appendMessage('user', content);
  chatInput.value = '';
  chatInput.style.height = 'auto';
  sendBtn.disabled = true;
  requestAI(content);
}

/* 作答结束后把发送键恢复成「取决于输入框里有没有字」 */
function releaseSendBtn() {
  sendBtn.disabled = chatInput.value.trim().length === 0;
}

function appendMessage(role, text) {
  const wrap = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = `message ${role}`;
  div.innerHTML = `
    <div class="avatar">${role === 'user' ? 'U' : 'AI'}</div>
    <div class="bubble">${formatText(text)}</div>
  `;
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
}

/* 渲染 AI/用户消息文本。
   安全策略:先整体转义,再只放行白名单语法 —— 即便文本里混入 <script> 也只会显示成文字。
   顺序很关键:必须先转义、后应用 markdown,否则会被反注入。

   支持的语法:
     **粗体**    `行内代码`
     ```fenced 代码块(可多行)```
     ### 标题 / - 无序列表 / 1. 有序列表 / --- 分隔线
     连续文本中的换行 -> <br>(不包在代码块里的部分) */
/* LaTeX 定界符。四条分支按优先级排列 ——
   $$...$$ 必须排在 $...$ 前面,否则会先被当成两个空的行内公式吃掉。 */
const MATH_RE = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$([^$\n]+?)\$/g;

/* 渲染 AI/用户消息文本。
   安全策略:只有本函数自己产出的 HTML 标签会放行,文本一律先转义 ——
   即便文本里混进 <script> 也只会原样显示成文字。

   管线顺序是关键:
     ① 先把"不该被 markdown 碰"的东西抠出来囤着(代码块 / 行内代码 / 公式)
        否则 $x^*_i$ 里的 * 会被当成斜体、代码块里的 $ 会被当成公式
     ② 其余部分整体转义
     ③ 再放行白名单里的 markdown 语法
     ④ 最后把囤好的东西原样塞回去

   支持: **粗体** · `行内代码` · ```代码块``` · 标题 / 列表 / 分隔线
        $行内公式$ · $$独立公式$$ · \(...\) · \[...\]          */
function formatText(text) {
  let out = String(text ?? '');

  /* ---- ① 提存:代码块 ---- */
  const blocks = [];
  out = out.replace(/```([\s\S]*?)```/g, (_, body) => {
    const code = escapeHtml(body.replace(/^\r?\n|\r?\n$/g, ''));
    const i = blocks.push('<pre class="code-block"><code>' + code + '</code></pre>') - 1;
    return '\u0000BLOCK' + i + '\u0000';
  });

  /* ---- ① 提存:行内代码 ---- */
  const icodes = [];
  out = out.replace(/`([^`\n]+)`/g, (_, body) => {
    const i = icodes.push('<code>' + escapeHtml(body) + '</code>') - 1;
    return '\u0000ICODE' + i + '\u0000';
  });

  /* ---- ① 提存:公式 ---- */
  const maths = [];
  const stashMath = (tex, display) =>
    '\u0000MATH' + (maths.push({ tex: String(tex).trim(), display: !!display }) - 1) + '\u0000';
  out = out.replace(MATH_RE, (whole, dd, brack, paren, inline) => {
    if (dd !== undefined) return stashMath(dd, true);
    if (brack !== undefined) return stashMath(brack, true);
    if (paren !== undefined) return stashMath(paren, false);
    // $...$ —— 排掉 "$ 100"、空内容、首尾带空格这类跟公式无关的美元符号。
    // ⚠️ 以前"纯数字"也一律当金额放过,结果数学讲解里常见的 $0$ / $2$ / $12$
    //    全成了字面文本 —— 列函数值的表格里尤其刺眼。
    //    现在只放过**长得像金额**的:带千分位逗号或小数点的($1,200$ / $99.99$)。
    //    光杆整数按公式处理,KaTeX 渲染出来就是数字本身,视觉上无害。
    if (inline === undefined || !inline.trim() || /^\s|\s$/.test(inline)
        || /^[\d\s]*[.,][\d\s.,]*$/.test(inline)) return whole;
    return stashMath(inline, false);
  });

  /* ---- ① 提存:表格 ----
     ⚠️ 必须在"按空行切段"之前做 —— 否则表格会被拆成好几个段落,
        渲染出来就是截图里那样:每行一条、管道符原样露着。
     ⚠️ 收集数据行时**不能看见空行就收工** —— 模型写表格时行间经常夹空行。
        遇到空行先往后看一行,还是表行就继续。 */
  const tables = [];
  out = (function extractTables(src) {
    const lines = src.split('\n');
    const isRow = l => /^\s*\|.*\|\s*$/.test(l) && (l.match(/\|/g) || []).length >= 2;
    // 分隔行:|---|---| / |:--|--:|,由 | - : 空白组成,且至少要有一处连续两个短横。
    // ⚠️ 别在这里加 `!isRow(l)` 那种排除 —— 分隔行本来就长得像表行,一排就把
    //    正常表格全拦掉了(踩过:表格一个都识别不出来)。
    //    它够特殊(只允许 | - : 空白),不会被普通数据行误撞。
    const isSep = l => /^\s*\|?[\s:|-]+\|?\s*$/.test(l) && /-{2,}/.test(l);
    const keep = [];
    for (let i = 0; i < lines.length; i++) {
      if (!isRow(lines[i])) { keep.push(lines[i]); continue; }
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;          // 表头与分隔行之间可能夹空行
      if (j >= lines.length || !isSep(lines[j])) { keep.push(lines[i]); continue; }

      const rows = [lines[i]];
      let k = j + 1;
      while (k < lines.length) {
        if (isRow(lines[k])) { rows.push(lines[k]); k++; continue; }
        if (!lines[k].trim()) {
          let m = k + 1;
          while (m < lines.length && !lines[m].trim()) m++;
          if (m < lines.length && isRow(lines[m])) { k = m; continue; }
        }
        break;
      }
      const idx = tables.push(renderTable(rows, lines[j])) - 1;
      // 前后各留一个空行,保证它独占一段 —— 否则会被包进 <p> 里
      keep.push('', '\u0000TABLE' + idx + '\u0000', '');
      i = k - 1;
    }
    return keep.join('\n');
  })(out);

  /* ---- ② 转义 ---- */
  out = out.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  /* ---- ③ 块级语法:按空行切段,逐段判断列表 / 标题 / 分隔线 / 普通段落 ---- */
  out = out.split(/\n{2,}/).map(chunk => {
    const lines = chunk.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) return '';
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(lines[0]) && lines.length === 1) return '<hr>';
    if (lines.every(l => /^<hr>$/.test(l))) return '<hr>';

    // 无序列表
    if (lines.every(l => /^[-*+]\s+/.test(l))) {
      return '<ul>' + lines.map(l => '<li>' + l.replace(/^[-*+]\s+/, '') + '</li>').join('') + '</ul>';
    }
    // 有序列表
    if (lines.every(l => /^\d+[.)]\s+/.test(l))) {
      return '<ol>' + lines.map(l => '<li>' + l.replace(/^\d+[.)]\s+/, '') + '</li>').join('') + '</ol>';
    }
    // 标题(### / ## / #)
    const h = lines[0].match(/^(#{1,4})\s+(.+)$/);
    if (h && lines.length === 1) {
      const lv = Math.min(h[1].length + 2, 6);
      return '<h' + lv + ' class="bubble-h">' + h[2] + '</h' + lv + '>';
    }
    // 普通段落:段内换行保留为 <br>,让"每行一条"的排版不塌
    return '<p class="bubble-p">' + lines.join('<br>') + '</p>';
  }).join('');

  /* ---- ③ 行内语法(此时已全部转义,可安全替换) ---- */
  out = applyInline(out);

  /* ---- ④ 回填 ----
     <pre> / 独立公式都是块级元素,不能包在 <p> 里 —— HTML 解析器遇到
     <p><pre> 会提前闭合 <p>,凭空多出一个空段落。所以先把"整段只有一个
     特殊节点"的 <p> 壳拆掉,再回填内容。 */
  out = out.replace(/<p class="bubble-p">((?:\u0000(?:BLOCK|ICODE|MATH|TABLE)\d+\u0000)+)<\/p>/g, '$1');
  /* ⚠️ TABLE 必须**排在最前**:表格 HTML 是在①里就拼好的,里面还嵌着
     MATH / ICODE 的占位符 —— 得先把表格铺开,后面那两条替换才够得着它们。
     第一版把 TABLE 放在最后,结果单元格里的公式原样漏成了 \u0000MATH0\u0000。 */
  out = out
    .replace(/\u0000TABLE(\d+)\u0000/g, (_, i) => tables[+i])
    .replace(/\u0000ICODE(\d+)\u0000/g, (_, i) => icodes[+i])
    .replace(/\u0000MATH(\d+)\u0000/g, (_, i) => mathTag(maths[+i]))
    .replace(/\u0000BLOCK(\d+)\u0000/g, (_, i) => blocks[+i]);
  return out;
}

/* 行内语法:粗体 / 斜体。抽成函数是因为**两处要用** ——
   正文在 ③ 里跑一遍,表格单元格在①拼 HTML 时就跑过了(它到不了 ③)。
   写两份迟早只改一处,所以在这里统一。入参必须是**已转义**的文本。 */
function applyInline(s) {
  return String(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
}

/* 把 markdown 表格渲染成 <table>。
   两个约束:
     · 外面套一层可横向滚动的容器 —— 列多的公式表格在窄栏里放不下,
       宁可让表格自己滚,也不能把整个页面撑宽(踩过横向滚动条的坑)。
     · 单元格内容此时还**没转义**,所以在这里补齐;
       公式 / 行内代码的占位符(全是 \u0000+字母数字)不受 escapeHtml 影响,能安全穿过。 */
function renderTable(rows, sepLine) {
  const split = row => {
    let s = row.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|')) s = s.slice(0, -1);
    return s.split('|').map(c => c.trim());
  };
  // 对齐只看分隔行:`:---` 左、`---:` 右、`:---:` 居中
  const aligns = split(sepLine).map(c => {
    const l = c.startsWith(':'), r = c.endsWith(':');
    return l && r ? 'tc' : r ? 'tr' : l ? 'tl' : '';
  });
  const head = split(rows[0]);
  // 单元格走的是「先转义、再套行内语法」——和正文同样的顺序,
  // 而且共用 applyInline,规则只有一份。
  const cell = (tag, txt, i) =>
    '<' + tag + (aligns[i] ? ' class="' + aligns[i] + '"' : '') + '>'
    + applyInline(escapeHtml(txt)) + '</' + tag + '>';
  const thead = '<tr>' + head.map((c, i) => cell('th', c, i)).join('') + '</tr>';
  const tbody = rows.slice(1)
    .map(r => { const cs = split(r); return '<tr>' + head.map((_, i) => cell('td', cs[i] ?? '', i)).join('') + '</tr>'; })
    .join('');
  return '<div class="md-table-wrap"><table class="md-table"><thead>' + thead
    + '</thead><tbody>' + tbody + '</tbody></table></div>';
}

/* 把公式做成占位节点:
   data-tex 存原始 TeX(后面异步升级用),标签里先放一份"纯文本兜底" ——
   这样 KaTeX 还没加载完、或者离线拿不到 CDN 的时候,用户看到的也不是源码。 */
function mathTag(m) {
  return '<span class="math-node" data-display="' + (m.display ? '1' : '0') +
    '" data-tex="' + escapeAttr(m.tex) + '">' + escapeHtml(latexPlain(m.tex)) + '</span>';
}

function escapeAttr(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

