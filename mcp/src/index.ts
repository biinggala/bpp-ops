#!/usr/bin/env node
// stdio entry point — runs the server for a single local operator.
//
// The HTTP transport for shared team use wraps the same registerTools(), so the
// tool logic and access scoping below are transport-independent.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { registerTools } from './tools.js'
import { initDb } from './store.js'

async function main() {
  const email = process.env.BPP_OPS_OPERATOR_EMAIL
  if (!email) {
    throw new Error(
      'BPP_OPS_OPERATOR_EMAIL is not set. Every tool is scoped to this identity; ' +
        'without it the server would have no way to limit what it exposes.'
    )
  }

  initDb() // fail fast on bad credentials rather than on the first tool call

  const server = new McpServer({ name: 'bpp-ops', version: '0.1.0' })
  registerTools(server, { email: email.toLowerCase() })

  await server.connect(new StdioServerTransport())
}

main().catch(err => {
  console.error('[bpp-ops-mcp]', err instanceof Error ? err.message : err)
  process.exit(1)
})
