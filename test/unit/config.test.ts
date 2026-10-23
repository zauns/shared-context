import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanTmpDir, ensureDataDirs } from '../../src/server/config.js';
import { testConfig } from '../helpers/http.js';

describe('startup temp cleanup', () => {
  it('removes leftover upload staging files and directories', () => {
    const config = testConfig();
    ensureDataDirs(config);
    fs.writeFileSync(path.join(config.tmpDir, 'upload-leftover.tmp'), 'partial');
    fs.mkdirSync(path.join(config.tmpDir, 'nested'), { recursive: true });
    fs.writeFileSync(path.join(config.tmpDir, 'nested', 'upload.tmp'), 'partial');

    cleanTmpDir(config);

    expect(fs.readdirSync(config.tmpDir)).toHaveLength(0);
    expect(fs.existsSync(config.tmpDir)).toBe(true);
  });
});