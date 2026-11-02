/**
 * AI runtime settings for the open-source edition.
 *
 * The commercial build loads these from its admin panel. The open-source build has no panel, so
 * every choice comes from the environment and each function returns the "unset" value that makes
 * the core modules use their existing environment fallbacks (SLATE_<TOOL>_MODEL,
 * SLATE_RECOGNIZE_MODEL, SLATE_PROVIDER, GROQ_API_KEYS, ANTHROPIC_API_KEY).
 */

export type ProviderId = 'groq' | 'anthropic';

export type ToolId = 'recognize' | 'solve' | 'diagram' | 'notes' | 'assist';

/** Model chosen for a tool, or '' to use the environment. */
export const toolModel = (_tool: ToolId): string => '';

/** Provider chosen for a tool, or '' to use SLATE_PROVIDER. */
export const toolProvider = (_tool: ToolId): ProviderId | '' => '';

/** Keys saved in a panel; there is no panel in this edition. */
export const panelGroqKeys = (): string[] => [];

/** Anthropic key saved in a panel; none. */
export const panelAnthropicKey = (): string | null => null;
