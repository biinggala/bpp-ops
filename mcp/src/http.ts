#!/usr/bin/env node
// Remote MCP endpoint for claude.ai and Claude Desktop connectors.
//
// Same tools and same access control as the stdio entry point; the only
// difference is that the operator identity comes from an OAuth token rather than
// an environment variable, which is what makes a shared server safe to run.

import express from 'express'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js'
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js'
import { GoogleBackedProvider, googleCallbackPath } from './oauth/provider.js'
import { registerTools } from './tools.js'
import { canAccessProject } from './access.js'
import { initDb, readProjects } from './store.js'

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}

async function main() {
  const publicUrl = required('PUBLIC_URL').replace(/\/$/, '')
  const provider = new GoogleBackedProvider(
    {
      clientId: required('GOOGLE_OAUTH_CLIENT_ID'),
      clientSecret: required('GOOGLE_OAUTH_CLIENT_SECRET'),
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
      resourceName: '크린지 플로우',
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

  const bearer = requireBearerAuth({ verifier: provider })

  // Stateless: a fresh server and transport per request keeps concurrent users
  // from sharing state, and lets the process scale to zero between calls.
  app.post('/mcp', bearer, async (req, res) => {
    const email = req.auth?.extra?.email
    if (typeof email !== 'string') {
      return void res.status(401).json({ error: 'token carries no identity' })
    }

    const server = new McpServer({ name: 'cringe-flow', version: '0.1.0' })
    registerTools(server, { email })

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    res.on('close', () => {
      void transport.close()
      void server.close()
    })

    await server.connect(transport)
    await transport.handleRequest(req, res, req.body)
  })

  app.get('/healthz', (_req, res) => void res.json({ ok: true }))

  const port = Number(process.env.PORT ?? 8080)
  app.listen(port, () => {
    console.error(`[cringe-flow-mcp] listening on :${port} as ${publicUrl}`)
  })
}

main().catch(err => {
  console.error('[cringe-flow-mcp]', err instanceof Error ? err.message : err)
  process.exit(1)
})
