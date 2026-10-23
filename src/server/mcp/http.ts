import { Router, type Request, type Response } from 'express';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AppConfig } from '../config.js';
import type { Database } from '../db/connection.js';
import type { ChangeBus } from '../services/change-bus.js';
import { asyncHandler } from '../http/errors.js';
import { createMcpServer } from './server.js';
import type { McpSessionState } from './state.js';

interface McpSession {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  state: McpSessionState;
}

export interface McpRouterDeps {
  db: Database;
  config: AppConfig;
  bus: ChangeBus;
}

function rpcError(response: Response, status: number, code: number, message: string): void {
  response.status(status).json({
    jsonrpc: '2.0',
    error: { code, message },
    id: null,
  });
}

function tokenMatches(supplied: string | undefined, expected: string): boolean {
  if (!supplied) return false;
  const provided = Buffer.from(supplied);
  const wanted = Buffer.from(expected);
  return (
    provided.length === wanted.length && timingSafeEqual(provided, wanted)
  );
}

export function createMcpRouter({ db, config, bus }: McpRouterDeps): Router {
  const router = Router();
  const sessions = new Map<string, McpSession>();

  const authorized = (request: Request, response: Response): boolean => {
    const header = request.header('authorization');
    const supplied = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (tokenMatches(supplied, config.token)) return true;
    rpcError(response, 401, -32001, 'Unauthorized');
    return false;
  };

  router.post(
    '/',
    asyncHandler(async (request, response) => {
      if (!authorized(request, response)) return;

      const sessionId = request.header('mcp-session-id');
      if (sessionId) {
        const session = sessions.get(sessionId);
        if (!session) {
          rpcError(response, 404, -32001, 'Session not found');
          return;
        }
        await session.transport.handleRequest(request, response, request.body);
        return;
      }

      if (!isInitializeRequest(request.body)) {
        rpcError(response, 400, -32000, 'No valid session ID and not an initialize request');
        return;
      }

      const state: McpSessionState = { canReadImages: false };
      const server = createMcpServer({ db, config, bus }, state);
      const holder: { transport?: StreamableHTTPServerTransport } = {};
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
        onsessioninitialized: (newSessionId) => {
          if (holder.transport) {
            sessions.set(newSessionId, {
              transport: holder.transport,
              server,
              state,
            });
          }
        },
      });
      holder.transport = transport;
      transport.onclose = () => {
        const closedSessionId = transport.sessionId;
        if (closedSessionId) sessions.delete(closedSessionId);
      };

      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
    }),
  );

  router.get(
    '/',
    asyncHandler(async (request, response) => {
      if (!authorized(request, response)) return;
      const sessionId = request.header('mcp-session-id');
      if (!sessionId) {
        rpcError(response, 400, -32000, 'Missing session ID');
        return;
      }
      const session = sessions.get(sessionId);
      if (!session) {
        rpcError(response, 404, -32001, 'Session not found');
        return;
      }
      await session.transport.handleRequest(request, response);
    }),
  );

  router.delete(
    '/',
    asyncHandler(async (request, response) => {
      if (!authorized(request, response)) return;
      const sessionId = request.header('mcp-session-id');
      if (!sessionId) {
        rpcError(response, 400, -32000, 'Missing session ID');
        return;
      }
      const session = sessions.get(sessionId);
      if (!session) {
        rpcError(response, 404, -32001, 'Session not found');
        return;
      }
      await session.transport.handleRequest(request, response);
      sessions.delete(sessionId);
    }),
  );

  return router;
}
