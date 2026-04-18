/**
 * Galgame server powered by @codeany/open-agent-sdk.
 *
 * 目标：
 * - 提供静态页面：web/galgame/*
 * - 提供 API：
 *   - POST /api/cc/chat（JSON 一次性返回）
 *   - POST /api/cc/chat/stream（SSE，可选流式事件）
 *   - POST /api/cc/chat/cancel（中断当前 query）
 * - 只保留 SDK 驱动实现（不再 spawn CLI / 不再做协议代理）
 */
import { extname, join, normalize } from 'path'

// 说明：该 npm 包当前未发布 dist（exports 指向的产物缺失），但源码可被 Bun 直接运行。
// 为避免被 exports 限制，这里从项目内相对路径直连 node_modules 源码入口。
import {
  createAgent,
  type Agent,
} from '../node_modules/@codeany/open-agent-sdk/src/agent.ts'
import type { SDKMessage } from '../node_modules/@codeany/open-agent-sdk/src/types.ts'

const env = process.env
// 端口策略：
// - 只有 GALGAME_PORT 才是“强制端口”（失败就退出）
// - OPENAI_ANTHROPIC_PROXY_PORT 兼容旧变量：只作为“起始端口”，仍自动递增找可用端口
const FORCED_PORT = env.GALGAME_PORT
const START_PORT = Number(env.OPENAI_ANTHROPIC_PROXY_PORT || 4100)
const PORT = Number(FORCED_PORT || START_PORT)
const HOST = env.GALGAME_HOST || '127.0.0.1'
const WEB_ROOT = join(process.cwd(), 'web', 'galgame')

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
}

type ClaudeWebRequest = {
  message?: string
  sessionId?: string
  model?: string
  maxTokens?: number
}

type ClaudeWebResponse = {
  ok: boolean
  sessionId?: string
  reply?: string
  usage?: unknown
  ops?: Array<{
    tool_use_id?: string
    tool_name?: string
    output?: string
  }>
  error?: string
}

const agents = new Map<string, Agent>()

function stripThinkingReply(text: string): string {
  const s = String(text ?? '')
  const removed = s
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/g, '')
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/g, '')
    .replace(/<redacted_thinking>[\s\S]*?<\/redacted_thinking>/g, '')

  const openTags = ['<think>', '<thinking>', '<reasoning>', '<redacted_thinking>'] as const
  let cut = removed
  for (const t of openTags) {
    const idx = cut.indexOf(t)
    if (idx >= 0) cut = cut.slice(0, idx)
  }
  return cut.trim()
}

/** 将 SDK 事件序列化为可 JSON 的结构（避免循环引用导致失败） */
function serializeSdkEvent(ev: SDKMessage): unknown {
  try {
    return JSON.parse(JSON.stringify(ev)) as unknown
  } catch {
    return { type: (ev as { type?: string }).type, note: 'serialization_failed' }
  }
}

function getOrCreateAgent(sessionId?: string, modelOverride?: string): Agent {
  const sid = (sessionId || '').trim()
  if (sid && agents.has(sid)) return agents.get(sid)!

  const agent = createAgent({
    cwd: process.cwd(),
    // 默认用环境变量 CODEANY_API_TYPE / CODEANY_API_KEY / CODEANY_BASE_URL
    // 如需 openai-completions：在 .env 中设置 CODEANY_API_TYPE=openai-completions
    model: modelOverride || process.env.CODEANY_MODEL || 'MiniMax-M2.7-highspeed',
    permissionMode: 'bypassPermissions',
    includePartialMessages: false,
    // galgame 是本地开发 UI，默认保留会话在内存即可（不落盘也行）
    persistSession: false,
  })

  const id = sid || agent.getSessionId()
  agents.set(id, agent)
  return agent
}

function safeWebPath(pathname: string): string {
  if (pathname === '/' || pathname === '') return join(WEB_ROOT, 'index.html')
  const normalized = normalize(pathname).replace(/^([/\\])+/, '')
  return join(WEB_ROOT, normalized)
}

async function serveStatic(pathname: string): Promise<Response | null> {
  const filePath = safeWebPath(pathname)
  if (!filePath.startsWith(WEB_ROOT)) {
    return new Response('Forbidden', { status: 403 })
  }
  const file = Bun.file(filePath)
  if (!(await file.exists())) return null
  const mime =
    MIME_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream'
  return new Response(file, { headers: { 'content-type': mime } })
}

