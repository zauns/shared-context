import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileTypeFromFile } from 'file-type';
import { extractText } from 'unpdf';
import type { AppConfig } from '../config.js';
import type { Database } from '../db/connection.js';
import {
  findActiveAttachmentBySha,
  findAttachmentRow,
} from '../db/repositories/attachments.js';
import { requireActorRow } from '../domain/actors.js';
import type { AttachmentRow } from '../db/repositories/rows.js';
import {
  attachmentRowToAttachment,
  createAttachmentRecord,
} from '../domain/attachments.js';
import { DomainError } from '../domain/errors.js';
import { newId } from '../domain/ids.js';
import { requireIssueRow } from '../domain/issues.js';
import type { Attachment } from '../domain/types.js';

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_TEXT_BYTES = 1024 * 1024;
const MAX_PDF_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_CONTEXT_BYTES = 5 * 1024 * 1024;

type AttachmentKind = 'image' | 'text' | 'pdf';

const ALLOWED_TYPES: Record<string, { mime: string; kind: AttachmentKind }> = {
  png: { mime: 'image/png', kind: 'image' },
  jpg: { mime: 'image/jpeg', kind: 'image' },
  jpeg: { mime: 'image/jpeg', kind: 'image' },
  gif: { mime: 'image/gif', kind: 'image' },
  webp: { mime: 'image/webp', kind: 'image' },
  txt: { mime: 'text/plain', kind: 'text' },
  md: { mime: 'text/markdown', kind: 'text' },
  pdf: { mime: 'application/pdf', kind: 'pdf' },
};

const RESERVED_WINDOWS_NAMES = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

function extensionOf(name: string): string {
  return path.extname(name).replace(/^\./, '').toLowerCase();
}

