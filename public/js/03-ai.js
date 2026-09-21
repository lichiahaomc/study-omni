/* ▼ 自动生成,请勿手改本文件头 ▼
   js/03-ai.js  —— AI 后端接入 + 自定义 API(BYOK)

   本文件由 scripts/split.mjs 从 public/index.html 切出。
   ⚠️ 加载顺序在 index.html 里固定,不要调整 ——
      CSS 级联与 JS 执行都吃顺序,换了位置就会出问题。
   ===== 文件头结束(以下为原样切出的内容)=====
/* ==================== AI 后端接入 ====================
   两条运行路径:
     · 部署在 Cloudflare Pages(带 Functions) → 走 /api/chat,真实流式对话
     · 直接打开静态文件、或未配置密钥       → fetch 失败,自动降级到本地演示
   这样即便没有密钥页面也不会白屏,离线演示和 UI 调试都还能照常进行。      */
const AI = {
  history: [],        // 多轮上下文,只保留最近若干轮
  maxTurns: 12,
  backendOK: null,    // null=尚未探测  true=可用  false=降级演示
  pending: false,
  material: null,     // 最近一份素材的解析结果,每次提问都会带上
  lastResult: '',     // 中栏当前展示的解析文本(复制 / 收藏要用)
  lastSource: '',     // 来源文件名
  lastKind: '',       // 图片识别 / PDF 文本
  lastFile: null,     // 最近一次上传的 File,「重新解析」要用
  lastItem: null,     // 对应的列表项 DOM,重解析后要回写状态
  parsing: false,     // 解析进行中(防止重复触发)
};

function getSubject() {
  const el = document.getElementById('subjectLabel');
  return (el && el.textContent ? el.textContent : '数学 · 高中').trim();
}

/* ===== 用户自带的 API(BYOK) =====
   设置里可以填自己的密钥和 API 地址。

   ⚠️ 刻意**不放进 Settings 那份 state**:设置面板有「导出设置」,
   密钥一旦进了 state 就会被导出成一个 JSON 文件到处传。所以它单独存两个
   localStorage 键,和主题/字号那些设置彻底分开。

   密钥每次请求通过请求头带上去,服务端用完即弃,不落库、不回传。 */
const UserAPI = (function () {
  const KEY_STORE = 'studyomni-api-key';
  const BASE_STORE = 'studyomni-api-base';
  const read = k => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
  const write = (k, v) => {
    try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (e) {}
  };
  return {
    key: () => read(KEY_STORE),
    base: () => read(BASE_STORE),
    active: () => !!read(KEY_STORE),
    save(key, base) { write(KEY_STORE, key); write(BASE_STORE, base); },
    clear() { write(KEY_STORE, ''); write(BASE_STORE, ''); },
    /** 组请求头。没填就一个都不带,服务端走默认配置 */
    headers() {
      const h = {};
      const k = read(KEY_STORE), b = read(BASE_STORE);
      if (k) h['X-Studyomni-Key'] = k;
      if (b) h['X-Studyomni-Base'] = b;
      return h;
    }
  };
})();

/* 探测后端。GET /api/chat 是 chat.js 提供的自检接口 */
async function probeBackend() {
  if (AI.backendOK !== null) return AI.backendOK;
  try {
    const res = await fetch('/api/chat', { method: 'GET' });
    if (!res.ok) { AI.backendOK = false; return false; }
    const info = await res.json();
    // 服务端没配密钥不代表不能用 —— 用户可能自己填了一个
    AI.backendOK = !!(info && info.ok && (info.keyConfigured || UserAPI.active()));
  } catch (e) {
    AI.backendOK = false;   // file:// 或纯静态托管都会落到这里
  }
  return AI.backendOK;
}

function requestAI(question) {
  // 未接后端就沿用原来的本地演示逻辑
  return probeBackend().then(ok => ok ? realChat(question) : simulateAI(question));
}

