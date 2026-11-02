import type { Health, RecognizeResponse } from './types';
import { ApiError, authFetch } from './auth/authFetch';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await authFetch(path, init);
  } catch (err) {
    if (err instanceof ApiError || (err instanceof DOMException && err.name === 'AbortError')) throw err;
    throw new Error('Cannot reach the Slate API. Is it running on port 8787?');
  }
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (typeof body.detail === 'string') message = body.detail;
    } catch {
      // keep the status message
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const recognizeImage = (image: string) =>
  request<RecognizeResponse>('/api/recognize', json({ image }));

export const sendFeedback = (id: string, correct: boolean, correctedLatex?: string) =>
  request<{ ok: boolean }>('/api/feedback', json({ id, correct, corrected_latex: correctedLatex ?? null }));

export const fetchAccuracy = () =>
  request<{ rated: number; correct: number; accuracy: number | null }>('/api/accuracy');

export const fetchHealth = () => request<Health>('/api/health');

export interface DiagramRequest {
  prompt: string;
  previous?: unknown;
  feedback?: string;
  issues?: string[];
  context?: string;
}

/** The AI writes a diagram; the app validates and solves it. */
export const buildDiagram = (body: DiagramRequest, signal?: AbortSignal) =>
  request<{ diagram: unknown; model: string; ms: number }>('/api/diagram', { ...json(body), signal });

export interface MoleculeStructure {
  name: string;
  formula: string;
  cid: number;
  /** Bond length about 1, y down, centred on the origin. Hydrogens on carbon are left out. */
  atoms: { el: string; x: number; y: number; charge?: number }[];
  bonds: { a: number; b: number; order: number }[];
}

/** A compound's 2D structure by name, from PubChem through the API. */
export const fetchMolecule = (name: string, signal?: AbortSignal) =>
  request<MoleculeStructure>(`/api/molecule?name=${encodeURIComponent(name)}`, { signal });

export interface UsageCounts {
  solve: number;
  diagram: number;
  molecule: number;
}

/** Today's usage against the daily limits. */
export const fetchUsage = (signal?: AbortSignal) =>
  request<{ day: string; used: UsageCounts; limits: UsageCounts }>('/api/me/usage', { signal });
