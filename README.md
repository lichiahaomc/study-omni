# StudyOmni

多模态教学智能体 · 粤港澳大湾区 AI Coding 创新大赛参赛项目。

前端为纯静态资源(无构建),后端用 Cloudflare Pages Functions 做代理层
—— 模型密钥只存在云端 Secret 里,浏览器与前端代码都不持有。

## 目录结构

```
public/              静态资源,即 wrangler.toml 里的 pages_build_output_dir
  index.html
functions/           Cloudflare Functions(必须在项目根,不能放进 public)
  api/chat.js        POST /api/chat  流式对话
  api/parse.js       POST /api/parse 图片 / 多页 / 文本解析
  _lib/              共享模块(下划线开头,不映射成路由)
    providers.js     三家厂商适配表 + token 预算分配
    prompts.js       学科提示词生成器(61 门学科,三层组合)
    ratelimit.js     限流 + 同源校验
tests/
  ratelimit.test.mjs 限流与同源校验(离线)
  subjects.test.mjs  学科表一致性 + 提示词生成(离线)
```

## 素材解析:三条路

| 输入 | 处理方式 | 说明 |
|---|---|---|
| 图片 | 压缩后交给视觉模型 | 手机拍的照片,先压到最长边 1600 再传 |
| PDF(有文本层)| pdf.js 抽文本 → 纯文本通道 | 便宜、快,一次能读 20 页 |
| PDF(扫描件)| pdf.js 渲染页面成图 → 视觉模型 | **整页是图片、没有文本层**,默认渲染前 3 页 |

扫描件的判定标准是**每页平均字数 < 30**:低于这个值基本能断定没有可用的文本层
(真实扫描件的文本量通常是 0,只有页码水印)。渲染时用 2 倍缩放保证小字清晰,
超过 1600px 再缩回去。

> 这是演示最容易翻车的地方 —— 真实的卷子、课本扫描件极多,
> 早期版本遇到直接放弃,现在会渲染成图交给视觉模型。

## 学科

61 门学科,分 6 组:小学 / 初中 / 高中 / **编程 · 计算机** / 大学 / 通识 · 素养。

学科不是 61 份独立模板,而是三层组合(见 `functions/_lib/prompts.js`):

```
① 学段语气(小学 / 初中 / 高中 / 大学 / 进阶 / 通识)
    ×
② 学科策略(15 种:math · code · web · db · system · medical · …)
    ×
③ 学科具体重点
```

**编程方向刻意做厚**:Python、C/C++、Java、JavaScript、Go、Rust、C# 七种语言,
外加前端 / 后端 / 数据库 / 算法与数据结构 / 算法竞赛 / 操作系统 /
计算机网络 / 计算机组成原理 / 编译原理 / 软件工程 / 网络安全。

新增学科 = `SUBJECTS` 里加一行 + 前端下拉加一项。**两边必须同时改** ——
漏了不会报错(会静默降级成通用策略,学科特色就丢了),所以
`tests/subjects.test.mjs` 专门守这条线:双向一一对应、策略与语气都存在、
每个 prompt 都带本学科重点。`npm test` 会一起跑。

## 本地开发

```bash
cp .dev.vars.example .dev.vars    # 填入你的密钥
npm install
npm run dev                        # 等价于 wrangler pages dev public
```

打开 http://localhost:8788 。Functions 与静态资源同源,不需要配跨域。

## 部署

推荐 Git 集成(Cloudflare 会自动处理 `functions/` 目录):

- Build command:留空
- Build output directory:`public`
- Framework preset:None

然后在 **Settings → Environment variables** 里加:

| 变量 | 值 | 是否加密 |
|---|---|---|
| `LLM_PROVIDER` | `deepseek` | 否 |
| `DEEPSEEK_API_KEY` | `sk-...` | **是** |

命令行部署:

```bash
npx wrangler login
npx wrangler pages secret put DEEPSEEK_API_KEY
npm run deploy
```

## 限流与防刷

公网可访问之后,`/api/chat` 与 `/api/parse` 谁都能打 —— 所以每个请求
进入业务逻辑之前会先过两道闸(都在 `functions/_lib/ratelimit.js`):

1. **同源校验** —— 请求头里的 `Origin` 必须等于自身域名。
   别家网站把接口嵌进自己页面调用会被挡掉。curl / 脚本不带 `Origin`,
   一律放行(它们本来就是合法调用方)。
