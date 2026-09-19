/**
 * POST /api/chat —— 流式对话代理
 *
 * 前端只需要关心 messages / subject / style;
 * 密钥、厂商端点、模型名、system prompt 全部由服务端决定,不信任任何客户端输入。
 */

import { pickProvider, json, clamp, resolveMaxTokens, callUpstream, streamToClient } from '../_lib/providers.js';
import { buildSystemPrompt } from '../_lib/prompts.js';
import { checkRateLimit, tooManyResponse, sameOrigin, currentLimits } from '../_lib/ratelimit.js';

const MAX_MESSAGES = 40;
const MAX_CHARS = 120000;

export async function onRequestPost(context) {
  const { request, env } = context;

  // 公网可访问之后,这两道闸必须有 —— 否则 URL 被刷就是真金白银
  if (!sameOrigin(request, env)) {
    return json({ error: '不允许跨站调用', hint: '本接口只服务于 StudyOmni 自身的页面' }, 403);
  }
  const gate = checkRateLimit(request, env, 'chat');
  if (!gate.ok) return tooManyResponse(gate);

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: '请求体不是合法 JSON' }, 400);
  }

  const { name, provider } = pickProvider(env, payload.provider);
  if (!provider) {
    return json({ error: `未知厂商 "${name}"`, hint: '可选 deepseek / gemini / openai' }, 400);
  }

  const apiKey = env[provider.keyEnv];
  if (!apiKey) {
    return json({
      error: `服务端未配置 ${provider.keyEnv}`,
      provider: name,
      hint: '本地开发请写入 .dev.vars 并重跑 wrangler pages dev;线上请在 Cloudflare 控制台配置 Secret',
    }, 500);
  }

  let messages = Array.isArray(payload.messages) ? payload.messages : [];
  if (messages.length === 0) return json({ error: 'messages 不能为空' }, 400);
  if (messages.length > MAX_MESSAGES) messages = messages.slice(-MAX_MESSAGES);

  // 体积保护:单条消息过长会让 Workers 的 CPU 时间超标
  messages = messages.map(m => ({
    role: m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user',
    content: String(m.content ?? '').slice(0, MAX_CHARS),
  }));

  // system prompt 由服务端生成 —— 绝不接受客户端注入的完整 system
  const hasSystem = messages[0]?.role === 'system';
  if (!hasSystem) {
    let sys = buildSystemPrompt({ subject: payload.subject, style: payload.style });

    // 已解析的素材拼进 system,而不是塞进 history ——
    // 这样它每轮都在,又不会被历史滚动挤掉
    const material = typeof payload.material === 'string'
      ? payload.material.slice(0, MAX_CHARS) : '';
    if (material) {
      sys += '\n\n【用户已上传并解析的素材】\n' + material
           + '\n\n回答时优先基于这份素材;素材里没有的信息不要臆造。';
    }

    messages = [{ role: 'system', content: sys }, ...messages];
  }

  const body = {
    model: payload.model || provider.defaultModel,
    messages,
    stream: true,
    temperature: clamp(payload.temperature, 0, 2, 0.3),
    // 前端给的是「正文额度」;对带思维链的模型还要额外留一截思考预算,
    // 否则思考会把 max_tokens 吃光、正文一个字都出不来。
    max_tokens: resolveMaxTokens(payload.maxTokens, provider),
  };

  let upstream;
  try {
    upstream = await callUpstream({ provider, apiKey, payload: body });
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

  return streamToClient(upstream, name);
}

/* 调试用:确认路由、厂商配置与限流参数是否就位 */
export async function onRequestGet({ env }) {
  const { name, provider } = pickProvider(env, null);
  return json({
    ok: true,
    provider: name,
    label: provider?.label,
    model: provider?.defaultModel,
    keyConfigured: !!env[provider?.keyEnv],
    limits: currentLimits(env),
    usage: '用 POST 发起对话',
  });
}
