import { DomainError, validationError } from './errors.js';
import { STAGES, PRIORITIES, type Priority, type Stage } from './types.js';

export function assertNonEmpty(value: string, field: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    validationError(`${field} must not be empty`);
  }
  if (trimmed.length > maxLength) {
    validationError(`${field} must be at most ${maxLength} characters`);
  }
  return trimmed;
}

export function assertOptionalLength(
  value: string | undefined,
  field: string,
  maxLength: number,
): string | undefined {
  if (value === undefined) return undefined;
  if (value.length > maxLength) {
    validationError(`${field} must be at most ${maxLength} characters`);
  }
  return value;
}

export function assertStage(value: string): Stage {
  if (!STAGES.includes(value as Stage)) {
    validationError(`Unknown stage: ${value}`);
  }
  return value as Stage;
}

export function assertPriority(value: string): Priority {
  if (!PRIORITIES.includes(value as Priority)) {
    validationError(`Unknown priority: ${value}`);
  }
  return value as Priority;
}

export function assertHttpUrl(value: string, field = 'url'): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    validationError(`${field} must be a valid URL`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    validationError(`${field} must use http or https`);
  }
  if (parsed.username || parsed.password) {
    validationError(`${field} must not contain credentials`);
  }
  if (value.length > 2048) {
    validationError(`${field} must be at most 2048 characters`);
  }
  return value;
}

export function normalizeNameKey(name: string): string {
  return name.trim().toLocaleLowerCase('en-US');
}

export function slugify(value: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  if (!slug) {
    validationError('Module name must contain at least one letter or digit');
  }
  if (slug.length > 64) {
    validationError('Module slug must be at most 64 characters');
  }
  return slug;
}

export function assertProjectKey(value: string): string {
  const key = value.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9]{1,5}$/.test(key)) {
    validationError('Project key must be 2–6 characters: a letter followed by letters or digits');
  }
  return key;
}

export function assertIssueKey(value: string): string {
  const key = value.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9]{1,5}-\d+$/.test(key)) {
    validationError(`Invalid issue key: ${value}`);
  }
  return key;
}

export function assertPositiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 1) {
    validationError(`${field} must be a positive integer`);
  }
  return value;
}

export function assertExpectedRev(value: number): number {
  if (!Number.isInteger(value) || value < 1) {
    validationError('expected_rev must be a positive integer');
  }
  return value;
}

export function assertFiniteNumber(value: number, field: string): number {
  if (!Number.isFinite(value)) {
    validationError(`${field} must be a finite number`);
  }
  return value;
}

export function parseJsonArray<T>(value: string, field: string): T[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      throw new Error('not an array');
    }
    return parsed as T[];
  } catch {
    throw new DomainError('internal_error', `Invalid JSON in ${field}`);
  }
}
