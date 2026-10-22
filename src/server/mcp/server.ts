import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpDeps, McpSessionState } from './state.js';
import { registerTools } from './tools.js';

export function createMcpServer(deps: McpDeps, state: McpSessionState): McpServer {
  const server = new McpServer(
    { name: 'shared-context', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );
  registerTools(server, deps, state);
  return server;
}
