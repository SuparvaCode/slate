/** Study notes as the API sends them (mirrors services/server/src/notes.ts). */

/** A sketch is drawn in a 100 x 60 box (y down); the app scales it and draws it by hand. */
export type Shape =
  | { s: 'line' | 'arrow' | 'dash'; x1: number; y1: number; x2: number; y2: number }
  | { s: 'circle'; x: number; y: number; r: number }
  | { s: 'rect'; x: number; y: number; w: number; h: number }
  | { s: 'arc'; x: number; y: number; r: number; a0: number; a1: number; arrow?: boolean }
  | { s: 'dot'; x: number; y: number }
  | { s: 'label'; x: number; y: number; text: string };

export type Block =
  | { t: 'h'; text: string }
  | { t: 'p'; text: string }
  | { t: 'f'; latex: string; label?: string }
  | { t: 'list'; items: string[]; check?: boolean }
  | { t: 'table'; head: string[]; rows: string[][] }
  | { t: 'sketch'; caption: string; shapes: Shape[] }
  | { t: 'ex'; q: string; steps: string[] }
  | { t: 'key'; text: string }
  | { t: 'q'; items: string[] }
  /** Written by the app, not the model: the title at the top of a set of notes. */
  | { t: 'title'; text: string; sub: string };

export interface Profile {
  board: string;
  grade: string;
  subjects: string[];
}

export interface WebSource {
  title: string;
  url: string;
  snippet: string;
}

export interface PlanSection {
  heading: string;
  goal: string;
  /** For a video: the words of this section's part of it. */
  source?: string;
}

export type PlanKind = 'notes' | 'summary' | 'quiz' | 'revision';

export interface VideoRef {
  id: string;
  title: string;
  channel: string;
  thumb: string;
  captions: boolean;
}

export interface Plan {
  kind: PlanKind;
  title: string;
  subject: string;
  topic: string;
  profile: Profile;
  sections: PlanSection[];
  digest: string;
  sources: WebSource[];
  habit: string;
  video?: VideoRef;
  /** Sample notes from a server in demo mode, not written by a model. */
  demo?: boolean;
}

export type StageKey = 'understand' | 'search' | 'read' | 'video' | 'plan';

export type PlanEvent =
  | { type: 'stage'; stage: StageKey; label: string }
  | { type: 'profile'; profile: Profile; subject: string; topic: string; kind: PlanKind }
  | { type: 'sources'; sources: WebSource[] }
  | { type: 'video'; video: VideoRef }
  | { type: 'plan'; plan: Plan }
  | { type: 'error'; message: string };

export interface SectionOut {
  blocks: Block[];
  side: Block[];
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

export interface VideoDetails {
  id: string;
  title: string;
  channel: string;
  thumb: string;
  /** Seconds, 0 when unknown. */
  length: number;
  captions: boolean;
  captionLang: string;
}
