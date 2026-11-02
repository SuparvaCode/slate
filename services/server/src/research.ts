/**
 * Looking things up for the AI: web search, image search, YouTube videos and their captions.
 *
 * Web and image search go through the Delphos search functions (SLATE_SEARCH_* in .env). Image
 * bytes are fetched here and handed to the browser same-origin, so the board can shrink them into
 * a picture it saves; that fetch only reaches public addresses.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { env } from './env.ts';
import { HttpError } from './http.ts';

const TIMEOUT_MS = 15_000;
const CACHE_MS = 10 * 60_000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

export interface WebSource {
  title: string;
  url: string;
  snippet: string;
}

export interface WebResult {
  summary: string;
  sources: WebSource[];
}

export interface ImageHit {
  title: string;
  imageUrl: string;
  thumbUrl: string;
  sourceUrl: string;
  site: string;
  width: number;
  height: number;
}

export interface VideoHit {
  id: string;
  title: string;
  url: string;
  thumb: string;
  channel: string;
}

// --- a small cache, so the same lookup in one study session is not repeated ---------------------

const cache = new Map<string, { at: number; value: unknown }>();

async function cached<T>(key: string, make: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_MS) return hit.value as T;
  const value = await make();
  if (cache.size > 300) {
    for (const [k, v] of cache) if (now - v.at >= CACHE_MS) cache.delete(k);
    if (cache.size > 300) cache.clear();
  }
  cache.set(key, { at: now, value });
  return value;
}

const str = (v: unknown, max = 300) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const isHttp = (u: string) => /^https?:\/\//i.test(u);

function timed(signal?: AbortSignal): AbortSignal {
  const t = AbortSignal.timeout(TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, t]) : t;
}

function searchConfig(kind: 'web' | 'image') {
  const url = kind === 'web' ? env('SLATE_SEARCH_WEB_URL') : env('SLATE_SEARCH_IMAGE_URL');
  const key = env('SLATE_SEARCH_KEY');
  if (!url || !key) throw new HttpError(503, 'Search is not set up on this server (SLATE_SEARCH_* in .env).');
  return { url, key };
}

// --- web search ---------------------------------------------------------------------------------

export function webSearch(query: string, signal?: AbortSignal): Promise<WebResult> {
  const q = query.trim().slice(0, 200);
  return cached(`web:${q.toLowerCase()}`, async () => {
    const { url, key } = searchConfig('web');
    let r: Response;
    try {
      r = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q }),
        signal: timed(signal),
      });
    } catch (e) {
      if (signal?.aborted) throw e;
      throw new HttpError(502, 'Web search could not be reached.');
    }
    if (!r.ok) throw new HttpError(502, `Web search failed (HTTP ${r.status}).`);
    const data = (await r.json().catch(() => null)) as { internet_data?: unknown; sources?: unknown[] } | null;
    const sources: WebSource[] = (Array.isArray(data?.sources) ? data.sources : [])
      .map((s) => s as Record<string, unknown>)
      .map((s) => ({ title: str(s.title, 160), url: str(s.url, 500), snippet: str(s.description, 300) }))
      .filter((s) => s.title && isHttp(s.url))
      .slice(0, 10);
    return { summary: str(data?.internet_data, 2500), sources };
  });
}

// --- image search -------------------------------------------------------------------------------

export function imageSearch(query: string, signal?: AbortSignal): Promise<ImageHit[]> {
  const q = query.trim().slice(0, 160);
  return cached(`img:${q.toLowerCase()}`, async () => {
    const { url, key } = searchConfig('image');
    let r: Response;
    try {
      r = await fetch(`${url}?q=${encodeURIComponent(q)}`, { headers: { Authorization: `Bearer ${key}` }, signal: timed(signal) });
    } catch (e) {
      if (signal?.aborted) throw e;
      throw new HttpError(502, 'Image search could not be reached.');
    }
    if (!r.ok) throw new HttpError(502, `Image search failed (HTTP ${r.status}).`);
    const data = (await r.json().catch(() => null)) as { images?: unknown[] } | null;
    return (Array.isArray(data?.images) ? data.images : [])
      .map((i) => i as Record<string, unknown>)
      .map((i) => ({
        title: str(i.title, 160),
        imageUrl: str(i.imageUrl, 1000),
        thumbUrl: str(i.thumbUrl, 1000),
        sourceUrl: str(i.sourceUrl, 1000),
        site: str(i.sourceSite, 80),
        width: num(i.width),
        height: num(i.height),
      }))
      .filter((i) => isHttp(i.imageUrl) && isHttp(i.thumbUrl))
      .slice(0, 30);
  });
}

// --- fetching images safely --------------------------------------------------------------------

/** True for addresses that must never be fetched on a user's behalf: loopback, private, link-local... */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  const v = ip.toLowerCase();
  if (v === '::' || v === '::1') return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (mapped) return isPrivateAddress(mapped[1]);
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v);
}