async function handleFetch(req: Request): Promise<Response> {
  const url = new URL(req.url)

  if (req.method === 'GET') {
    if (url.pathname === '/health') {
      return Response.json({ ok: true })
    }
    const staticResponse = await serveStatic(url.pathname)
    if (staticResponse) return staticResponse
    return Response.json({ ok: false, error: 'Not Found' }, { status: 404 })
  }

  if (req.method === 'POST' && url.pathname === '/api/cc/chat/cancel') {
    try {
      const body = (await req.json()) as { sessionId?: string }
      const sid = (body.sessionId || '').trim()
      if (!sid) {
        return Response.json(
          { ok: false, error: 'sessionId is required' },
          { status: 400 },
        )
      }
      const agent = agents.get(sid)
      if (!agent) {
        return Response.json(
          { ok: false, error: 'unknown session' },
          { status: 404 },
        )
      }
      await agent.interrupt()
      return Response.json({ ok: true })
    } catch (error) {
      return Response.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        },
        { status: 400 },
      )
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/cc/chat/stream') {
    const body = (await req.json()) as ClaudeWebRequest
    const message = (body.message || '').trim()
    if (!message) {
      return Response.json(
        { ok: false, error: 'message is required' },
        { status: 400 },
      )
    }

    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (data: unknown) => {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
          )
        }

        try {
          const agent = getOrCreateAgent(body.sessionId, body.model?.trim())
          if (body.model?.trim()) await agent.setModel(body.model.trim())

          send({ type: 'ready', sessionId: agent.getSessionId() })

          const ops: NonNullable<ClaudeWebResponse['ops']> = []
          let replyText = ''
          let usage: unknown = null

          for await (const ev of agent.query(message, {
            maxTokens: Number(body.maxTokens || 900),
            includePartialMessages: true,
          })) {
            const e = ev as SDKMessage
            send({ type: 'sdk', ev: serializeSdkEvent(e) })

            if (e.type === 'tool_result') {
              ops.push({
                tool_use_id: e.result.tool_use_id,
                tool_name: e.result.tool_name,
                output: e.result.output,
              })
            } else if (e.type === 'assistant') {
              const fragments = (e.message.content as any[])
                .filter(
                  (c: any) => c?.type === 'text' && typeof c.text === 'string',
                )
                .map((c: any) => c.text)
              if (fragments.length) replyText = fragments.join('')
            } else if (e.type === 'result') {
              usage = e.usage || null
            }
          }

          replyText = stripThinkingReply(replyText)
          send({
            type: 'done',
            ok: true,
            sessionId: agent.getSessionId(),
            reply: replyText || '',
            usage,
            ops,
          })
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error)
          send({ type: 'error', ok: false, message: msg })
        } finally {
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      },
    })
  }

  if (req.method === 'POST' && url.pathname === '/api/cc/chat') {
    try {
      const body = (await req.json()) as ClaudeWebRequest
      const message = (body.message || '').trim()
      if (!message) {
        return Response.json(
          { ok: false, error: 'message is required' } satisfies ClaudeWebResponse,
          { status: 400 },
        )
      }

      const agent = getOrCreateAgent(body.sessionId, body.model?.trim())

      // 每次请求允许前端临时覆盖 model/maxTokens（用于面板配置）
      if (body.model && body.model.trim()) {
        await agent.setModel(body.model.trim())
      }

      const ops: NonNullable<ClaudeWebResponse['ops']> = []
      let replyText = ''
      let usage: unknown = null

      for await (const ev of agent.query(message, {
        maxTokens: Number(body.maxTokens || 900),
        includePartialMessages: false,
      })) {
        const e = ev as SDKMessage
        if (e.type === 'tool_result') {
          ops.push({
            tool_use_id: e.result.tool_use_id,
            tool_name: e.result.tool_name,
            output: e.result.output,
          })
        } else if (e.type === 'assistant') {
          const fragments = (e.message.content as any[])
            .filter((c: any) => c?.type === 'text' && typeof c.text === 'string')
            .map((c: any) => c.text)
          if (fragments.length) replyText = fragments.join('')
        } else if (e.type === 'result') {
          usage = e.usage || null
        }
      }

      replyText = stripThinkingReply(replyText)

      return Response.json({
        ok: true,
        sessionId: agent.getSessionId(),
        reply: replyText || '',
        usage,
        ops,
      } satisfies ClaudeWebResponse)
    } catch (error) {
      return Response.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        } satisfies ClaudeWebResponse,
        { status: 400 },
      )
    }
  }

  return Response.json({ ok: false, error: 'Not Found' }, { status: 404 })
}

function startServer(): ReturnType<typeof Bun.serve> {
  // 如果用户显式指定了端口，则只尝试一次（失败就报错）
  if (FORCED_PORT) {
    return Bun.serve({ hostname: HOST, port: PORT, fetch: handleFetch })
  }

  // 否则自动寻找可用端口（4100 起，最多尝试 50 个）
  const MAX_TRIES = 50
  for (let i = 0; i < MAX_TRIES; i++) {
    const p = PORT + i
    try {
      return Bun.serve({ hostname: HOST, port: p, fetch: handleFetch })
    } catch (err) {
      // 端口被占用就继续试下一个；其他错误直接抛出
      const code = (err as any)?.code
      if (code === 'EADDRINUSE') continue
      throw err
    }
  }
  throw new Error(`Failed to find an available port starting from ${PORT}`)
}

const server = startServer()

// biome-ignore lint/suspicious/noConsole: startup info must be visible
console.log(
  `Galgame server (open-agent-sdk) listening on http://${HOST}:${server.port}/`,
)
