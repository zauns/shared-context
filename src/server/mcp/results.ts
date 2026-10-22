import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { isDomainError } from '../domain/errors.js';

function isToolResult(value: unknown): value is CallToolResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'content' in value &&
    Array.isArray((value as { content?: unknown }).content)
  );
}

export function toolOk(
  payload: object,
  extraContent: CallToolResult['content'] = [],
): CallToolResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ ok: true, ...payload }, null, 2),
      },
      ...extraContent,
    ],
  };
}

export function toolError(error: unknown): CallToolResult {
  if (isDomainError(error)) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              ok: false,
              error: {
                code: error.code,
                message: error.message,
                ...(error.details ? { details: error.details } : {}),
              },
              ...(error.currentIssue !== undefined ? { issue: error.currentIssue } : {}),
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            ok: false,
            error: { code: 'internal_error', message: 'Internal server error' },
          },
          null,
          2,
        ),
      },
    ],
  };
}

export function wrapTool<T>(run: () => Promise<T> | T): Promise<CallToolResult> {
  return Promise.resolve()
    .then(run)
    .then((payload) => {
      if (isToolResult(payload)) return payload;
      return toolOk(
        payload && typeof payload === 'object'
          ? (payload as object)
          : { value: payload },
      );
    })
    .catch(toolError);
}
