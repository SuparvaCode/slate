/** Errors from the model-backed modules. Their messages are written for the user. */

export class RecognitionError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = 'RecognitionError';
    this.status = status;
  }
}

export class SolveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SolveError';
  }
}

export class DiagramError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = 'DiagramError';
    this.status = status;
  }
}

/** True for the error an AbortSignal produces (client went away). */
export const isAbort = (err: unknown): boolean => {
  const name = (err as { name?: string })?.name;
  return name === 'AbortError' || name === 'APIUserAbortError' || name === 'ClientGone';
};

export class ClientGone extends Error {
  constructor() {
    super('The client disconnected.');
    this.name = 'ClientGone';
  }
}

export type Event = Record<string, unknown> & { type: string };
