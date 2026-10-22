export type DomainErrorCode =
  | 'validation_error'
  | 'not_found'
  | 'conflict'
  | 'claim_conflict'
  | 'release_conflict'
  | 'invalid_state'
  | 'has_children'
  | 'parent_cycle'
  | 'parent_project_mismatch'
  | 'parent_deleted'
  | 'module_not_found'
  | 'module_in_use'
  | 'actor_not_found'
  | 'actor_required'
  | 'project_required'
  | 'project_not_empty'
  | 'cursor_invalid'
  | 'attachment_too_large'
  | 'unsupported_type'
  | 'attachment_copy_failed'
  | 'doc_not_allowed'
  | 'unauthorized'
  | 'not_implemented'
  | 'internal_error';

const STATUS: Record<DomainErrorCode, number> = {
  validation_error: 400,
  unauthorized: 401,
  not_found: 404,
  conflict: 409,
  claim_conflict: 409,
  release_conflict: 409,
  invalid_state: 409,
  has_children: 409,
  parent_cycle: 422,
  parent_project_mismatch: 422,
  parent_deleted: 409,
  module_not_found: 404,
  module_in_use: 409,
  actor_not_found: 404,
  actor_required: 400,
  project_required: 400,
  project_not_empty: 409,
  cursor_invalid: 400,
  attachment_too_large: 413,
  unsupported_type: 415,
  attachment_copy_failed: 500,
  doc_not_allowed: 403,
  not_implemented: 501,
  internal_error: 500,
};

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;
  readonly currentIssue?: unknown;

  constructor(
    code: DomainErrorCode,
    message: string,
    options: { details?: Record<string, unknown>; currentIssue?: unknown } = {},
  ) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.status = STATUS[code];
    this.details = options.details;
    this.currentIssue = options.currentIssue;
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}

export function validationError(message: string, details?: Record<string, unknown>): never {
  throw new DomainError('validation_error', message, { details });
}

export function notFound(message: string): never {
  throw new DomainError('not_found', message);
}

export function conflict(message: string, currentIssue?: unknown): never {
  throw new DomainError('conflict', message, { currentIssue });
}
