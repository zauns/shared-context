import type {
  ApiConfig,
  BoardResult,
  IssueDetail,
  Module,
  ProjectSummary,
  SetupResult,
  ActorRef,
} from './types.js';
import type { FilterState } from '../lib/filters.js';

let csrfToken: string | null = null;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;
  readonly issue?: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
    issue?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.issue = issue;
  }
}

async function ensureCsrf(): Promise<string> {
  if (csrfToken) return csrfToken;
  const response = await fetch('/api/csrf');
  const payload = (await response.json()) as { ok?: boolean; token?: string };
  if (!response.ok || !payload.token) {
    throw new ApiError(response.status, 'csrf_error', 'Could not obtain a CSRF token');
  }
  csrfToken = payload.token;
  return csrfToken;
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const method = options.method ?? 'GET';
  const headers = new Headers({ Accept: 'application/json' });
  if (method !== 'GET' && method !== 'HEAD') {
    headers.set('Content-Type', 'application/json');
    headers.set('X-CSRF-Token', await ensureCsrf());
  }
  const response = await fetch(path, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const payload = (await response.json().catch(() => null)) as
    | { ok?: boolean; error?: { code?: string; message?: string; details?: Record<string, unknown> }; issue?: unknown }
    | null;

  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload?.error?.code ?? 'http_error',
      payload?.error?.message ?? `HTTP ${response.status}`,
      payload?.error?.details,
      payload?.issue,
    );
  }
  return payload as T;
}

function boardQuery(filters: FilterState): string {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set('q', filters.q.trim());
  if (filters.priorities.length > 0) params.set('priorities', filters.priorities.join(','));
  if (filters.assignee) params.set('assignee', filters.assignee);
  if (filters.module) params.set('module', filters.module);
  if (filters.blocked) params.set('blocked', 'true');
  if (filters.hasAttachments) params.set('has_attachments', 'true');
  if (!filters.includeClosed) params.set('include_closed', 'false');
  const query = params.toString();
  return query ? `?${query}` : '';
}

export const api = {
  config(): Promise<ApiConfig> {
    return request<ApiConfig>('/api/config');
  },

  setup(body: {
    owner_name: string;
    project_key?: string;
    project_name?: string;
  }): Promise<SetupResult> {
    return request<SetupResult>('/api/setup', { method: 'POST', body });
  },

  projects(): Promise<{ ok: true; items: ProjectSummary[] }> {
    return request('/api/projects');
  },

  createProject(body: { key: string; name: string; description?: string }): Promise<{
    ok: true;
    project: ProjectSummary;
  }> {
    return request('/api/projects', { method: 'POST', body });
  },

  board(projectKey: string, filters: FilterState): Promise<BoardResult> {
    return request<BoardResult>(
      `/api/projects/${encodeURIComponent(projectKey)}/board${boardQuery(filters)}`,
    );
  },

  issue(issueKey: string): Promise<{ ok: true; issue: IssueDetail }> {
    return request(`/api/issues/${encodeURIComponent(issueKey)}`);
  },

  createIssue(body: {
    project: string;
    title: string;
    description?: string;
    stage?: string;
    priority?: string;
    assignee?: string;
    module?: string;
    parent?: string;
  }): Promise<{ ok: true; created: boolean; issue: IssueDetail }> {
    return request('/api/issues', { method: 'POST', body });
  },

  moveIssue(
    issueKey: string,
    body: { expected_rev: number; stage: string; position?: number },
  ): Promise<{ ok: true; changed: boolean; issue: IssueDetail }> {
    return request(`/api/issues/${encodeURIComponent(issueKey)}/move`, {
      method: 'POST',
      body,
    });
  },

  modules(projectKey: string): Promise<{ ok: true; items: Module[] }> {
    return request(`/api/projects/${encodeURIComponent(projectKey)}/modules`);
  },

  actors(): Promise<{ ok: true; items: ActorRef[] }> {
    return request('/api/actors');
  },
};