async function realChat(question) {
  AI.pending = true;
  AI.history.push({ role: 'user', content: question });
  // 发出去的就用上面那份 history,截断只影响本地留存的上下文
  const sent = AI.history.slice();
  const keep = AI.maxTurns * 2;
  if (AI.history.length > keep) AI.history = AI.history.slice(-keep);

  const wrap = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = 'message ai';
  div.innerHTML = '<div class="avatar">AI</div>'
    + '<div class="bubble">' + typingHTML() + '</div>';
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
  const bubble = div.querySelector('.bubble');

  const st = (typeof Settings !== 'undefined' && Settings.getState) ? Settings.getState() : {};
  // 请求体先在本地组装好:重试时要用同一份,不能重算(AI.history 期间可能已变)
  const payload = {
    messages: sent,
    subject: getSubject(),       // 服务端据此生成学科 prompt
    material: AI.material,       // 已解析的素材,由服务端拼进 system
    style: st.style || 'balanced',
    // 送「档位」而不是模型名 —— 真实模型 id 由服务端映射,
    // 前端不需要(也不该)知道具体是哪几个 model
    tier: st.tier || 'fast',
    temperature: st.temperature ?? 0.3,
    maxTokens: st.maxLen || 2048,
  };

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      // 用户自带密钥时由这里带上;没填则只有 Content-Type,走服务端配置
      headers: Object.assign({ 'Content-Type': 'application/json' }, UserAPI.headers()),
      body: JSON.stringify(payload),
    });

    if (!res.ok) { failBubble(bubble, await readError(res)); return; }

    const reply = await readSSE(res, bubble, payload);
    if (reply) AI.history.push({ role: 'assistant', content: reply });
    // 回答期间用户可能切到别的栏了,给「答疑」点个未读灯
    if (reply && window.StudyTabs) window.StudyTabs.mark('chat');
  } catch (e) {
    // 连请求都没发出去(fetch 本身失败)——给条能照着排查的提示
    failBubble(bubble, (e && e.message) || String(e));
  } finally {
    AI.pending = false;
    releaseSendBtn();
  }
}

/* 等待态:三个弹跳点 + 一句会变化的说明。
   带思维链的模型在「思考」阶段不输出正文,这段时间全靠这个提示撑住观感。

   注意:三个点必须带 .dot 类,不能依赖 `.typing span` 去命中 ——
   那个后代选择器会把标签文字也当成点来排版。 */
function typingHTML(label, hint) {
  const title = hint ? ' title="' + escapeAttr(hint) + '"' : '';
  return '<div class="typing' + (label ? ' with-label' : '') + '">'
    + '<span class="dot"></span><span class="dot"></span><span class="dot"></span>'
    + (label
      ? '<span class="typing-label"' + title + '>' + escapeHtml(label)
        + '<span class="dots"></span></span>'
      : '')
    + '</div>';
}
const THINK_LABEL = '正在思考';
const THINK_HINT = '推理模型会先规划再作答,通常需要几秒到十几秒。'
  + '这段时间不会有字出现,请稍候。';
const RETRY_LABEL = '连接中断,正在重试';

/* 解析 SSE 流。每收到一段就重绘气泡,形成打字机效果。
   带重试:上游抖一下(或首字迟迟不来)就自动重开一次,
   接续时用「已收到的文本」当索引切掉重复,避免内容翻倍。

   注意 reasoning_content:DeepSeek V4 这类模型会先吐一段思维链,
   它和 content 共用一个 token 预算。只认 content 的话,一旦预算被思考吃光,
   气泡就是一片空白 —— 而且看不出到底发生了什么。所以这里把它单独记下来,
   用来区分「模型没说话」和「只思考了没来得及回答」,并给出可读的提示。 */