2. **两级限流** —— 单 IP 每分钟 20 次 + 全站每天 2000 次。
   被拦的请求**不计入用量**(否则刷子光靠被拒就能把日额度耗光),
   响应带 `Retry-After`,前端可据此退避。

三个环境变量可按需覆盖:`RATE_LIMIT_PER_MIN` / `RATE_LIMIT_PER_DAY` /
`ALLOWED_ORIGINS`(见 `.dev.vars.example`)。

> **计数是存在 isolate 内存里的** —— 冷启动清零、多实例不共享,属于
> 「降低伤害」而不是「硬性防御」。这是刻意取舍:精确计数要用 KV 或
> Durable Objects,而 KV 免费额度每天只有上千次**写**,拿它给每个请求
> 计数会先把自己的额度写爆。
>
> 要硬防就在 Cloudflare 控制台配**速率限制规则**(在边缘拦掉,
> 请求进不到 Worker,不产生任何 token 费用)。是否可用取决于套餐,
> 以控制台实际显示为准。

## 切换模型厂商

改 `.dev.vars`(本地)或控制台里的 `LLM_PROVIDER` 即可,无需改代码。

三家都走 OpenAI 兼容协议,所以共用同一套请求与解析逻辑:

| 厂商 | 密钥变量 | 说明 |
|---|---|---|
| `deepseek` | `DEEPSEEK_API_KEY` | 默认。输出 ¥4.5~9/百万 tokens(闲时/高峰),图片一张封顶 384 tokens |
| `gemini` | `GEMINI_API_KEY` | 视觉成熟度高,识图不准时可切这家对比 |
| `openai` | `OPENAI_API_KEY` | 最贵,通常作为兜底 |

> 注意:DeepSeek 的 `deepseek-chat` / `deepseek-reasoner` 端点已于 2026-07-24 退役,
> 当前模型名为 `deepseek-v4-flash` / `deepseek-v4-pro`。

## token 预算与「回答空白」的排查

DeepSeek V4 这类模型会先输出一段思维链(`reasoning_content`),它和正文
**共用** `max_tokens`。所以服务端在转发前会过一层 `resolveMaxTokens()`:
把你设置的「最大回答长度」当作正文额度,额外再加 6144 的思考预算,
再夹到上游硬限 **8192**。

前端会把 `finish_reason` 和思维链一并读出来,三种情况给不同提示:

| 情况 | 表现 | 提示 |
|---|---|---|
| 预算被思考吃光 | 正文为空 | 明说被截断,附思考摘要,建议调大长度或拆小问题 |
| 有正文但被截断 | 内容可读 | 气泡尾部加一行截断提示 |
| 真没返回 | 完全空白 | 通用排查指引 |

想更快:① 把问题拆小 ② 到设置里把回答风格改成「简洁」
(实测同一题 20.8s → 8.9s) ③ 换非推理模型。

## 公式渲染

页面里的 `$...$` / `$$...$$` / `\(...\)` / `\[...\]` 会交给 [KaTeX](https://katex.org) 排版,
**按需加载** —— 只有渲染到公式时才去 CDN 取(jsdelivr),平时零请求。

加载前的兜底是一套自带的 LaTeX → 可读文本转换(`latexPlain`),
离线 / 内网 / CDN 拉不到时显示的是 `ln(x²-ax+1)` 而不是源码。
设置里的「公式使用 LaTeX 渲染」开关可以随时退回纯文本。

## 调试接口

```bash
curl https://你的域名/api/chat
```

```jsonc
{
  "ok": true,
  "provider": "deepseek",
  "label": "DeepSeek",
  "model": "deepseek-v4-flash",
  "keyConfigured": true,
  "limits": {                    // 当前生效的限流参数与用量
    "perMinutePerIP": 20,
    "perDayGlobal": 2000,
    "usedToday": 0,
    "inFlightKeys": 0
  },
  "usage": "用 POST 发起对话"
}
```

前端启动时会探测这个接口:拿不到 `ok + keyConfigured` 就自动降级到本地演示模式。

## 无后端时的行为

直接双击打开 `public/index.html`(未部署 Functions)时,页面会自动降级到
本地演示模式,不会白屏 —— 方便离线演示与 UI 调试。
