/**
 * POST /api/chat —— 流式对话代理
 *
 * 前端只需要关心 messages / subject / style / tier;
 * 密钥、上游端点、模型名、system prompt 全部由服务端决定,不信任任何客户端输入。
 */

import {
  json, clamp, resolveTier, resolveModel, resolveMaxTokens,
  callUpstream, streamToClient, describeConfig, PROVIDER,
  resolveUserKey, resolveUserEndpoint,
} from '../_lib/providers.js';
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

  /* 用户自带的密钥 / API 地址(设置里填的,走请求头)。两者都必须过校验;
     不合法就当作没填,静默回落到服务端配置 —— 不报错,
     否则这个接口会变成"帮你探测地址合不合法"的工具。

     ⚠️ 密钥只在这里被读取和使用:不写日志、不回传、不进任何响应。 */
  const userKey = resolveUserKey(request.headers.get('X-Studyomni-Key'));
  const userEndpoint = resolveUserEndpoint(request.headers.get('X-Studyomni-Base'));

  const apiKey = userKey || env[PROVIDER.keyEnv];
  if (!apiKey) {
    return json({
      error: `服务端未配置 ${PROVIDER.keyEnv},也没有填自定义 API`,
      hint: '可以点右上角齿轮 → 「自定义 API」填入你自己的密钥;'
        + '或本地写 .dev.vars 后重跑 wrangler pages dev,线上在 Cloudflare 控制台配 Secret',
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

  const tier = resolveTier(payload.tier);
  const model = resolveModel(env, 'chat', tier);

  const body = {
    // 模型名一律由服务端解析。前端只送一个抽象「档位」(fast / deep),
    // 由这里映射成真实模型 id —— 不让客户端直接指名模型。
    model,
    messages,
    stream: true,
    temperature: clamp(payload.temperature, 0, 2, 0.3),
    // 前端给的是「正文额度」;对带思维链的模型还要额外留一截思考预算,
    // 否则思考会把 max_tokens 吃光、正文一个字都出不来。
    max_tokens: resolveMaxTokens(payload.maxTokens, { kind: 'chat', tier }),
  };

  let upstream;
  try {
    upstream = await callUpstream({
      apiKey,
      payload: body,
      // userEndpoint 已经过 resolveUserEndpoint 白名单校验;为空则走内置常量
      endpoint: userEndpoint || undefined,
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

  return streamToClient(upstream, model);
}

/* 调试用:确认路由、模型配置与限流参数是否就位 */
export async function onRequestGet({ env }) {
  const cfg = describeConfig(env);
  return json({
    ok: true,
    ...cfg,
    limits: currentLimits(env),
    usage: '用 POST 发起对话',
  });
}
