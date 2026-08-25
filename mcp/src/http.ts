#!/usr/bin/env node
// Remote MCP endpoint for claude.ai and Claude Desktop connectors.
//
// Same tools and same access control as the stdio entry point; the only
// difference is that the operator identity comes from an OAuth token rather than
// an environment variable, which is what makes a shared server safe to run.

import express from 'express'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { getOAuthProtectedResourceMetadataUrl, mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js'
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js'
import { GoogleBackedProvider, googleCallbackPath } from './oauth/provider.js'
import { registerTools } from './tools.js'
import { canAccessProject } from './access.js'
import { initDb, readProjects } from './store.js'
import { pushConfigured, registerPushRoutes } from './push.js'
import { notionConfigured, registerNotionRoutes } from './notion.js'

/**
 * Every missing variable at once, not just the first.
 *
 * Startup failure on a serverless host shows up as "the container failed to
 * listen on $PORT", with the real reason buried in the logs — so being told
 * about one missing name, fixing it, and redeploying to be told about the next
 * costs a full deploy per variable.
 */
function requireEnv(names: string[]): Record<string, string> {
  const missing = names.filter(n => !process.env[n])
  if (missing.length) {
    throw new Error(
      `missing environment variables: ${missing.join(', ')}. ` +
      'On Cloud Run these are set with `gcloud run services update <service> --set-env-vars ...`; ' +
      'see mcp/README.md for what each one is.'
    )
  }
  return Object.fromEntries(names.map(n => [n, process.env[n]!]))
}

async function main() {
  const env = requireEnv(['PUBLIC_URL', 'GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET'])
  const publicUrl = env.PUBLIC_URL.replace(/\/$/, '')
  const provider = new GoogleBackedProvider(
    {
      clientId: env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      publicUrl,
    },
    // Anyone who is not part of a project would see nothing anyway, but refusing
    // at sign-in keeps strangers from holding a token at all.
    //
    // 이메일을 넘기므로 그 사람 색인에 적힌 것만 읽습니다. 로그인 한 번에
    // 워크스페이스 전체를 훑던 것이 이걸로 끝납니다. 멤버십 검사는 그대로
    // 둡니다 — 색인은 그 사람이 쓰는 자리라, 프로젝트에서 빠진 뒤에도 줄이
    // 남아 있을 수 있습니다.
    async email => (await readProjects(email)).some(p => canAccessProject(p, email))
  )

  initDb() // fail fast on bad credentials

  const app = express()
  app.use(express.json())

  /**
   * ── 앱이 이 서버를 부를 수 있게 ────────────────────────────────────────────
   *
   * 이 서버는 원래 Claude 커넥터만 상대했습니다. 커넥터는 브라우저가 아니라
   * 서버끼리 부르는 것이라 CORS가 필요 없었고, 그래서 아무 데도 없었습니다.
   *
   * 노션 찾기가 그 전제를 깼습니다 — **브라우저가 직접 부릅니다.** 헤더가
   * 없으면 브라우저가 응답을 통째로 버리고, 앱에서는 '서버가 죽었다'와
   * 구별되지 않습니다. (푸시 알림도 같은 자리에 있었습니다. 부르는 쪽이
   * 실패를 삼키게 되어 있어서 아무도 몰랐을 뿐입니다.)
   *
   * **주소를 적어 놓고 그것만 허락합니다.** `*`로 열면 아무 웹페이지나 이
   * 서버에 요청을 보낼 수 있게 됩니다 — 토큰이 자동으로 실려 가지는 않지만,
   * 남의 페이지가 우리 서버를 두드릴 수 있는 상태를 만들 이유가 없습니다.
   * Origin 헤더는 브라우저가 붙이는 것이라 페이지 쪽에서 못 속입니다.
   *
   * 데스크톱 앱도 여기 있는 주소를 씁니다 — 화면을 배포된 웹에서 불러오므로
   * 출처가 웹과 같습니다(tauri.conf.json의 frontendDist).
   */
  const ALLOWED_ORIGINS = new Set([
    'https://crng-task-manager.web.app',
    'https://crng-task-manager.firebaseapp.com',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ])

  app.use((req, res, next) => {
    const origin = req.header('origin')
    if (origin && ALLOWED_ORIGINS.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      // 주소마다 답이 달라지므로 캐시가 한 곳의 답을 다른 곳에 주면 안 됩니다.
      res.setHeader('Vary', 'Origin')
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      res.setHeader('Access-Control-Max-Age', '3600')
    }
    // 브라우저는 진짜 요청 전에 OPTIONS로 한 번 물어봅니다. 여기서 끝냅니다 —
    // 아래로 내려보내면 '그런 길 없음'으로 답하고, 브라우저는 그걸 거절로
    // 읽습니다.
    if (req.method === 'OPTIONS') return void res.sendStatus(origin && ALLOWED_ORIGINS.has(origin) ? 204 : 403)
    next()
  })

  const issuer = new URL(publicUrl)
  app.use(
    mcpAuthRouter({
      provider,
      issuerUrl: issuer,
      baseUrl: issuer,
      resourceName: 'bpp-ops',
      scopesSupported: ['tasks'],
    })
  )

  // The leg Google redirects back to; hands the user on to Claude.
  app.get(googleCallbackPath, async (req, res) => {
    const { code, state, error } = req.query as Record<string, string | undefined>
    if (error) return void res.status(400).send(`Google 로그인 실패: ${error}`)
    if (!code || !state) return void res.status(400).send('잘못된 콜백 요청입니다')
    try {
      res.redirect(await provider.handleGoogleCallback(code, state))
    } catch (e) {
      res.status(400).send(e instanceof Error ? e.message : 'authorization failed')
    }
  })

  // The 401 must advertise where the resource metadata lives; that pointer is
  // how a connector discovers which authorization server to use.
  const bearer = requireBearerAuth({
    verifier: provider,
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(issuer),
  })

  // Stateless: a fresh server and transport per request keeps concurrent users
  // from sharing state, and lets the process scale to zero between calls.
  app.post('/mcp', bearer, async (req, res) => {
    const email = req.auth?.extra?.email
    if (typeof email !== 'string') {
      return void res.status(401).json({ error: 'token carries no identity' })
    }

    const server = new McpServer({ name: 'bpp-ops', version: '0.1.0' })
    registerTools(server, { email })

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    res.on('close', () => {
      void transport.close()
      void server.close()
    })

    await server.connect(transport)
    await transport.handleRequest(req, res, req.body)
  })

  // 알림 보내는 쪽 — the app asks for one buzz, Cloud Scheduler asks for the
  // morning brief. Registered unconditionally so /push/health can say why it is
  // not working; without the VAPID keys the two senders answer 503.
  registerPushRoutes(app)

  // 노션 찾기 — 브라우저가 노션에 직접 못 물어서(CORS) 여기를 거칩니다.
  // 열쇠가 없으면 각 길이 503으로 답하므로, 안 켜져 있어도 서버는 뜹니다.
  registerNotionRoutes(app, publicUrl)

  /**
   * 상태 확인, 그리고 **구글에 등록해야 하는 주소**.
   *
   * `redirect_uri_mismatch`로 로그인이 막혔을 때 알아야 하는 건 딱 하나입니다:
   * 이 서버가 구글에 보내는 리디렉션 주소가 무엇인가. 그 값은 PUBLIC_URL에서
   * 만들어지는데, 코드를 읽지 않으면 알 수 없었습니다 — 그래서 여기 적어
   * 둡니다. 비밀은 없습니다(공개 주소 하나).
   */
  app.get('/healthz', (_req, res) => void res.json({
    ok: true,
    push: pushConfigured(),
    notion: notionConfigured(),
    issuer: publicUrl,
    googleRedirectUri: new URL(googleCallbackPath, publicUrl).toString(),
  }))

  const port = Number(process.env.PORT ?? 8080)
  app.listen(port, () => {
    console.error(`[bpp-ops-mcp] listening on :${port} as ${publicUrl}`)
  })
}

main().catch(err => {
  console.error('[bpp-ops-mcp]', err instanceof Error ? err.message : err)
  process.exit(1)
})