export function sanitizeAttachmentName(name: string): string {
  const withoutControl = [...path.basename(name)]
    .map((character) => (character.charCodeAt(0) < 32 ? '_' : character))
    .join('');
  const base = withoutControl.replace(/[<>:"/\\|?*%!]/g, '_').trim();
  const withoutDots = base.replace(/^[. ]+|[. ]+$/g, '');
  const candidate = withoutDots || 'file';
  const extension = path.extname(candidate);
  const stem = extension ? candidate.slice(0, -extension.length) : candidate;
  const safeStem = RESERVED_WINDOWS_NAMES.has(stem.toLowerCase()) ? `_${stem}` : stem;
  return `${safeStem.slice(0, 200 - extension.length)}${extension}`;
}

function relativeToDataDir(config: AppConfig, absolutePath: string): string {
  return path.relative(config.dataDir, absolutePath).split(path.sep).join('/');
}

function absoluteFromDataDir(config: AppConfig, relativePath: string): string {
  return path.resolve(config.dataDir, relativePath);
}

export interface AddAttachmentInput {
  issue: string;
  filePath: string;
  name?: string;
  actor: string;
}

export interface AddAttachmentResult {
  attachment: Attachment;
  deduplicated: boolean;
}

export async function addAttachmentFromPath(
  db: Database,
  config: AppConfig,
  input: AddAttachmentInput,
): Promise<AddAttachmentResult> {
  const issue = requireIssueRow(db, input.issue);
  const actor = requireActorRow(db, input.actor);

  let stat: fs.Stats;
  try {
    stat = fs.statSync(input.filePath);
  } catch {
    throw new DomainError('validation_error', `Attachment path does not exist: ${input.filePath}`);
  }
  if (!stat.isFile()) {
    throw new DomainError('validation_error', `Attachment path is not a file: ${input.filePath}`);
  }
  if (stat.size > MAX_ATTACHMENT_BYTES) {
    throw new DomainError('attachment_too_large', 'Attachment exceeds the 25 MB limit');
  }

  const originalName = input.name ?? path.basename(input.filePath);
  if (originalName.length === 0 || originalName.length > 255) {
    throw new DomainError('validation_error', 'Attachment filename must be 1–255 characters');
  }
  if (stat.size <= 0) {
    throw new DomainError('validation_error', 'Attachment is empty');
  }
  const extension = extensionOf(originalName);
  const allowed = ALLOWED_TYPES[extension];
  if (!allowed) {
    throw new DomainError('unsupported_type', `Unsupported attachment type: .${extension}`);
  }

  const buffer = fs.readFileSync(input.filePath);
  const sha256 = createHash('sha256').update(buffer).digest('hex');

  const existing = findActiveAttachmentBySha(db, issue.id, sha256);
  if (existing) {
    return {
      attachment: attachmentRowToAttachment(db, existing),
      deduplicated: true,
    };
  }

  if (allowed.kind !== 'text') {
    const sniffed = await fileTypeFromFile(input.filePath);
    if (!sniffed || sniffed.mime !== allowed.mime) {
      throw new DomainError(
        'unsupported_type',
        `Attachment content does not match its extension: ${originalName}`,
      );
    }
  } else if (buffer.includes(0)) {
    throw new DomainError('unsupported_type', 'Text attachment contains binary data');
  }

  const id = newId();
  const directory = path.join(config.attachmentsDir, id);
  const safeName = sanitizeAttachmentName(originalName);
  const destination = path.join(directory, safeName);

  try {
    fs.mkdirSync(directory, { recursive: true });
    fs.copyFileSync(input.filePath, destination);

    let textPath: string | null = null;
    if (allowed.kind === 'text') {
      const text = buffer.subarray(0, MAX_TEXT_BYTES).toString('utf8');
      if (text.trim().length > 0) {
        const sidecar = `${destination}.text`;
        fs.writeFileSync(sidecar, text, 'utf8');
        textPath = relativeToDataDir(config, sidecar);
      }
    } else if (allowed.kind === 'pdf') {
      try {
        const extracted = await extractText(new Uint8Array(buffer), { mergePages: true });
        const text = typeof extracted.text === 'string' ? extracted.text : '';
        if (text.trim().length > 0) {
          const sidecar = `${destination}.text`;
          fs.writeFileSync(sidecar, text.slice(0, MAX_PDF_TEXT_BYTES), 'utf8');
          textPath = relativeToDataDir(config, sidecar);
        }
      } catch {
        // Scanned or malformed PDFs remain metadata-only; OCR is out of scope.
      }
    }

    const attachment = createAttachmentRecord(db, {
      id,
      issue: issue.id,
      original_name: originalName,
      stored_path: relativeToDataDir(config, destination),
      mime_type: allowed.mime,
      size_bytes: stat.size,
      sha256,
      text_path: textPath,
      actor: actor.id,
    });

    if (attachment.id !== id) {
      // Another upload of the same bytes won the race; keep the existing row/file.
      fs.rmSync(directory, { recursive: true, force: true });
      return { attachment, deduplicated: true };
    }

    return { attachment, deduplicated: false };
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

export interface ReadAttachmentInput {
  attachmentId: string;
  actor: string;
  mode?: 'auto' | 'text' | 'metadata';
}

export interface ReadAttachmentResult {
  attachment: Attachment;
  text?: string;
  truncated?: boolean;
  image?: { mimeType: string; data: string };
}

function readTextSidecar(config: AppConfig, attachment: {
  stored_path: string;
  text_path: string | null;
  mime_type: string;
}): string | undefined {
  const pathToRead = attachment.text_path
    ? absoluteFromDataDir(config, attachment.text_path)
    : attachment.mime_type.startsWith('text/')
      ? absoluteFromDataDir(config, attachment.stored_path)
      : null;
  if (!pathToRead || !fs.existsSync(pathToRead)) return undefined;
  const buffer = fs.readFileSync(pathToRead);
  return buffer.subarray(0, MAX_TEXT_BYTES).toString('utf8');
}

export async function readAttachmentForActor(
  db: Database,
  config: AppConfig,
  input: ReadAttachmentInput,
): Promise<ReadAttachmentResult> {
  const row = findAttachmentRow(db, input.attachmentId);
  if (!row || row.deleted_at) {
    throw new DomainError('not_found', `Attachment not found: ${input.attachmentId}`);
  }
  const actor = requireActorRow(db, input.actor);
  const attachment = attachmentRowToAttachment(db, row);
  const mode = input.mode ?? 'auto';

  if (mode === 'metadata') {
    return { attachment };
  }

  const text = readTextSidecar(config, row);
  const isImage = row.mime_type.startsWith('image/');
  if (mode === 'text') {
    if (text === undefined) {
      throw new DomainError('text_unavailable', 'This Attachment has no extractable text');
    }
    return { attachment, text, truncated: false };
  }

  if (text !== undefined) {
    return { attachment, text, truncated: false };
  }

  if (isImage && actor.can_read_images === 1) {
    if (row.size_bytes > MAX_IMAGE_CONTEXT_BYTES) {
      return { attachment };
    }
    const data = fs.readFileSync(absoluteFromDataDir(config, row.stored_path)).toString('base64');
    return { attachment, image: { mimeType: row.mime_type, data } };
  }

  return { attachment };
}

export interface ResolvedAttachmentFile {
  row: AttachmentRow;
  absolutePath: string;
}

/**
 * Resolve an Attachment to a real path inside the managed data directory.
 * The database row is the only source of the path; a row that points outside
 * the data directory (or at a missing/non-file target) is treated as not found.
 */
export function resolveAttachmentFile(
  db: Database,
  config: AppConfig,
  id: string,
): ResolvedAttachmentFile {
  const row = findAttachmentRow(db, id);
  if (!row || row.deleted_at) {
    throw new DomainError('not_found', `Attachment not found: ${id}`);
  }

  let realDataDir: string;
  let realPath: string;
  try {
    realDataDir = fs.realpathSync(config.dataDir);
    realPath = fs.realpathSync(absoluteFromDataDir(config, row.stored_path));
  } catch {
    throw new DomainError('not_found', `Attachment file is missing: ${id}`);
  }

  const relative = path.relative(realDataDir, realPath);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new DomainError('not_found', `Attachment file is unavailable: ${id}`);
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(realPath);
  } catch {
    throw new DomainError('not_found', `Attachment file is missing: ${id}`);
  }
  if (!stat.isFile()) {
    throw new DomainError('not_found', `Attachment file is unavailable: ${id}`);
  }

  return { row, absolutePath: realPath };
}
