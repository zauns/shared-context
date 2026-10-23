import fs from 'node:fs';
import path from 'node:path';
import { DomainError, validationError } from './errors.js';
import type { ProjectDoc } from './types.js';

export const DEFAULT_DOC_ALLOWLIST = [
  'AGENTS.md',
  'CONTEXT.md',
  'README.md',
  'docs/**/*.md',
  'docs/**/*.txt',
];

const MAX_DOC_BYTES = 256 * 1024;

function normalizeRelativePath(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '');
  if (
    normalized.length === 0 ||
    normalized.startsWith('/') ||
    normalized.split('/').includes('..') ||
    /^[A-Za-z]:/.test(normalized)
  ) {
    validationError(`Invalid project doc path: ${value}`);
  }
  return normalized;
}

export function validateDocAllowlist(patterns: string[]): string[] {
  if (patterns.length > 100) {
    throw new DomainError('validation_error', 'Doc allowlist has too many entries');
  }
  return patterns.map((pattern) => {
    const trimmed = pattern.trim();
    if (!trimmed) {
      throw new DomainError(
        'validation_error',
        'Doc allowlist entries must not be empty',
      );
    }
    return normalizeRelativePath(trimmed);
  });
}

// A small glob implementation for the allowlist: `*`, `?`, and `**/`.
export function globToRegExp(pattern: string): RegExp {
  const source = pattern.replace(/\\/g, '/');
  let expression = '^';
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '*') {
      if (source[index + 1] === '*') {
        index += 1;
        if (source[index + 1] === '/') {
          index += 1;
          expression += '(?:.*/)?';
        } else {
          expression += '.*';
        }
      } else {
        expression += '[^/]*';
      }
    } else if (character === '?') {
      expression += '[^/]';
    } else {
      expression += character.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`${expression}$`);
}

export function isPathAllowed(relativePath: string, allowlist: string[]): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  return allowlist.some((pattern) => globToRegExp(pattern).test(normalized));
}

function insideRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function walkFiles(directory: string, root: string, output: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walkFiles(absolute, root, output);
    } else if (entry.isFile()) {
      output.push(path.relative(root, absolute).replace(/\\/g, '/'));
    }
  }
}

export function listProjectDocs(rootPath: string | null, allowlist: string[]): ProjectDoc[] {
  if (!rootPath || !fs.existsSync(rootPath)) return [];
  let root: string;
  try {
    root = fs.realpathSync(rootPath);
  } catch {
    return [];
  }
  if (!fs.statSync(root).isDirectory()) return [];

  const candidates = new Set<string>();
  for (const pattern of allowlist) {
    if (pattern.includes('**')) {
      const prefix = pattern.slice(0, pattern.indexOf('**')).replace(/\/$/, '');
      const directory = prefix ? path.join(root, prefix) : root;
      if (!insideRoot(root, path.resolve(directory))) continue;
      if (!fs.existsSync(directory)) continue;
      const files: string[] = [];
      walkFiles(directory, root, files);
      for (const file of files) {
        if (isPathAllowed(file, [pattern])) candidates.add(file);
      }
    } else if (isPathAllowed(pattern, [pattern])) {
      const absolute = path.join(root, pattern);
      if (!insideRoot(root, path.resolve(absolute))) continue;
      if (fs.existsSync(absolute) && fs.statSync(absolute).isFile()) {
        candidates.add(pattern);
      }
    }
  }

  return [...candidates]
    .sort()
    .map((relative) => {
      const absolute = path.join(root, relative);
      try {
        return { path: relative, size: fs.statSync(absolute).size };
      } catch {
        return { path: relative, size: 0 };
      }
    });
}

export interface ProjectDocContent {
  path: string;
  content: string;
  truncated: boolean;
  size: number;
}

export function readProjectDoc(
  rootPath: string | null,
  allowlist: string[],
  requestedPath: string,
): ProjectDocContent {
  if (!rootPath) {
    throw new DomainError('not_found', 'Project has no root_path configured');
  }
  const relative = normalizeRelativePath(requestedPath);
  if (!isPathAllowed(relative, allowlist)) {
    throw new DomainError('doc_not_allowed', `Project doc is not allowlisted: ${relative}`);
  }

  let root: string;
  try {
    root = fs.realpathSync(rootPath);
  } catch {
    throw new DomainError('not_found', `Project root does not exist: ${rootPath}`);
  }

  const absolute = path.resolve(root, relative);
  let real: string;
  try {
    real = fs.realpathSync(absolute);
  } catch {
    throw new DomainError('not_found', `Project doc not found: ${relative}`);
  }
  if (!insideRoot(root, real) || !fs.statSync(real).isFile()) {
    throw new DomainError('doc_not_allowed', `Project doc escapes the project root: ${relative}`);
  }

  const size = fs.statSync(real).size;
  const buffer = fs.readFileSync(real);
  const truncated = buffer.length > MAX_DOC_BYTES;
  return {
    path: relative,
    content: buffer.subarray(0, MAX_DOC_BYTES).toString('utf8'),
    truncated,
    size,
  };
}