async function readSSE(res, bubble, body, attempt) {
  attempt = attempt || 1;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '', text = '', thinking = '', finish = '', model = '';
  let showedThinking = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();               // 末段可能截一半,留给下一轮拼

      let touched = false;
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const payload = t.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const chunk = JSON.parse(payload);
          if (chunk.model) model = chunk.model;
          const ch = chunk.choices?.[0];
          if (!ch) continue;
          if (ch.finish_reason) finish = ch.finish_reason;
          const d = ch.delta || ch.message || {};
          if (d.reasoning_content) thinking += d.reasoning_content;
          const piece = typeof d.content === 'string' ? d.content : '';
          if (piece) { text += piece; touched = true; }
        } catch (e) { /* 半包 JSON,跳过即可 */ }
      }
      if (touched) {
        showedThinking = false;
        paintBubble(bubble, text, false);
      } else if (thinking && !showedThinking) {
        // 已经在思考但正文还没来 —— 光靠弹跳点看不出进度,补一句说明
        showedThinking = true;
        bubble.innerHTML = typingHTML(THINK_LABEL, THINK_HINT);
      }
    }
  } catch (e) {
    if (shouldRetry(e, text, attempt) && body) {
      try {
        bubble.innerHTML = typingHTML(RETRY_LABEL);
        const again = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!again.ok) throw e;
        const more = await readSSE(again, bubble, body, attempt + 1);
        // more 里包含了这次重开的全部内容。若它开头的 text.length 个字符
        // 与已显示的一致,说明上游把已经吐过的内容重来了一遍,切掉重复部分。
        return (text && more.indexOf(text) === 0) ? more : text + more;
      } catch (e2) { /* 重试也失败,走下面的兜底 */ }
    }
    const tail = text ? text + '\n\n' : '';
    failBubble(bubble, tail + '**连接在生成途中断开**:' + ((e && e.message) || String(e))
      + '\n\n以上是已经收到的部分,可以直接继续追问。');
    return text;
  }

  // 空回答不该是一块看不懂的空白气泡 —— 明确告诉用户发生了什么。
  // 最常见的一种是:模型只思考了,没来得及说正文(思维链把 token 预算吃光了)。
  if (!text.trim()) {
    if (finish === 'length') {
      const words = Math.max(1, Math.round(thinking.length / 1.6));
      failBubble(bubble, '模型把这次的长度预算**全部用在思考上**了,还没开始写正文就被截断。'
        + (thinking
          ? '\n\n它已经想了约 ' + words + ' 字(这部分不显示):\n\n```\n'
            + thinking.replace(/\s+/g, ' ').slice(0, 180) + '…\n```'
          : '')
        + '\n\n**怎么解决:**\n'
        + '- 到「设置 → 最大回答长度」调大一些(默认 2048 偏小,建议 4096)\n'
        + '- 或者把问题拆小一点,比如先问一道、再问下一道\n'
        + '- 换个更直接的问法,减少模型的展开空间\n\n'
        + '（模型 ' + (model || '未知') + ' 本次返回 finish_reason=length）');
      if (typeof toast === 'function') toast('回答被截断了,建议调大最大回答长度');
      return '';
    }
    failBubble(bubble, '服务端这次没有返回任何内容(既没有正文,也没有报错)。\n\n'
      + '常见原因:① 上游模型返回了非流式响应;'
      + '② 网络中间层缓冲/截断了 SSE;'
      + '③ 提示被安全策略拦截。\n\n换一种问法再试一次通常就好了。');
    return '';
  }

  // 有正文但被截断:内容本身可读,补一句说明就好,别整块替换成报错
  paintBubble(bubble, text, true);
  if (finish === 'length') {
    const tip = document.createElement('div');
    tip.className = 'truncated-tip';
    tip.textContent = '⚠ 回答达到长度上限被截断 —— 可到「设置 → 最大回答长度」调大';
    bubble.appendChild(tip);
    if (typeof toast === 'function') toast('回答被截断了,建议调大最大回答长度');
  }
  return text;
}

/* 值不值得重试:网络类错误优先,其次是「一个字都没收到」。
   已经在流的内容不重试 —— 那多半是上游的问题,重试也白搭。 */
function shouldRetry(err, text, attempt) {
  if (attempt >= 3) return false;
  const msg = (err && err.message) || String(err || '');
  if (/Failed to fetch|NetworkError|network|terminated|AbortError|ERR_/i.test(msg)) return true;
  return !text;
}

/* 流式进行中只做转义和换行,避免半成品 markdown 反复闪烁;
   结束后再用完整渲染器重绘一遍 */
function paintBubble(bubble, text, isFinal) {
  bubble.innerHTML = isFinal ? formatText(text) : escapeHtml(text).replace(/\n/g, '<br>');
  const wrap = document.getElementById('chatMessages');
  if (wrap) wrap.scrollTop = wrap.scrollHeight;
}

async function readError(res) {
  const raw = await res.text().catch(() => '');
  try {
    const d = JSON.parse(raw);
    let msg = d.error || JSON.stringify(d);
    if (d.detail) msg += '\n' + String(d.detail).slice(0, 500);
    return msg;
  } catch {
    return 'HTTP ' + res.status + ' ' + raw.slice(0, 300);
  }
}

