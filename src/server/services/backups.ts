import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AppConfig } from '../config.js';
import type { Database } from '../db/connection.js';
import type { Logger } from '../logger.js';

export interface BackupSummary {
  filename: string;
  created_at: string;
  size_bytes: number;
}

export interface LastBackup {
  at: string;
  filename: string;
  size_bytes: number;
  attachment_count: number;
  ok: boolean;
  error?: string;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function timestamp(date: Date): string {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

function snapshotDir(config: AppConfig): string {
  return path.join(config.backupDir, 'db');
}

function uniqueSnapshotPath(
  config: AppConfig,
  date: Date,
): { filename: string; destination: string } {
  const directory = snapshotDir(config);
  const base = `shared-context-${timestamp(date)}`;
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const filename = attempt === 0 ? `${base}.db` : `${base}-${attempt}.db`;
    const destination = path.join(directory, filename);
    if (!fs.existsSync(destination)) return { filename, destination };
  }
  throw new Error('Could not allocate a unique backup filename');
}

function verifySnapshot(destination: string): void {
  const snapshot = new DatabaseSync(destination, { readOnly: true });
  try {
    const integrity = snapshot.prepare('PRAGMA integrity_check').get() as unknown as {
      integrity_check: string;
    };
    if (integrity.integrity_check !== 'ok') {
      throw new Error(`Backup integrity check failed: ${integrity.integrity_check}`);
    }
  } finally {
    snapshot.close();
  }
}

export function mirrorAttachments(config: AppConfig): number {
  if (!fs.existsSync(config.attachmentsDir)) return 0;
  const target = path.join(config.backupDir, 'attachments');
  fs.mkdirSync(target, { recursive: true });
  let count = 0;
  for (const entry of fs.readdirSync(config.attachmentsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    count += 1;
    fs.cpSync(
      path.join(config.attachmentsDir, entry.name),
      path.join(target, entry.name),
      { recursive: true, force: false, errorOnExist: false },
    );
  }
  return count;
}

export function writeLastBackup(config: AppConfig, record: LastBackup): void {
  fs.mkdirSync(config.backupDir, { recursive: true });
  const destination = path.join(config.backupDir, 'last-backup.json');
  const temporary = `${destination}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  fs.rmSync(destination, { force: true });
  fs.renameSync(temporary, destination);
}

export function readLastBackup(config: AppConfig): LastBackup | null {
  if (!config.backupDir) return null;
  const file = path.join(config.backupDir, 'last-backup.json');
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<LastBackup>;
    if (typeof parsed.at !== 'string' || typeof parsed.filename !== 'string') return null;
    return {
      at: parsed.at,
      filename: parsed.filename,
      size_bytes: Number(parsed.size_bytes ?? 0),
      attachment_count: Number(parsed.attachment_count ?? 0),
      ok: parsed.ok === true,
      ...(parsed.error ? { error: parsed.error } : {}),
    };
  } catch {
    return null;
  }
}

export function listBackups(config: AppConfig): BackupSummary[] {
  const directory = snapshotDir(config);
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.db'))
    .flatMap((entry) => {
      try {
        const stat = fs.statSync(path.join(directory, entry.name));
        return [
          {
            filename: entry.name,
            created_at: stat.mtime.toISOString(),
            size_bytes: stat.size,
          },
        ];
      } catch {
        return [];
      }
    })
    .sort(
      (left, right) =>
        right.created_at.localeCompare(left.created_at) ||
        right.filename.localeCompare(left.filename),
    );
}

function pruneSnapshots(config: AppConfig): void {
  const keep = Math.max(1, Math.floor(config.backupRetentionDays));
  for (const backup of listBackups(config).slice(keep)) {
    fs.rmSync(path.join(snapshotDir(config), backup.filename), { force: true });
  }
}

export function createBackup(
  db: Database,
  config: AppConfig,
  now = new Date(),
): LastBackup {
  fs.mkdirSync(snapshotDir(config), { recursive: true });
  const { filename, destination } = uniqueSnapshotPath(config, now);
  try {
    db.prepare('VACUUM INTO ?').run(destination);
    verifySnapshot(destination);
    const attachmentCount = mirrorAttachments(config);
    const record: LastBackup = {
      at: now.toISOString(),
      filename,
      size_bytes: fs.statSync(destination).size,
      attachment_count: attachmentCount,
      ok: true,
    };
    writeLastBackup(config, record);
    pruneSnapshots(config);
    return record;
  } catch (error) {
    fs.rmSync(destination, { force: true });
    const record: LastBackup = {
      at: now.toISOString(),
      filename,
      size_bytes: 0,
      attachment_count: 0,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    writeLastBackup(config, record);
    throw error;
  }
}

export interface BackupScheduler {
  stop: () => void;
}

export function startBackupScheduler(
  db: Database,
  config: AppConfig,
  logger: Logger,
): BackupScheduler {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const run = (reason: string) => {
    if (stopped) return;
    try {
      const record = createBackup(db, config);
      logger.info(
        { reason, filename: record.filename, size_bytes: record.size_bytes },
        'backup complete',
      );
    } catch (error) {
      logger.error({ err: error, reason }, 'backup failed');
    }
  };

  const scheduleNext = () => {
    if (stopped) return;
    const now = new Date();
    const next = new Date(now);
    next.setHours(config.backupHour, 0, 0, 0);
    if (next.getTime() <= now.getTime()) {
      next.setDate(next.getDate() + 1);
    }
    timer = setTimeout(() => {
      run('scheduled');
      scheduleNext();
    }, Math.max(1_000, next.getTime() - now.getTime()));
    timer.unref();
  };

  const last = readLastBackup(config);
  const stale =
    !last?.ok || Date.now() - Date.parse(last.at) >= 24 * 60 * 60 * 1000;
  if (stale) {
    const catchUp = setTimeout(() => run('catch-up'), 0);
    catchUp.unref();
  }
  scheduleNext();

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}