/** One column of side-by-side working, with a short heading. */
export interface Column {
  heading: string;
  lines: string[];
}

export interface Recognition {
  kind: 'math' | 'text' | 'sketch' | 'mixed';
  latex: string;
  text: string;
  sketch_description: string;
  intent: string;
  answer_latex: string;
  answer_text: string;
  /** Where the model says the answer belongs. Missing on boards saved before placement existed. */
  placement?: 'inline' | 'below' | 'none';
  /** Lines of working, ending in the answer, when the user asked for them. */
  steps?: string[];
  /** Working split into side-by-side columns, with vertical lines drawn between them. */
  columns?: Column[];
  uncertain: string[];
  /** Other plausible readings of the writing, when it is ambiguous. */
  alternatives?: string[];
  confidence: number;
}

export interface RecognizeResponse {
  id: string;
  /** False when sample saving is off; feedback needs a saved sample. */
  saved: boolean;
  model: string;
  latency_ms: number;
  result: Recognition;
}

export interface Health {
  ok: boolean;
  mock: boolean;
  provider: string;
  model: string;
}

// --- solving ----------------------------------------------------------------

export type Verification = 'checked' | 'computed' | 'none';

/** "answer" writes the result only; "solution" writes the full working. */
export type SolveMode = 'answer' | 'solution';

export interface CalcResult {
  result?: string;
  latex?: string;
  approx?: string;
  equal?: boolean;
  note?: string;
  error?: string;
  difference?: string;
}

/** One line of the /api/solve stream. */
export type SolveEvent =
  | { type: 'read'; model: string; result: Recognition; ms: number; corrected?: boolean }
  | { type: 'think'; delta: string }
  | { type: 'tool'; id: string; op: string; args: Record<string, unknown> }
  | { type: 'tool_result'; id: string; result: CalcResult; ms: number }
  | { type: 'wait'; seconds: number; reason: string }
  | {
      type: 'answer';
      answer_latex: string;
      steps: string[];
      columns?: Column[];
      placement: 'inline' | 'below' | 'none';
      note: string;
      verified: boolean;
      /** checked: a calculator check confirmed it; computed: the calculator produced it. */
      verification?: Verification;
      ms: number;
      id: string;
      saved: boolean;
    }
  | { type: 'error'; message: string };

export type WorkItem =
  | { kind: 'think'; text: string }
  | { kind: 'calc'; id: string; op: string; args: Record<string, unknown>; result?: CalcResult; ms?: number }
  | { kind: 'wait'; seconds: number; reason: string };

export type WorkPhase = 'reading' | 'thinking' | 'calculating' | 'waiting' | 'writing' | 'done' | 'error';

/** Everything the solver did for one answer, as shown in the Work window. */
export interface Work {
  mode: SolveMode;
  phase: WorkPhase;
  startedAt: number;
  read?: {
    latex: string;
    text: string;
    sketch: string;
    uncertain: string[];
    alternatives: string[];
    confidence: number;
    /** The user supplied this reading instead of the AI reading the handwriting. */
    corrected: boolean;
    model: string;
    ms: number;
  };
  items: WorkItem[];
  answer?: {
    latex: string;
    steps: string[];
    columns?: Column[];
    note: string;
    verified: boolean;
    verification: Verification;
    ms: number;
    sampleId: string;
    saved: boolean;
  };
  error?: string;
}