function failBubble(bubble, msg) {
  bubble.innerHTML = formatText(
    '**调用后端失败**\n\n```\n' + String(msg || '未知原因') + '\n```\n\n'
    + '排查顺序:① Functions 是否已随 Pages 一起部署;'
    + '② 控制台里是否配置了对应的 API Key;'
    + '③ 本地开发时 `.dev.vars` 是否已填并重启了 dev 服务。\n\n'
    + '若只是想离线演示,直接打开静态页面即可 —— 会自动走本地演示模式。'
  );
  if (typeof toast === 'function') toast('AI 调用失败');
}

// 本地演示响应(未接入后端时的降级)
function simulateAI(question) {
  const wrap = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = 'message ai';
  div.innerHTML = '<div class="avatar">AI</div>'
    + '<div class="bubble">' + typingHTML() + '</div>';
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;

  const replies = {
    '用更简单的方法讲一遍':
      '可以试试 **几何直观法** 🎨\n\n把 △ABC 画出来:已知 `b = 2` 是最长边(B 对边),`sin B = √2/2` 说明 `B = 45°`。\n\n想象一个 45° 的角,斜边为 2,那最短边就是 `2·sin 30° = 1`…… 正好对应 `a = √2` 时的 **A = 30°**。',
    '帮我举一反三,出几道类似题':
      '来 3 道同类型题,难度递进 💪\n\n**① 基础**:已知 `a = 1, b = √3, A = 30°`,求 B。\n\n**② 进阶**:已知 `a = √6, b = 2, B = 45°`,求 A。\n\n**③ 综合**:已知 `a = 1, b = 2, A = 30°`,判断三角形解的个数。\n\n需要哪道题的详细解法?',
    '这道题的知识点在考试中的重点是什么':
      '正弦定理是高考 **必考** 内容,分值约 5-12 分 📊\n\n- **小题**:直接套公式,1-2 分钟解决\n- **大题**:与三角形面积、余弦定理结合\n- **多解陷阱**:已知两边一锐角时,可能有两解\n\n⭐ 重点掌握:**边角互化** 的思维。',
    '如果 a 改为 1,结果会怎么样?':
      '好问题!让我们重新算一下 🔄\n\n代入 `a = 1`,正弦定理:\n\n```\n1 / sin A = 2 / (√2/2) = 2√2\nsin A = 1 / (2√2) = √2/4 ≈ 0.354\n```\n\n此时 `A ≈ 20.7°` 或 `A ≈ 159.3°`(两解!)\n\n💡 这就是正弦定理的 **多解陷阱** —— 需要根据 `a < b` 进一步判断取舍。'
  };

  const fallback =
    '这是个很好的延伸问题 🤔\n\n对于正弦定理题型,关键在于 **判断解的个数**:\n\n- `a > b` 时,A 唯一(锐角)\n- `a = b` 时,A = B\n- `a < b` 时可能 0/1/2 解\n\n建议先画出三角形草图辅助分析,会更直观。';

  setTimeout(() => {
    const bubble = div.querySelector('.bubble');
    bubble.innerHTML = formatText(replies[question] ?? fallback);
    wrap.scrollTop = wrap.scrollHeight;
    if (typeof releaseSendBtn === 'function') releaseSendBtn();
  }, 1100);
}

// 推荐问题
document.querySelectorAll('.suggestion-chip').forEach(chip => {
  chip.addEventListener('click', () => sendMessage(chip.dataset.q));
});

// 清空对话
function clearChat() {
  AI.history = [];                    // 上下文也要跟着清,否则旧对话会带进新提问
  const wrap = document.getElementById('chatMessages');
  wrap.innerHTML = `
    <div class="message ai">
      <div class="avatar">AI</div>
      <div class="bubble">对话已清空,有什么新问题尽管问我 😊</div>
    </div>
  `;
}

// ---- 文件上传 ----
const uploadZone = document.getElementById('uploadZone');
const fileInput = document.getElementById('fileInput');
const fileList = document.getElementById('fileList');
const fileCount = document.getElementById('fileCount');

uploadZone.addEventListener('click', () => fileInput.click());
uploadZone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});

['dragenter', 'dragover'].forEach(evt =>
  uploadZone.addEventListener(evt, e => {
    e.preventDefault();
    uploadZone.classList.add('dragover');
  })
);
['dragleave', 'drop'].forEach(evt =>
  uploadZone.addEventListener(evt, e => {
    e.preventDefault();
    uploadZone.classList.remove('dragover');
  })
);
uploadZone.addEventListener('drop', e => {
  handleFiles(e.dataTransfer.files);
});
fileInput.addEventListener('change', e => handleFiles(e.target.files));

