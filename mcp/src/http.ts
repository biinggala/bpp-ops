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
    async email => (await readProjects()).some(p => canAccessProject(p, email))
  )

  initDb() // fail fast on bad credentials

  const app = express()
  app.use(express.json())

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

  app.get('/healthz', (_req, res) => void res.json({ ok: true, push: pushConfigured() }))

  const port = Number(process.env.PORT ?? 8080)
  app.listen(port, () => {
    console.error(`[bpp-ops-mcp] listening on :${port} as ${publicUrl}`)
  })
}

main().catch(err => {
  console.error('[bpp-ops-mcp]', err instanceof Error ? err.message : err)
  process.exit(1)
})
