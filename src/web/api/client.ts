import type {
  ApiConfig,
  Attachment,
  BackupListResult,
  BoardResult,
  Comment,
  IssueDetail,
  IssueListResult,
  LastBackup,
  Link,
  Module,
  ProjectSummary,
  SearchResultItem,
  SetupResult,
  TrashBatch,
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

type ErrorPayload = {
  ok?: boolean;
  error?: { code?: string; message?: string; details?: Record<string, unknown> };
  issue?: unknown;
};

async function readPayload<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as ErrorPayload | null;
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
  return readPayload<T>(response);
}

async function requestForm<T>(path: string, form: FormData): Promise<T> {
  const headers = new Headers({
    Accept: 'application/json',
    'X-CSRF-Token': await ensureCsrf(),
  });
  const response = await fetch(path, { method: 'POST', headers, body: form });
  return readPayload<T>(response);
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

  updateIssue(
    issueKey: string,
    body: {
      expected_rev: number;
      title?: string;
      description?: string;
      priority?: string;
      assignee?: string | null;
      module?: string | null;
      parent?: string | null;
    },
  ): Promise<{ ok: true; changed: boolean; issue: IssueDetail }> {
    return request(`/api/issues/${encodeURIComponent(issueKey)}`, {
      method: 'PATCH',
      body,
    });
  },

  listIssues(projectKey: string, limit = 200): Promise<IssueListResult> {
    return request(
      `/api/issues?project=${encodeURIComponent(projectKey)}&limit=${limit}&view=compact`,
    );
  },

  claimIssue(
    issueKey: string,
  ): Promise<{ ok: true; claimed: boolean; already_owned?: boolean; issue: IssueDetail }> {
    return request(`/api/issues/${encodeURIComponent(issueKey)}/claim`, {
      method: 'POST',
      body: {},
    });
  },

  releaseIssue(
    issueKey: string,
  ): Promise<{ ok: true; released: boolean; issue: IssueDetail }> {
    return request(`/api/issues/${encodeURIComponent(issueKey)}/release`, {
      method: 'POST',
      body: {},
    });
  },

  blockIssue(
    issueKey: string,
    body: { expected_rev: number; reason: string },
  ): Promise<{ ok: true; changed: boolean; issue: IssueDetail }> {
    return request(`/api/issues/${encodeURIComponent(issueKey)}/block`, {
      method: 'POST',
      body,
    });
  },

  unblockIssue(
    issueKey: string,
    body: { expected_rev: number },
  ): Promise<{ ok: true; changed: boolean; issue: IssueDetail }> {
    return request(`/api/issues/${encodeURIComponent(issueKey)}/unblock`, {
      method: 'POST',
      body,
    });
  },

  deleteIssue(
    issueKey: string,
    body: { expected_rev: number; cascade?: boolean; reason?: string },
  ): Promise<{
    ok: true;
    deleted: Array<{ id: string; key: string; title: string }>;
    batch: string;
  }> {
    const params = new URLSearchParams({ expected_rev: String(body.expected_rev) });
    if (body.cascade) params.set('cascade', 'true');
    if (body.reason) params.set('reason', body.reason);
    return request(`/api/issues/${encodeURIComponent(issueKey)}?${params.toString()}`, {
      method: 'DELETE',
    });
  },

  addComment(
    issueKey: string,
    body: { body: string },
  ): Promise<{ ok: true; comment: Comment }> {
    return request(`/api/issues/${encodeURIComponent(issueKey)}/comments`, {
      method: 'POST',
      body,
    });
  },

  updateComment(
    commentId: string,
    body: { body: string; expected_rev: number },
  ): Promise<{ ok: true; comment: Comment }> {
    return request(`/api/comments/${encodeURIComponent(commentId)}`, {
      method: 'PATCH',
      body,
    });
  },

  deleteComment(commentId: string): Promise<{ ok: true }> {
    return request(`/api/comments/${encodeURIComponent(commentId)}`, {
      method: 'DELETE',
    });
  },

  modules(projectKey: string): Promise<{ ok: true; items: Module[] }> {
    return request(`/api/projects/${encodeURIComponent(projectKey)}/modules`);
  },

  actors(): Promise<{ ok: true; items: ActorRef[] }> {
    return request('/api/actors');
  },

  search(query: string, limit = 20): Promise<{ ok: true; items: SearchResultItem[] }> {
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    return request(`/api/search?${params.toString()}`);
  },

  uploadAttachment(
    issueKey: string,
    file: File,
    name?: string,
  ): Promise<{ ok: true; attachment: Attachment; deduplicated: boolean }> {
    const form = new FormData();
    form.append('file', file, file.name);
    if (name) form.append('name', name);
    return requestForm(
      `/api/issues/${encodeURIComponent(issueKey)}/attachments`,
      form,
    );
  },

  attachmentContentUrl(attachmentId: string, download = false): string {
    return `/api/attachments/${encodeURIComponent(attachmentId)}/content${
      download ? '?download=1' : ''
    }`;
  },

  openAttachment(attachmentId: string): Promise<{ ok: true }> {
    return request(`/api/attachments/${encodeURIComponent(attachmentId)}/open`, {
      method: 'POST',
      body: {},
    });
  },

  deleteAttachment(attachmentId: string): Promise<{ ok: true }> {
    return request(`/api/attachments/${encodeURIComponent(attachmentId)}`, {
      method: 'DELETE',
    });
  },

  addLink(
    issueKey: string,
    body: { url: string; label?: string | null },
  ): Promise<{ ok: true; link: Link }> {
    return request(`/api/issues/${encodeURIComponent(issueKey)}/links`, {
      method: 'POST',
      body,
    });
  },

  removeLink(linkId: string): Promise<{ ok: true }> {
    return request(`/api/links/${encodeURIComponent(linkId)}`, {
      method: 'DELETE',
    });
  },

  updateProject(
    projectRef: string,
    body: {
      name?: string;
      description?: string;
      root_path?: string | null;
      doc_allowlist?: string[];
    },
  ): Promise<{ ok: true; project: ProjectSummary }> {
    return request(`/api/projects/${encodeURIComponent(projectRef)}`, {
      method: 'PATCH',
      body,
    });
  },

  deleteProject(projectRef: string): Promise<{ ok: true }> {
    return request(`/api/projects/${encodeURIComponent(projectRef)}`, {
      method: 'DELETE',
    });
  },

  createModule(
    projectKey: string,
    body: { name: string; color?: string | null },
  ): Promise<{ ok: true; created: boolean; module: Module }> {
    return request(`/api/projects/${encodeURIComponent(projectKey)}/modules`, {
      method: 'POST',
      body,
    });
  },

  updateModule(
    moduleId: string,
    body: { name?: string; color?: string | null },
  ): Promise<{ ok: true; module: Module }> {
    return request(`/api/modules/${encodeURIComponent(moduleId)}`, {
      method: 'PATCH',
      body,
    });
  },

  deleteModule(moduleId: string): Promise<{ ok: true }> {
    return request(`/api/modules/${encodeURIComponent(moduleId)}`, {
      method: 'DELETE',
    });
  },

  trash(projectKey: string): Promise<{ ok: true; items: TrashBatch[] }> {
    return request(`/api/projects/${encodeURIComponent(projectKey)}/trash`);
  },

  restoreTrashBatch(
    projectKey: string,
    batch: string,
  ): Promise<{
    ok: true;
    restored: Array<{ id: string; key: string; title: string }>;
    batch: string;
  }> {
    return request(
      `/api/projects/${encodeURIComponent(projectKey)}/trash/${encodeURIComponent(batch)}/restore`,
      { method: 'POST', body: {} },
    );
  },

  backup(): Promise<{ ok: true; backup: LastBackup }> {
    return request('/api/admin/backup', { method: 'POST', body: {} });
  },

  backups(): Promise<BackupListResult> {
    return request('/api/admin/backups');
  },

  revealToken(): Promise<{ ok: true; token: string }> {
    return request('/api/admin/token/reveal', { method: 'POST', body: {} });
  },

  regenerateToken(): Promise<{ ok: true; token: string }> {
    return request('/api/admin/token/regenerate', { method: 'POST', body: {} });
  },

  updateActor(
    actorId: string,
    body: { name?: string; can_read_images?: boolean; color?: string | null },
  ): Promise<{ ok: true; actor: ActorRef }> {
    return request(`/api/actors/${encodeURIComponent(actorId)}`, {
      method: 'PATCH',
      body,
    });
  },

  exportUrl(projectKey: string | undefined, format: 'md' | 'json'): string {
    const params = new URLSearchParams({ format });
    if (projectKey) params.set('project', projectKey);
    return `/api/admin/export?${params.toString()}`;
  },
};