/* ---- 演示用示例素材 ----
   现场可能没有现成的题目图片(演示机不是自己的、桌面没素材)。
   这里用 canvas **现画**一张整页习题,而不是往仓库里塞一张图 ——
   项目约束是零依赖单文件,不能多一个静态资源。

   刻意画成**整页**(上方几行正文 + 题目 + 下方几行正文)而不是只有题干:
   开着「上传图片时先裁剪」时,还能顺带把框选那一步演示出来。 */
function buildSampleFile() {
  const W = 760, H = 1040, S = 2;     // 2 倍图,文字才不糊
  const FONT = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';
  return new Promise((resolve, reject) => {
    const cv = document.createElement('canvas');
    cv.width = W * S; cv.height = H * S;
    const x = cv.getContext('2d');
    x.scale(S, S);

    // 纸张:微暖的米白 + 极淡的横格,像扫描件而不是纯色块
    x.fillStyle = '#fbfaf6';
    x.fillRect(0, 0, W, H);
    x.strokeStyle = 'rgba(148, 163, 184, .16)';
    x.lineWidth = 1;
    for (let y = 96; y < H - 40; y += 34) {
      x.beginPath(); x.moveTo(56, y); x.lineTo(W - 56, y); x.stroke();
    }

    // 页眉
    x.fillStyle = '#334155';
    x.font = '600 20px ' + FONT;
    x.fillText('数学 · 导数及其应用 · 第 3 课时', 56, 58);
    x.strokeStyle = '#cbd5e1'; x.lineWidth = 2;
    x.beginPath(); x.moveTo(56, 76); x.lineTo(W - 56, 76); x.stroke();

    // 上方正文(噪声:让"框选题目"这一步有意义)
    x.fillStyle = '#9aa7b8';
    const noise = [640, 600, 660, 560, 620];
    noise.forEach((w, i) => x.fillRect(56, 112 + i * 34, w, 9));

    // 题干
    x.fillStyle = '#1e293b';
    x.font = '600 21px ' + FONT;
    x.fillText('例 3', 56, 340);
    x.font = '21px ' + FONT;
    const stem = [
      '已知函数 f(x) = x³ − 3x² + 2。',
      '(1) 求 f(x) 的单调区间;',
      '(2) 求 f(x) 在区间 [0, 3] 上的最大值与最小值。'
    ];
    stem.forEach((line, i) => x.fillText(line, 124, 340 + i * 40));

    // 题干外面套一个浅色框,像习题册里"例题"的样式,框选时也好认
    x.strokeStyle = '#e2c98a';
    x.lineWidth = 2;
    x.strokeRect(40, 300, W - 80, 176);

    // 下方正文(噪声)
    x.fillStyle = '#9aa7b8';
    for (let i = 0; i < 9; i++) {
      x.fillRect(56, 530 + i * 34, [680, 620, 700, 580, 660, 640, 700, 560, 600][i], 9);
    }

    // 页码
    x.fillStyle = '#b6c0cd';
    x.font = '15px ' + FONT;
    x.fillText('— 42 —', W / 2 - 22, H - 20);

    cv.toBlob(blob => {
      if (!blob) { reject(new Error('示例图生成失败')); return; }
      try { resolve(new File([blob], '示例题目.png', { type: 'image/png' })); }
      catch (err) { resolve(new File([blob], 'sample.png', { type: 'image/png' })); }
    }, 'image/png');
  });
}

(function bindSample() {
  let busy = false;
  function load() {
    if (busy) return;
    busy = true;
    const btns = ['btnSample', 'btnSample2'].map(id => document.getElementById(id));
    btns.forEach(b => { if (b) b.disabled = true; });
    buildSampleFile().then(f => handleFiles([f])).catch(err => {
      toast('示例素材生成失败:' + (err && err.message ? err.message : err));
    }).then(() => {
      busy = false;
      btns.forEach(b => { if (b) b.disabled = false; });
    });
  }
  ['btnSample', 'btnSample2'].forEach(id => {
    const b = document.getElementById(id);
    if (b) b.addEventListener('click', load);
  });
})();

