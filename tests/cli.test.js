import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.join(__dirname, '..', 'transcribe.js');

let tmpDir;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'transcribe-cli-test-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function runCli(args = [], { env = {} } = {}) {
  return spawnSync('bun', [CLI_PATH, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      DEEPGRAM_API_KEY: 'test-key-not-used',
      // Force chalk to emit no color so we can match plain strings.
      FORCE_COLOR: '0',
      NO_COLOR: '1',
      ...env,
    },
  });
}

describe('CLI argument handling', () => {
  test('exits with code 1 and prints usage when given no arguments', () => {
    const result = runCli([]);
    expect(result.status).toBe(1);
    const out = result.stdout + result.stderr;
    expect(out).toContain('Please provide at least one file path');
    expect(out).toContain('Usage:');
    expect(out).toContain('--speakers');
  });

  test('exits with code 1 when only --speakers is provided', () => {
    const result = runCli(['--speakers']);
    expect(result.status).toBe(1);
    const out = result.stdout + result.stderr;
    expect(out).toContain('Please provide at least one file path');
  });

  test('exits with code 1 when no files match the provided patterns', () => {
    const pattern = path.join(tmpDir, 'definitely-not-here-*.mp3');
    const result = runCli([pattern]);
    expect(result.status).toBe(1);
    const out = result.stdout + result.stderr;
    expect(out).toContain('No matching files found');
  });
});
