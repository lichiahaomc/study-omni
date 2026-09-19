/**
 * POST /api/parse —— 素材解析(多模态入口)
 *
 * 支持两种输入:
 *   type: 'image'      题目照片。交给视觉模型识别并还原成可追问的题干
 *   type: 'text'       PDF / 截图里抽出来的纯文本。让模型提炼关键信息
 *
 * 这里走非流式 —— 解析是一次性结果,不需要打字机效果。
 */

import { pickProvider, json, clamp, resolveMaxTokens, callUpstream, readText } from '../_lib/providers.js';
import { buildSystemPrompt } from '../_lib/prompts.js';
import { checkRateLimit, tooManyResponse, sameOrigin } from '../_lib/ratelimit.js';

/* base64 长度上限:约 4MB。再大就该让前端先压缩了 */
const MAX_IMAGE_CHARS = 4 * 1024 * 1024;
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

  const { name, provider } = pickProvider(env, payload.provider);
  if (!provider) return json({ error: `未知厂商 "${name}"` }, 400);

  const apiKey = env[provider.keyEnv];
  if (!apiKey) return json({ error: `服务端未配置 ${provider.keyEnv}`, provider: name }, 500);

  const type = payload.type === 'text' ? 'text' : 'image';
  let userContent;

  if (type === 'image') {
    const raw = String(payload.imageBase64 || '').trim();
    if (!raw) return json({ error: '缺少 imageBase64' }, 400);
    if (raw.length > MAX_IMAGE_CHARS) {
      return json({
        error: '图片过大,请前端先压缩到 3MB 以内再上传',
        received: Math.round(raw.length / 1024) + ' KB',
      }, 413);
    }

    // 统一成 data URL;前端可能只给了裸 base64
    const dataUrl = raw.startsWith('data:')
      ? raw
      : `data:${payload.mimeType || 'image/jpeg'};base64,${raw}`;

    userContent = [
      { type: 'text', text: payload.prompt || IMAGE_TASK },
      {
        type: 'image_url',
        image_url: { url: dataUrl, detail: 'high' },
      },
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
      provider,
      apiKey,
      payload: {
        // 视觉统一走各家的 vision 型号
        model: provider.visionModel,
        messages,
        stream: false,
        temperature: clamp(payload.temperature, 0, 2, 0.2),
        // 和 chat 一样要给思维链留额度:否则思考吃光预算 → 解析结果为空
        max_tokens: resolveMaxTokens(payload.maxTokens, provider),
      },
    });
  } catch (e) {
    return json({ error: '无法连接上游厂商', provider: name, detail: String(e) }, 502);
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    return json({
      error: '上游厂商返回错误',
      provider: name,
      status: upstream.status,
      detail: detail.slice(0, 800),
    }, 502);
  }

  const { text, raw } = await readText(upstream);
  if (!text) {
    return json({ error: '上游未返回文本内容', provider: name, raw }, 502);
  }

  return json({
    ok: true,
    provider: name,
    model: provider.visionModel,
    content: text,
    usage: raw?.usage || null,
  });
}
