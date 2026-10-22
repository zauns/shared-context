import { z } from 'zod';
import { DomainError } from '../domain/errors.js';
import { PRIORITIES, STAGES } from '../domain/types.js';

export const stageSchema = z.enum(STAGES);
export const prioritySchema = z.enum(PRIORITIES);

export const projectCreateSchema = z.object({
  key: z.string(),
  name: z.string(),
  description: z.string().optional(),
  root_path: z.string().nullable().optional(),
  doc_allowlist: z.array(z.string()).optional(),
});

export const projectUpdateSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  root_path: z.string().nullable().optional(),
  doc_allowlist: z.array(z.string()).optional(),
});

export const moduleCreateSchema = z.object({
  name: z.string(),
  color: z.string().nullable().optional(),
});

export const moduleUpdateSchema = z.object({
  name: z.string().optional(),
  color: z.string().nullable().optional(),
});

export const linkCreateSchema = z.object({
  url: z.string(),
  label: z.string().nullable().optional(),
});

export const issueCreateSchema = z.object({
  project: z.string(),
  title: z.string(),
  description: z.string().optional(),
  stage: stageSchema.optional(),
  priority: prioritySchema.optional(),
  assignee: z.string().nullable().optional(),
  module: z.string().nullable().optional(),
  parent: z.string().nullable().optional(),
  links: z.array(linkCreateSchema).optional(),
  client_request_id: z.string().optional(),
});

export const issueUpdateSchema = z.object({
  expected_rev: z.number().int().positive(),
  title: z.string().optional(),
  description: z.string().optional(),
  priority: prioritySchema.optional(),
  assignee: z.string().nullable().optional(),
  module: z.string().nullable().optional(),
  parent: z.string().nullable().optional(),
});

export const issueMoveSchema = z.object({
  expected_rev: z.number().int().positive(),
  stage: stageSchema,
  position: z.number().finite().optional(),
});

export const claimSchema = z.object({
  expected_rev: z.number().int().positive().optional(),
});

export const releaseSchema = z.object({}).passthrough();

export const blockSchema = z.object({
  expected_rev: z.number().int().positive(),
  reason: z.string(),
});

export const unblockSchema = z.object({
  expected_rev: z.number().int().positive(),
});

export const deleteSchema = z.object({
  expected_rev: z.number().int().positive().optional(),
  cascade: z.boolean().optional(),
  reason: z.string().optional(),
});

export const commentCreateSchema = z.object({ body: z.string() });

export const commentUpdateSchema = z.object({
  body: z.string(),
  expected_rev: z.number().int().positive(),
});

export const actorCreateSchema = z.object({
  name: z.string(),
  kind: z.enum(['human', 'agent']).optional(),
  can_read_images: z.boolean().optional(),
  color: z.string().nullable().optional(),
});

export const actorUpdateSchema = z.object({
  name: z.string().optional(),
  can_read_images: z.boolean().optional(),
  color: z.string().nullable().optional(),
});

export const setupSchema = z.object({
  owner_name: z.string(),
  project_key: z.string().optional(),
  project_name: z.string().optional(),
});

export function parseBody<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new DomainError('validation_error', 'Invalid request', {
      details: { issues: result.error.issues },
    });
  }
  return result.data;
}

export function queryString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

export function queryNumber(value: unknown): number | undefined {
  const text = queryString(value);
  if (text === undefined) return undefined;
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) {
    throw new DomainError('validation_error', `Expected a number, got: ${text}`);
  }
  return parsed;
}

export function queryBoolean(value: unknown): boolean | undefined {
  const text = queryString(value)?.toLowerCase();
  if (text === undefined) return undefined;
  if (text === 'true' || text === '1') return true;
  if (text === 'false' || text === '0') return false;
  throw new DomainError('validation_error', `Expected a boolean, got: ${text}`);
}

export function queryCsv(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    return value
      .flatMap((entry) => (typeof entry === 'string' ? entry.split(',') : []))
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return undefined;
}
