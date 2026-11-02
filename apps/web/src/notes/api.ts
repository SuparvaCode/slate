/** The study API: notes (plan, section, ask), search, YouTube, and image imports. */
import { ApiError, authFetch } from '../auth/authFetch';
import type { Block, ImageHit, Plan, PlanEvent, Profile, SectionOut, VideoDetails, VideoHit, WebSource } from './types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await authFetch(path, init);
  } catch (err) {
    if (err instanceof ApiError || (err instanceof DOMException && err.name === 'AbortError')) throw err;
    throw new Error('Cannot reach the Slate server.');
  }
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (typeof body.detail === 'string') message = body.detail;
    } catch {
      // keep the status message
    }
    throw new ApiError(res.status, message);
  }
  return res.json() as Promise<T>;
}

const post = (body: unknown, signal?: AbortSignal): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
  signal,
});

export interface PlanRequest {
  prompt: string;
  profile: Profile | null;
  context: string;
  video?: string | null;
  transcript?: string;
}

/**
 * Plans a set of notes and reports each stage as it happens. Always ends with a plan or an error
 * event, including when the connection drops part-way.
 */
export async function planStream(body: PlanRequest, onEvent: (ev: PlanEvent) => void, signal: AbortSignal): Promise<void> {
  let res: Response;
  try {
    res = await authFetch('/api/notes/plan', post({ ...body, video: body.video ?? null, transcript: body.transcript ?? '' }, signal));
  } catch (err) {
    if (signal.aborted || err instanceof ApiError) throw err;
    throw new Error('Cannot reach the Slate server.');
  }
  if (!res.ok || !res.body) {
    let message = `The server answered with HTTP ${res.status}.`;
    try {
      const b = await res.json();
      if (typeof b.detail === 'string') message = b.detail;
    } catch {
      // keep the status message
    }
    throw new ApiError(res.status, message);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let ended = false;
  const handle = (line: string) => {
    const text = line.trim();
    if (!text) return;
    try {
      const ev = JSON.parse(text) as PlanEvent;
      if (ev.type === 'plan' || ev.type === 'error') ended = true;
      onEvent(ev);
    } catch {
      // a partial or garbled line: skip it
    }
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        handle(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
      }
    }
    handle(buffer);
  } catch (err) {
    if (signal.aborted) throw err;
    if (!ended) onEvent({ type: 'error', message: 'The connection dropped while planning.' });
    return;
  }
  if (!ended) onEvent({ type: 'error', message: 'The server stopped before the plan was ready.' });
}

/**
 * What a section request carries of the plan: the sources and habit line stay in the browser, and of
 * the video's words only the part this section is written from goes, to keep each request small.
 */
const planBody = (p: Plan, index: number) => ({
  kind: p.kind, title: p.title, subject: p.subject, topic: p.topic, profile: p.profile, digest: p.digest,
  sections: p.sections.map((s, i) => (i === index ? s : { heading: s.heading, goal: s.goal })),
});

export const writeSection = (
  plan: Plan, index: number, lineChars: number, written: string, extra: string,
  custom: { heading: string; goal: string } | null, signal?: AbortSignal,
) => request<SectionOut>('/api/notes/section', post({ plan: planBody(plan, custom ? -1 : index), index, line_chars: lineChars, written, extra, custom }, signal));

export const askTeacher = (
  body: { question: string; title: string; heading: string; written: string; profile: Profile | null },
  signal?: AbortSignal,
) => request<{ blocks: Block[]; reply: string }>('/api/notes/ask', post(body, signal));

export const searchImages = (q: string, signal?: AbortSignal) =>
  request<{ images: ImageHit[] }>(`/api/search/images?q=${encodeURIComponent(q)}`, { signal }).then((r) => r.images);

export const searchVideos = (q: string, signal?: AbortSignal) =>
  request<{ videos: VideoHit[] }>(`/api/search/videos?q=${encodeURIComponent(q)}`, { signal }).then((r) => r.videos);

export const searchWeb = (q: string, signal?: AbortSignal) =>
  request<{ summary: string; sources: WebSource[] }>(`/api/search/web?q=${encodeURIComponent(q)}`, { signal });

export const fetchVideo = (url: string, signal?: AbortSignal) =>
  request<VideoDetails>(`/api/video?url=${encodeURIComponent(url)}`, { signal });

/** A picture from the web, fetched through the server so the board can keep a copy. */
export async function fetchImageBlob(url: string, signal?: AbortSignal): Promise<Blob> {
  let res: Response;
  try {
    res = await authFetch(`/api/image?url=${encodeURIComponent(url)}`, { signal });
  } catch (err) {
    if (err instanceof ApiError || signal?.aborted) throw err;
    throw new Error('Cannot reach the Slate server.');
  }
  if (!res.ok) {
    let message = `That image could not be imported (HTTP ${res.status}).`;
    try {
      const b = await res.json();
      if (typeof b.detail === 'string') message = b.detail;
    } catch {
      // keep the status message
    }
    throw new ApiError(res.status, message);
  }
  return res.blob();
}

/** The 11-character id from a YouTube link, or null. Matches the server's check. */
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
