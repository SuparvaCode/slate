/**
 * ICE servers for voice chat, with short-lived TURN credentials so a long-term secret never
 * reaches the browser. Two ways to run TURN, picked by what is configured:
 *
 * - Cloudflare Realtime TURN: CF_TURN_KEY_ID + CF_TURN_API_TOKEN. Credentials come from
 *   Cloudflare's generate-ice-servers API.
 * - Your own coturn (use-auth-secret): TURN_URLS + TURN_SECRET. Credentials are the standard
 *   time-limited HMAC pair (username "expiry:uid", password base64(HMAC-SHA1(secret, username))).
 *
 * With neither, only public STUN is returned and calls work on open networks only.
 */
import { createHmac } from 'node:crypto';
import { env, int } from './env.ts';
import { HttpError } from './http.ts';

export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

const STUN: IceServer = { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] };

/** Credential lifetime: longer than any study call is expected to last. */
const ttl = () => Math.min(86_400, Math.max(600, int('TURN_TTL_S', 4 * 3600)));

export function turnMode(): 'cloudflare' | 'coturn' | 'none' {
  if (env('CF_TURN_KEY_ID') && env('CF_TURN_API_TOKEN')) return 'cloudflare';
  if (env('TURN_URLS') && env('TURN_SECRET')) return 'coturn';
  return 'none';
}

/** Browsers block port 53; a TURN URL on it only makes the connection wait for a timeout. */
const usable = (url: string) => !/:53(\?|$)/.test(url);

async function cloudflare(signal?: AbortSignal): Promise<IceServer[]> {
  const res = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env('CF_TURN_KEY_ID'))}/credentials/generate-ice-servers`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${env('CF_TURN_API_TOKEN')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: ttl() }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000),
    },
  );
  if (!res.ok) {
    // Never echo Cloudflare's body: it can name the key.
    console.error('[turn] cloudflare credentials failed:', res.status);
    throw new HttpError(502, 'Voice relay is unavailable right now.');
  }
  const data = (await res.json()) as { iceServers?: unknown };
  const list = Array.isArray(data.iceServers) ? data.iceServers : [data.iceServers];
  const out: IceServer[] = [];
  for (const s of list) {
    if (!s || typeof s !== 'object') continue;
    const raw = (s as { urls?: unknown }).urls;
    const urls = (Array.isArray(raw) ? raw : [raw]).filter((u): u is string => typeof u === 'string' && usable(u));
    if (!urls.length) continue;
    const { username, credential } = s as { username?: unknown; credential?: unknown };
    out.push({ urls, ...(typeof username === 'string' ? { username } : {}), ...(typeof credential === 'string' ? { credential } : {}) });
  }
  if (!out.length) throw new HttpError(502, 'Voice relay is unavailable right now.');
  return out;
}

function coturn(uid: string): IceServer[] {
  const username = `${Math.floor(Date.now() / 1000) + ttl()}:${uid}`;
  const credential = createHmac('sha1', env('TURN_SECRET')).update(username).digest('base64');
  const urls = env('TURN_URLS').split(/[\s,]+/).filter((u) => /^(turns?|stun):/.test(u) && usable(u));
  return [STUN, { urls, username, credential }];
}

export async function iceServers(uid: string, signal?: AbortSignal): Promise<{ iceServers: IceServer[]; relay: boolean; ttl: number }> {
  const mode = turnMode();
  if (mode === 'cloudflare') return { iceServers: await cloudflare(signal), relay: true, ttl: ttl() };
  if (mode === 'coturn') return { iceServers: coturn(uid), relay: true, ttl: ttl() };
  return { iceServers: [STUN], relay: false, ttl: 0 };
}
