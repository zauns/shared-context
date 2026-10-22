import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from './connection.js';

interface MigrationFile {
  version: number;
  name: string;
  path: string;
}

function listMigrations(directory: string): MigrationFile[] {
  const migrations: MigrationFile[] = [];
  for (const name of fs.readdirSync(directory)) {
    if (!name.endsWith('.sql')) continue;
    const match = /^(\d+)_/.exec(name);
    if (!match) {
      throw new Error(`Migration filename must start with a number: ${name}`);
    }
    migrations.push({
      version: Number(match[1]),
      name,
      path: path.join(directory, name),
    });
  }
  migrations.sort((a, b) => a.version - b.version);
  return migrations;
}

function currentVersion(db: Database): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined;
  return row?.user_version ?? 0;
}

export function migrate(
  db: Database,
  migrationsDirectory: string | URL = new URL('./migrations/', import.meta.url),
): number[] {
  const directory =
    migrationsDirectory instanceof URL ? fileURLToPath(migrationsDirectory) : migrationsDirectory;
  const migrations = listMigrations(directory);
  if (migrations.length === 0) {
    throw new Error(`No migrations found in ${directory}`);
  }

  const applied: number[] = [];
  let version = currentVersion(db);
  for (const migration of migrations) {
    if (migration.version <= version) continue;
    const sql = fs.readFileSync(migration.path, 'utf8');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(sql);
      db.exec(`PRAGMA user_version = ${migration.version}`);
      db.exec('COMMIT');
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // Keep the original migration error.
      }
      throw new Error(`Migration ${migration.name} failed`, { cause: error });
    }
    version = migration.version;
    applied.push(migration.version);
  }
  return applied;
}