async function assertPublic(url: URL): Promise<void> {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new HttpError(400, 'Only web images can be imported.');
  if (url.username || url.password) throw new HttpError(400, 'That image address is not allowed.');
  if (url.port && url.port !== '80' && url.port !== '443') throw new HttpError(400, 'That image address is not allowed.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
    throw new HttpError(400, 'That image address is not allowed.');
  }
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw new HttpError(404, 'That image could not be found.');
  if (addrs.some((a) => isPrivateAddress(a.address))) throw new HttpError(400, 'That image address is not allowed.');
}

/**
 * GET of a public URL, following up to 3 redirects and checking every hop, read to at most
 * `maxBytes`. `accept` checks the content type before the body is read.
 */
async function safeGet(
  raw: string, accept: RegExp, maxBytes: number, what: string, signal?: AbortSignal,
): Promise<{ type: string; body: Buffer }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(400, `That is not ${what} address.`);
  }
  const s = timed(signal);
  for (let hop = 0; hop < 4; hop++) {
    await assertPublic(url);
    let r: Response;
    try {
      r = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': UA, Accept: '*/*' }, signal: s });
    } catch (e) {
      if (signal?.aborted) throw e;
      throw new HttpError(502, `That ${what === 'an image' ? 'image' : 'page'} could not be downloaded.`);
    }
    if (r.status >= 300 && r.status < 400) {
      const next = r.headers.get('location');
      if (!next) break;
      url = new URL(next, url);
      continue;
    }
    if (!r.ok || !r.body) throw new HttpError(502, `Download failed (HTTP ${r.status}).`);
    const type = (r.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!accept.test(type)) throw new HttpError(415, `That address is not ${what}.`);
    if (Number(r.headers.get('content-length') ?? 0) > maxBytes) throw new HttpError(413, 'That file is too large.');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of r.body as unknown as AsyncIterable<Uint8Array>) {
      size += chunk.byteLength;
      if (size > maxBytes) throw new HttpError(413, 'That file is too large.');
      chunks.push(Buffer.from(chunk));
    }
    return { type, body: Buffer.concat(chunks) };
  }
  throw new HttpError(502, 'That address redirects too many times.');
}

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
// No SVG: an SVG can carry script, and the board only needs pixels.
const IMAGE_TYPES = /^image\/(png|jpe?g|gif|webp|bmp|avif)$/;

/** An image's bytes, for the board to shrink and keep. At most 6 MB, images only, public hosts only. */
export const fetchImage = (raw: string, signal?: AbortSignal) => safeGet(raw, IMAGE_TYPES, MAX_IMAGE_BYTES, 'an image', signal);

const MAX_PAGE_BYTES = 1.5 * 1024 * 1024;
const MAX_PAGE_TEXT = 8000;

/** A web page's readable text: scripts, styles and markup removed, whitespace collapsed. */
export function htmlText(html: string): string {
  const body = /<main[\s\S]*?<\/main>|<article[\s\S]*?<\/article>/i.exec(html)?.[0] ?? html;
  return decodeEntities(
    body
      .replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(br|\/p|\/li|\/h[1-6]|\/tr|\/div)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** The text of a public web page, for the notes' research. Cached like searches. */
export function readPage(raw: string, signal?: AbortSignal): Promise<string> {
  return cached(`page:${raw}`, async () => {
    const { body } = await safeGet(raw, /^(text\/html|application\/xhtml\+xml|text\/plain)$/, MAX_PAGE_BYTES, 'a web page', signal);
    return htmlText(body.toString('utf8')).slice(0, MAX_PAGE_TEXT);
  });
}

// --- YouTube ------------------------------------------------------------------------------------

/** The 11-character video id from any YouTube link, or null. */
export function youtubeId(input: string): string | null {
  const s = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  let u: URL;
  try {
    u = new URL(s.startsWith('http') ? s : `https://${s}`);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = u.pathname.slice(1, 12);
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    id = u.searchParams.get('v') ?? /^\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/.exec(u.pathname)?.[1] ?? null;
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

export interface VideoInfo {
  id: string;
  title: string;
  channel: string;
  thumb: string;
  description: string;
  /** Seconds, 0 when unknown. */
  length: number;
  /** The spoken words, empty when the video has no captions we could read. */
  transcript: string;
  captionLang: string;
}

const MAX_TRANSCRIPT = 24_000;

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

/** Pulls one JSON object that follows `marker` out of a page, by matching braces. */
function jsonAfter(html: string, marker: string): any {
  const at = html.indexOf(marker);
  if (at < 0) return null;
  const start = html.indexOf('{', at + marker.length);
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try {
        return JSON.parse(html.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

interface Track {
  baseUrl: string;
  languageCode: string;
  kind?: string;
}

function pickTrack(tracks: Track[]): Track | null {
  if (!tracks.length) return null;
  const en = (t: Track) => t.languageCode?.startsWith('en');
  const hi = (t: Track) => t.languageCode?.startsWith('hi');
  return (
    tracks.find((t) => en(t) && t.kind !== 'asr') ??
    tracks.find(en) ??
    tracks.find((t) => hi(t) && t.kind !== 'asr') ??
    tracks.find(hi) ??
    tracks[0]
  );
}

const ANDROID_VERSION = '20.10.38';
const ANDROID_UA = `com.google.android.youtube/${ANDROID_VERSION} (Linux; U; Android 11) gzip`;

async function readTrack(track: Track, signal: AbortSignal): Promise<string> {
  const url = new URL(decodeEntities(track.baseUrl));
  if (!/(^|\.)youtube\.com$/.test(url.hostname)) return '';
  url.searchParams.set('fmt', 'json3');
  // A track listed by the Android player API only answers the Android app's user agent.
  let text = '';
  for (const ua of [UA, ANDROID_UA]) {
    const r = await fetch(url, { headers: { 'User-Agent': ua }, signal });
    if (r.ok) text = await r.text();
    if (text.trim()) break;
  }
  if (!text.trim()) return '';
  try {
    const data = JSON.parse(text) as { events?: { segs?: { utf8?: string }[] }[] };
    return (data.events ?? [])
      .map((e) => (e.segs ?? []).map((s) => s.utf8 ?? '').join(''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  } catch {
    // XML answers: the old format uses <text>, the newer srv3 format <p> with <s> word spans.
    return [...text.matchAll(/<(?:text|p)\b[^>]*>([\s\S]*?)<\/(?:text|p)>/g)]
      .map((m) => decodeEntities(m[1].replace(/<[^>]+>/g, '')))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}

/** Asks YouTube's own player API for the video, the way its Android app does; it lists caption tracks too. */
async function playerApi(id: string, signal: AbortSignal): Promise<any> {
  const r = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': ANDROID_UA },
    body: JSON.stringify({
      videoId: id,
      context: { client: { clientName: 'ANDROID', clientVersion: ANDROID_VERSION, androidSdkVersion: 30, hl: 'en', gl: 'IN' } },
    }),
    signal,
  });
  return r.ok ? r.json().catch(() => null) : null;
}

/** A video's title, description and spoken words. Captions are best effort: YouTube may refuse them. */
export function videoInfo(id: string, signal?: AbortSignal): Promise<VideoInfo> {
  return cached(`yt:${id}`, async () => {
    const s = timed(signal);
    const info: VideoInfo = { id, title: '', channel: '', thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, description: '', length: 0, transcript: '', captionLang: '' };

    // oEmbed is the most reliable way to learn the title, and tells us the video exists.
    try {
      const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`, { signal: s });
      if (r.status === 404 || r.status === 400) throw new HttpError(404, 'That YouTube video could not be found.');
      if (r.ok) {
        const o = (await r.json()) as { title?: string; author_name?: string; thumbnail_url?: string };
        info.title = str(o.title, 200);
        info.channel = str(o.author_name, 100);
        if (o.thumbnail_url) info.thumb = o.thumbnail_url;
      }
    } catch (e) {
      if (e instanceof HttpError || signal?.aborted) throw e;
    }

    let tracks: Track[] = [];
    try {
      const r = await fetch(`https://www.youtube.com/watch?v=${id}&hl=en`, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', Cookie: 'CONSENT=YES+1' },
        signal: s,
      });
      if (r.ok) {
        const player = jsonAfter(await r.text(), 'ytInitialPlayerResponse');
        const d = player?.videoDetails;
        if (d) {
          info.title ||= str(d.title, 200);
          info.channel ||= str(d.author, 100);
          info.description = str(d.shortDescription, 3000);
          info.length = Number(d.lengthSeconds) || 0;
        }
        tracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
      }
    } catch (e) {
      if (signal?.aborted) throw e;
    }

    const tryTracks = async (list: Track[]) => {
      const t = pickTrack(list);
      if (!t) return;
      try {
        const words = await readTrack(t, s);
        if (words) {
          info.transcript = words.slice(0, MAX_TRANSCRIPT);
          info.captionLang = t.languageCode;
        }
      } catch (e) {
        if (signal?.aborted) throw e;
      }
    };
    await tryTracks(tracks);
    if (!info.transcript) {
      try {
        const p = await playerApi(id, s);
        const d = p?.videoDetails;
        if (d) {
          info.title ||= str(d.title, 200);
          info.description ||= str(d.shortDescription, 3000);
          info.length ||= Number(d.lengthSeconds) || 0;
        }
        await tryTracks(p?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []);
      } catch (e) {
        if (signal?.aborted) throw e;
      }
    }
    if (!info.title) throw new HttpError(404, 'That YouTube video could not be found.');
    return info;
  });
}

/** YouTube videos for a topic, found through web search (the Delphos video function no longer answers). */
export async function videoSearch(query: string, signal?: AbortSignal): Promise<VideoHit[]> {
  const res = await webSearch(`${query} site:youtube.com`, signal);
  const seen = new Set<string>();
  const out: VideoHit[] = [];
  for (const s of res.sources) {
    const id = youtubeId(s.url);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      title: s.title.replace(/\s*-\s*YouTube\s*$/i, ''),
      url: `https://www.youtube.com/watch?v=${id}`,
      thumb: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
      channel: '',
    });
  }
  return out.slice(0, 8);
}
