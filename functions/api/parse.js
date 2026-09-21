/**
 * POST /api/parse —— 素材解析(多模态入口)
 *
 * 支持三种输入:
 *   type: 'image'     题目照片。交给视觉模型识别并还原成可追问的题干
 *   type: 'images'    多页扫描件。一次传多张,让模型串起来理解
 *   type: 'text'      PDF / 截图里抽出来的纯文本。让模型提炼关键信息
 *
 * 这里走非流式 —— 解析是一次性结果,不需要打字机效果。
 */

import {
  json, clamp, resolveModel, resolveMaxTokens, callUpstream, readText, PROVIDER,
  resolveUserKey, resolveUserEndpoint,
} from '../_lib/providers.js';
import { buildSystemPrompt } from '../_lib/prompts.js';
import { checkRateLimit, tooManyResponse, sameOrigin } from '../_lib/ratelimit.js';

/* base64 长度上限:约 4MB。再大就该让前端先压缩了 */
const MAX_IMAGE_CHARS = 4 * 1024 * 1024;
/* 多页扫描件:页数少,总量可以放宽一点 */
const MAX_IMAGES = 3;
const MAX_IMAGES_TOTAL_CHARS = 6 * 1024 * 1024;
const MAX_TEXT_CHARS = 60000;

/* 视觉调用单次成本明显高于纯文本,而且解析是「一次上传一次调用」,
   不存在需要连续快速调用的场景 —— 所以窗口比 chat 收得更紧。 */
const PARSE_PER_MIN = 6;

const IMAGE_TASK =
  '请仔细识别这张图片里的内容。若是一道题目,请:\n' +
  '1. 完整还原题干(不要遗漏下标、符号、单位等细节);\n' +
  '2. 标明已知条件与所求;\n' +
  '3. 简述它考查的知识点;\n' +
  '4. 不要直接给出完整解答 —— 用户会随后追问;\n' +
  '若图片不是题目(如笔记、图表、文档),请描述其内容要点。';

/* 扫描件是渲染出来的页面,可能带页眉页脚、页码、相邻题的残留,所以要多叮嘱两句 */
const SCAN_TASK =
  '这些图片是同一份扫描文档按顺序渲染出来的页面(第 1 张是第 1 页)。请:\n' +
  '1. 判断主要内容是什么(题目 / 讲义 / 笔记 / 图表);\n' +
  '2. 若有题目,完整还原题干 —— 不要遗漏下标、符号、单位;\n' +
  '3. 忽略页眉、页脚、页码、水印这类与内容无关的噪声;\n' +
  '4. 若某处文字被裁断或不清晰,标注出来而不是猜测;\n' +
  '5. 不要直接给出完整解答 —— 用户会随后追问。';

const TEXT_TASK =
  '下面是从用户上传的材料中提取的文本。请:\n' +
  '1. 概括核心内容;\n' +
  '2. 列出关键概念、公式或知识点;\n' +
  '3. 指出可能存在疑问或需要补充的地方。';

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request, env)) {
    return json({ error: '不允许跨站调用', hint: '本接口只服务于 StudyOmni 自身的页面' }, 403);
  }
  // 用一份独立的限额:视觉调用更贵,不应该和文字提问抢额度
  const gate = checkRateLimit(request, env, 'parse');
  if (!gate.ok) return tooManyResponse(gate, { limitPerMinute: PARSE_PER_MIN });

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: '请求体不是合法 JSON' }, 400);
  }

  // 与 chat.js 一致:允许用户带自己的密钥/地址(BYOK),都过同一套校验。
  // 校验不通过就静默回落到服务端配置,不报错。
  const userKey = resolveUserKey(request.headers.get('X-Studyomni-Key'));
  const userEndpoint = resolveUserEndpoint(request.headers.get('X-Studyomni-Base'));
  const apiKey = userKey || env[PROVIDER.keyEnv];
  if (!apiKey) {
    return json({
      error: `服务端未配置 ${PROVIDER.keyEnv},也没有填自定义 API`,
      hint: '可以点右上角齿轮 → 「自定义 API」填入你自己的密钥',
    }, 500);
  }

  /* 识图固定走支持视觉的那个模型,与用户选的档位无关 ——
     实测把图片喂给 deepseek-v4-pro 会空转到 finish_reason=length,
     正文一个字都不出。这里由输入类型决定,不让用户选。 */
  const visionModel = resolveModel(env, 'vision');

  const type = ['text', 'images'].includes(payload.type) ? payload.type : 'image';
  let userContent;

  /* 前端可能只给裸 base64,统一成 data URL */
  const toDataUrl = (raw, mime) =>
    raw.startsWith('data:') ? raw : `data:${mime || 'image/jpeg'};base64,${raw}`;

  if (type === 'image') {
    const raw = String(payload.imageBase64 || '').trim();
    if (!raw) return json({ error: '缺少 imageBase64' }, 400);
    if (raw.length > MAX_IMAGE_CHARS) {
      return json({
        error: '图片过大,请前端先压缩到 3MB 以内再上传',
        received: Math.round(raw.length / 1024) + ' KB',
      }, 413);
    }

    userContent = [
      { type: 'text', text: payload.prompt || IMAGE_TASK },
      { type: 'image_url', image_url: { url: toDataUrl(raw, payload.mimeType), detail: 'high' } },
    ];
  } else if (type === 'images') {
    const list = (Array.isArray(payload.images) ? payload.images : [])
      .map(s => String(s || '').trim()).filter(Boolean);
    if (!list.length) return json({ error: '缺少 images' }, 400);

    const kept = list.slice(0, MAX_IMAGES);
    const total = kept.reduce((n, s) => n + s.length, 0);
    if (total > MAX_IMAGES_TOTAL_CHARS) {
      return json({
        error: '多页图片总量过大,请减少页数或降低分辨率'
          + `(上限 ${Math.round(MAX_IMAGES_TOTAL_CHARS / 1024 / 1024)}MB)`,
        received: Math.round(total / 1024) + ' KB',
      }, 413);
    }

    userContent = [
      { type: 'text', text: payload.prompt || SCAN_TASK },
      ...kept.map(u => ({
        type: 'image_url',
        image_url: { url: toDataUrl(u, payload.mimeType), detail: 'high' },
      })),
    ];
  } else {
    const text = String(payload.text || '').slice(0, MAX_TEXT_CHARS);
    if (!text) return json({ error: '缺少 text' }, 400);
    userContent = `${payload.prompt || TEXT_TASK}\n\n---\n${text}\n---`;
  }

  const messages = [
    { role: 'system', content: buildSystemPrompt({ subject: payload.subject, style: 'balanced' }) },
    { role: 'user', content: userContent },
  ];

  let upstream;
  try {
    upstream = await callUpstream({
      apiKey,
      endpoint: userEndpoint || undefined,
      payload: {
        model: visionModel,
        messages,
        stream: false,
        temperature: clamp(payload.temperature, 0, 2, 0.2),
        // 和 chat 一样要给思维链留额度:否则思考吃光预算 → 解析结果为空
        max_tokens: resolveMaxTokens(payload.maxTokens, { kind: 'vision' }),
      },
    });
  } catch (e) {
    return json({ error: '无法连接上游', detail: String(e) }, 502);
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    return json({
      error: '上游返回错误',
      status: upstream.status,
      detail: detail.slice(0, 800),
    }, 502);
  }

  const { text, raw } = await readText(upstream);
  if (!text) {
    return json({ error: '上游未返回文本内容', raw }, 502);
  }

  return json({
    ok: true,
    provider: PROVIDER.label,
    model: visionModel,
    content: text,
    usage: raw?.usage || null,
  });
}
