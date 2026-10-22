import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export interface AppConfig {
  port: number;
  host: string;
  dataDir: string;
  configPath: string;
  dbPath: string;
  attachmentsDir: string;
  tmpDir: string;
  backupDir: string;
  logDir: string;
  token: string;
  logLevel: string;
  backupHour: number;
  backupRetentionDays: number;
}

interface FileConfig {
  port?: number;
  token?: string;
  data_dir?: string;
  backup_dir?: string;
  backup_hour?: number;
  backup_retention_days?: number;
  log_level?: string;
  theme?: string;
}

function defaultDataDir(): string {
  if (process.platform === 'win32') {
    return path.join(
      process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'),
      'shared-context',
    );
  }
  return path.join(os.homedir(), '.local', 'share', 'shared-context');
}

function defaultConfigPath(): string {
  if (process.platform === 'win32') {
    return path.join(
      process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'),
      'shared-context',
      'config.json',
    );
  }
  return path.join(os.homedir(), '.config', 'shared-context', 'config.json');
}

function parsePort(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return port;
}

function readFileConfig(configPath: string): FileConfig {
  if (!fs.existsSync(configPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8')) as FileConfig;
  } catch (error) {
    throw new Error(`Cannot parse config file ${configPath}`, { cause: error });
  }
}

function writeFileConfig(configPath: string, file: FileConfig): void {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const defaultConfig = defaultConfigPath();
  const configPath = overrides.configPath ?? process.env.SHARED_CONTEXT_CONFIG ?? defaultConfig;
  const file = readFileConfig(configPath);

  const dataDir =
    overrides.dataDir ??
    process.env.SHARED_CONTEXT_DATA_DIR ??
    file.data_dir ??
    defaultDataDir();

  const token =
    overrides.token ??
    process.env.SHARED_CONTEXT_TOKEN ??
    file.token ??
    randomBytes(32).toString('base64url');

  const port =
    overrides.port ??
    parsePort(process.env.SHARED_CONTEXT_PORT) ??
    file.port ??
    4319;

  const config: AppConfig = {
    port,
    host: '127.0.0.1',
    dataDir,
    configPath,
    dbPath: path.join(dataDir, 'data', 'shared-context.db'),
    attachmentsDir: path.join(dataDir, 'data', 'attachments'),
    tmpDir: path.join(dataDir, 'data', 'tmp'),
    backupDir: overrides.backupDir ?? file.backup_dir ?? path.join(dataDir, 'backups'),
    logDir: path.join(dataDir, 'logs'),
    token,
    logLevel: overrides.logLevel ?? process.env.LOG_LEVEL ?? file.log_level ?? 'info',
    backupHour: overrides.backupHour ?? file.backup_hour ?? 3,
    backupRetentionDays: overrides.backupRetentionDays ?? file.backup_retention_days ?? 14,
  };

  if (!fs.existsSync(configPath) || !file.token) {
    writeFileConfig(configPath, {
      port: config.port,
      token: config.token,
      data_dir: config.dataDir,
      backup_dir: config.backupDir,
      backup_hour: config.backupHour,
      backup_retention_days: config.backupRetentionDays,
      log_level: config.logLevel,
      theme: file.theme ?? 'dark',
    });
  }

  return config;
}

export function ensureDataDirs(config: AppConfig): void {
  for (const directory of [
    config.dataDir,
    path.dirname(config.dbPath),
    config.attachmentsDir,
    config.tmpDir,
    config.backupDir,
    config.logDir,
  ]) {
    fs.mkdirSync(directory, { recursive: true });
  }
}
