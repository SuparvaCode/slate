/** Environment: loads services/server/.env (if present) and exposes typed settings. */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** services/server, whether running from src/ or dist/. */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadDotEnv(path: string): void {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    // Real environment variables win over the file, as with python-dotenv's default.
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv(process.env.SLATE_ENV_FILE ? resolve(process.env.SLATE_ENV_FILE) : resolve(ROOT, '.env'));

export const env = (name: string, fallback = ''): string => {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
};

export const flag = (name: string, fallback = false): boolean => {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return v === '1' || v.toLowerCase() === 'true';
};

export const int = (name: string, fallback: number): number => {
  const n = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

export const isProduction = (): boolean => process.env.NODE_ENV === 'production';
let mockWarned = false;
/** SLATE_MOCK=1 is a development switch, like SLATE_AUTH_DISABLED: a production server ignores it. */
export const isMock = (): boolean => {
  if (process.env.SLATE_MOCK !== '1') return false;
  if (!isProduction()) return true;
  if (!mockWarned) {
    mockWarned = true;
    console.error('[mock] SLATE_MOCK=1 is IGNORED because NODE_ENV=production. Answers come from the real model.');
  }
  return false;
};
export const provider = (): string => env('SLATE_PROVIDER', 'groq');

export const samplesDir = (): string => resolve(ROOT, env('SLATE_SAMPLES_DIR', 'data/samples'));
export const webDist = (): string => resolve(ROOT, env('SLATE_WEB_DIST', '../../apps/web/dist'));
