/**
 * What a caller is allowed to do. This is the seam between the core product and any edition
 * built on it: the open-source edition ships one implementation (daily abuse limits plus an AI
 * token budget, both from the environment). There is no plan, trial or payment logic here.
 */
import { int } from './env.ts';

export type QuotaClass = 'solve' | 'diagram' | 'molecule' | 'assist' | 'notes' | 'search';
export const CLASSES: QuotaClass[] = ['solve', 'diagram', 'molecule', 'assist', 'notes', 'search'];
export type Counts = Record<QuotaClass, number>;

export function defaultLimits(): Counts {
  return {
    solve: int('SLATE_LIMIT_SOLVE_DAY', 200),
    diagram: int('SLATE_LIMIT_DIAGRAM_DAY', 60),
    molecule: int('SLATE_LIMIT_MOLECULE_DAY', 300),
    // Slate titles and practice questions: small calls, kept apart so they never use up answers.
    assist: int('SLATE_LIMIT_ASSIST_DAY', 80),
    // A set of notes is one plan plus one call per section, and questions asked along the way.
    notes: int('SLATE_LIMIT_NOTES_DAY', 120),
    search: int('SLATE_LIMIT_SEARCH_DAY', 400),
  };
}

export interface Entitlement {
  /** Per-feature daily caps. These exist to stop scripted abuse, not to sell a plan. */
  limits: Counts;
  /** AI tokens a caller may use per UTC day. */
  aiTokensPerDay: number;
}

/** The open-source edition: the same allowance for every signed-in caller. */
export function entitlementFor(_uid: string): Entitlement {
  return {
    limits: defaultLimits(),
    aiTokensPerDay: int('SLATE_AI_TOKENS_DAY', 1_400_000),
  };
}
