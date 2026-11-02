/** The /api routes. Request shapes mirror main.py's pydantic models. */
import { performance } from 'node:perf_hooks';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { caller, requireAuth } from './auth.ts';
import { claimDevice, deviceOf, requireDevice } from './device.ts';
import { SHARE_ID, myShares, shareBoard, stopSharing, viewShare } from './shares.ts';
import { practiceLike, slateTitle } from './assist.ts';
import { iceServers } from './turn.ts';
import { build as buildDiagram } from './diagram.ts';
import { env, isMock, provider } from './env.ts';
import { ClientGone, DiagramError, RecognitionError, isAbort } from './errors.ts';
import { DIAGRAM_BODY_LIMIT, HttpError, IMAGE_BODY_LIMIT, SMALL_BODY_LIMIT, jsonBody, parse } from './http.ts';
import { meter, takeStream, usageFor, userBuckets } from './limits.ts';
import { structure } from './molecule.ts';
import { recognize } from './recognize.ts';
import { accuracyFor, decodePng, rateSample, saveSample } from './samples.ts';
import { solveEvents } from './solve-stream.ts';
import { answerAsk, planNotes, writeSection } from './notes.ts';
import { fetchImage, imageSearch, videoInfo, videoSearch, webSearch, youtubeId } from './research.ts';

const MAX_IMAGE_FIELD = 8 * 1024 * 1024;

const RecognizeBody = z.object({ image: z.string().max(MAX_IMAGE_FIELD) });
const SolveBody = z.object({
  image: z.string().max(MAX_IMAGE_FIELD),
  // "answer" writes the result only; "solution" writes the full working.
  mode: z.enum(['answer', 'solution']).default('answer'),
  read_latex: z.string().max(400).nullable().optional(),
  context: z.string().max(600).default(''),
});
const DiagramBody = z.object({
  prompt: z.string().min(1).max(1200),
  previous: z.record(z.string(), z.unknown()).nullable().optional(),
  feedback: z.string().max(600).default(''),
  issues: z.array(z.string()).max(20).default([]),
  context: z.string().max(600).default(''),
});
const MoleculeQuery = z.object({ name: z.string().min(1).max(80) });
const TitleBody = z.object({
  // A small picture of the board; optional when the board's text is already known.
  image: z.string().max(2 * 1024 * 1024).nullable().optional(),
  hints: z.array(z.string().max(300)).max(8).default([]),
});
const PracticeBody = z.object({
  question: z.string().min(1).max(600),
  answer: z.string().max(400).default(''),
  note: z.string().max(400).default(''),
});
const ProfileShape = z.object({
  board: z.string().max(30).default(''),
  grade: z.string().max(12).default(''),
  subjects: z.array(z.string().max(60)).max(8).default([]),
});
const NotesPlanBody = z.object({
  prompt: z.string().max(600).default(''),
  profile: ProfileShape.nullable().optional(),
  context: z.string().max(600).default(''),
  video: z.string().max(300).nullable().optional(),
  transcript: z.string().max(30_000).default(''),
});
const PlanShape = z.object({
  kind: z.enum(['notes', 'summary', 'quiz', 'revision']).default('notes'),
  title: z.string().max(100),
  subject: z.string().max(80).default(''),
  topic: z.string().max(140).default(''),
  profile: ProfileShape,
  sections: z.array(z.object({ heading: z.string().max(80), goal: z.string().max(260).default(''), source: z.string().max(8000).optional() })).min(1).max(10),
  digest: z.string().max(1800).default(''),
});
const NotesSectionBody = z.object({
  plan: PlanShape,
  index: z.number().int().min(0).max(9),
  line_chars: z.number().int().min(10).max(200).default(40),
  written: z.string().max(1200).default(''),
  extra: z.string().max(400).default(''),
  custom: z.object({ heading: z.string().min(1).max(80), goal: z.string().max(260).default('') }).nullable().default(null),
});
const NotesAskBody = z.object({
  question: z.string().min(1).max(400),
  title: z.string().max(100).default(''),
  heading: z.string().max(80).default(''),
  written: z.string().max(1200).default(''),
  profile: ProfileShape.nullable().optional(),
});
const SearchQuery = z.object({ q: z.string().trim().min(1).max(160) });
const ImportQuery = z.object({ url: z.string().url().max(1000) });
const FeedbackBody = z.object({
  id: z.string().regex(/^[0-9a-f]{12}$/),
  correct: z.boolean(),
  corrected_latex: z.string().max(2000).nullable().optional(),
});

/** An AbortSignal that fires when the client goes away before the response is finished. */
function clientSignal(req: Request, res: Response): AbortSignal {
  const ctl = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) ctl.abort(new ClientGone());
  });
  req.on('aborted', () => ctl.abort(new ClientGone()));
  return ctl.signal;
}

export function health(_req: Request, res: Response): void {
  const mock = isMock();
  const p = provider();
  const defaultModel = p === 'groq' ? 'qwen/qwen3.8-27b' : 'claude-opus-5-5';
  res.json({ ok: true, mock, provider: mock ? 'mock' : p, model: mock ? 'mock' : env('SLATE_RECOGNIZE_MODEL', defaultModel) });
}

const ShareBody = z.object({
  slate: z.string().regex(/^[a-z0-9]{1,24}$/),
  title: z.string().trim().min(1).max(60),
  theme: z.enum(['light', 'dark']),
  elements: z.array(z.unknown()).max(20_000),
  days: z.union([z.literal(0), z.literal(1), z.literal(7), z.literal(30)]),
});

/** A shared board, for anyone with its link: no sign-in. */
export function publicShareRouter(): Router {
  const r = Router();
  r.get('/:id', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.json(await viewShare(String(req.params.id)));
  });
  return r;
}

export function apiRouter(): Router {
  const r = Router();
  r.use(requireAuth);

  // Signing in makes this device the account's only one; the others are signed out.
  r.post('/me/device', async (req, res) => {
    const device = deviceOf(req);
    if (!device) throw new HttpError(400, 'This device has no id.');
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, at: await claimDevice(caller(res).uid, device) });
  });
  r.use(requireDevice);

  // Public links to boards, made and stopped from the dashboard.
  r.get('/shares', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ shares: await myShares(caller(res).uid) });
  });
  r.post('/shares', jsonBody('1mb'), async (req, res) => {
    res.json(await shareBoard(caller(res).uid, parse(ShareBody, req.body)));
  });
  r.post('/shares/:id/stop', async (req, res) => {
    const id = String(req.params.id);
    if (!SHARE_ID.test(id)) throw new HttpError(404, 'That link was not found.');
    await stopSharing(caller(res).uid, id);
    res.json({ ok: true });
  });

  r.get('/me/usage', async (_req, res) => {
    const u = await usageFor(caller(res).uid);
    res.setHeader('Cache-Control', 'no-store');
    // Students see AI energy as a share of the day, never as token or request counts.
    res.json({ day: u.day, reset: u.reset, left: u.left, used: u.used });
  });

  r.post('/recognize', jsonBody(IMAGE_BODY_LIMIT), async (req, res) => {
    const body = parse(RecognizeBody, req.body);
    const [b64, raw] = decodePng(body.image);
    const { uid } = caller(res);
    await meter(uid, 'solve', res);
    const signal = clientSignal(req, res);
    const started = performance.now();
    let result: Record<string, unknown>;
    let model: string;
    try {
      [result, model] = await recognize(b64, signal);
    } catch (e) {
      if (isAbort(e)) return;
      if (e instanceof RecognitionError) throw new HttpError(e.status, e.message);
      throw e;
    }
    const latency_ms = Math.round(performance.now() - started);
    const [id, saved] = await saveSample(raw, { model, latency_ms, result }, uid);
    res.json({ id, saved, model, latency_ms, result });
  });

  r.post('/solve', jsonBody(IMAGE_BODY_LIMIT), async (req, res) => {
    const body = parse(SolveBody, req.body);
    const [b64, raw] = decodePng(body.image);
    const { uid } = caller(res);
    takeStream(uid, res);
    await meter(uid, 'solve', res);
    const signal = clientSignal(req, res);
    res.status(200);
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    const line = (ev: unknown) => res.write(`${JSON.stringify(ev)}\n`);
    try {
      for await (const ev of solveEvents({ b64, raw, mode: body.mode, readLatex: body.read_latex ?? null, context: body.context, owner: uid }, signal)) {
        if (signal.aborted) break;
        line(ev);
      }
    } catch (e) {
      if (!isAbort(e) && !signal.aborted) {
        console.error('[solve] stream failed:', (e as Error)?.name, String((e as Error)?.message ?? '').slice(0, 200));
        line({ type: 'error', message: `Solver failed: ${(e as Error)?.name ?? 'Error'}` });
      }
    }
    res.end();
  });

  r.post('/diagram', jsonBody(DIAGRAM_BODY_LIMIT), async (req, res) => {
    const body = parse(DiagramBody, req.body);
    const previous = body.previous ?? null;
    if (previous !== null && JSON.stringify(previous).length > 40_000) throw new HttpError(413, 'The previous diagram is too large.');
    const { uid } = caller(res);
    await meter(uid, 'diagram', res);
    const issues = body.issues.map((i) => i.slice(0, 200));
    const signal = clientSignal(req, res);
    try {
      const [diagram, model, ms] = await buildDiagram(body.prompt, previous, body.feedback, issues, body.context, signal);
      res.json({ diagram, model, ms });
    } catch (e) {
      if (isAbort(e)) return;
      if (e instanceof DiagramError) throw new HttpError(e.status, e.message);
      throw e;
    }
  });

  r.get('/molecule', async (req, res) => {
    const q = parse(MoleculeQuery, { name: typeof req.query.name === 'string' ? req.query.name : undefined });
    await meter(caller(res).uid, 'molecule', res);
    const found = await structure(q.name, clientSignal(req, res));
    if (!found) throw new HttpError(404, `No structure found for "${q.name}".`);
    res.json(found);
  });

  // Voice chat: ICE servers with short-lived TURN credentials for this user. Not charged as AI
  // usage, but limited per minute so credentials can't be farmed.
  r.get('/turn', async (req, res) => {
    const { uid } = caller(res);
    const wait = userBuckets.take(`${uid}:turn`, 12);
    if (wait) throw new HttpError(429, 'Too many voice connections in a minute. Wait a moment.', { 'Retry-After': String(wait) });
    res.setHeader('Cache-Control', 'no-store');
    res.json(await iceServers(uid, clientSignal(req, res)));
  });

  r.post('/slate-title', jsonBody(IMAGE_BODY_LIMIT), async (req, res) => {
    const body = parse(TitleBody, req.body);
    const b64 = body.image ? decodePng(body.image)[0] : null;
    if (!b64 && !body.hints.length) throw new HttpError(400, 'Nothing to name yet.');
    await meter(caller(res).uid, 'assist', res);
    const signal = clientSignal(req, res);
    try {
      res.json({ title: await slateTitle(b64, body.hints, signal) });
    } catch (e) {
      if (isAbort(e)) return;
      throw e;
    }
  });

  r.post('/practice', jsonBody(SMALL_BODY_LIMIT), async (req, res) => {
    const body = parse(PracticeBody, req.body);
    await meter(caller(res).uid, 'assist', res);
    const signal = clientSignal(req, res);
    try {
      res.json(await practiceLike(body.question, body.answer, body.note, signal));
    } catch (e) {
      if (isAbort(e)) return;
      throw e;
    }
  });

  // --- study notes ---------------------------------------------------------------------------

  r.post('/notes/plan', jsonBody(DIAGRAM_BODY_LIMIT), async (req, res) => {
    const body = parse(NotesPlanBody, req.body);
    // A YouTube link pasted into the request counts as the video to summarise.
    const linked = body.video ? null : /(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?\S*v=|shorts\/|live\/|embed\/)|youtu\.be\/)[A-Za-z0-9_-]{11}\S*/i.exec(body.prompt);
    const videoId = body.video ? youtubeId(body.video) : linked ? youtubeId(linked[0]) : null;
    if (body.video && !videoId) throw new HttpError(422, 'That is not a YouTube link.');
    if (linked && videoId) body.prompt = body.prompt.replace(linked[0], ' ').replace(/\s+/g, ' ');
    if (!videoId && body.prompt.trim().length < 3) throw new HttpError(422, 'Say what you would like notes on.');
    const { uid } = caller(res);
    takeStream(uid, res);
    await meter(uid, 'notes', res);
    const signal = clientSignal(req, res);
    res.status(200);
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    const line = (ev: unknown) => res.write(`${JSON.stringify(ev)}\n`);
    try {
      const input = { prompt: body.prompt.trim(), profile: body.profile ?? null, context: body.context, videoId, transcript: body.transcript };
      for await (const ev of planNotes(input, signal)) {
        if (signal.aborted) break;
        line(ev);
      }
    } catch (e) {
      if (!isAbort(e) && !signal.aborted) {
        const message = e instanceof HttpError ? e.message : 'Planning the notes failed.';
        if (!(e instanceof HttpError)) console.error('[notes] plan failed:', (e as Error)?.name, String((e as Error)?.message ?? '').slice(0, 200));
        line({ type: 'error', message });
      }
    }
    res.end();
  });

  r.post('/notes/section', jsonBody(SMALL_BODY_LIMIT), async (req, res) => {
    const body = parse(NotesSectionBody, req.body);
    if (body.index >= body.plan.sections.length) throw new HttpError(422, 'There is no such section in the plan.');
    await meter(caller(res).uid, 'notes', res);
    const signal = clientSignal(req, res);
    try {
      res.json(await writeSection({ plan: body.plan, index: body.index, lineChars: body.line_chars, written: body.written, extra: body.extra, custom: body.custom }, signal));
    } catch (e) {
      if (isAbort(e)) return;
      throw e;
    }
  });

  r.post('/notes/ask', jsonBody(SMALL_BODY_LIMIT), async (req, res) => {
    const body = parse(NotesAskBody, req.body);
    await meter(caller(res).uid, 'notes', res);
    const signal = clientSignal(req, res);
    try {
      res.json(await answerAsk({ ...body, profile: body.profile ?? null }, signal));
    } catch (e) {
      if (isAbort(e)) return;
      throw e;
    }
  });

  // --- looking things up -----------------------------------------------------------------------

  r.get('/search/web', async (req, res) => {
    const q = parse(SearchQuery, { q: req.query.q });
    await meter(caller(res).uid, 'search', res);
    try {
      res.json(await webSearch(q.q, clientSignal(req, res)));
    } catch (e) {
      if (isAbort(e)) return;
      throw e;
    }
  });

  r.get('/search/images', async (req, res) => {
    const q = parse(SearchQuery, { q: req.query.q });
    await meter(caller(res).uid, 'search', res);
    try {
      res.json({ images: await imageSearch(q.q, clientSignal(req, res)) });
    } catch (e) {
      if (isAbort(e)) return;
      throw e;
    }
  });

  r.get('/search/videos', async (req, res) => {
    const q = parse(SearchQuery, { q: req.query.q });
    await meter(caller(res).uid, 'search', res);
    try {
      res.json({ videos: await videoSearch(q.q, clientSignal(req, res)) });
    } catch (e) {
      if (isAbort(e)) return;
      throw e;
    }
  });

  r.get('/video', async (req, res) => {
    const raw = typeof req.query.url === 'string' ? req.query.url.slice(0, 300) : '';
    const id = youtubeId(raw);
    if (!id) throw new HttpError(422, 'That is not a YouTube link.');
    await meter(caller(res).uid, 'search', res);
    try {
      const v = await videoInfo(id, clientSignal(req, res));
      res.json({ id: v.id, title: v.title, channel: v.channel, thumb: v.thumb, length: v.length, captions: !!v.transcript, captionLang: v.captionLang });
    } catch (e) {
      if (isAbort(e)) return;
      throw e;
    }
  });

  /** An image's bytes, same-origin, so the board can shrink it into a picture it saves. */
  r.get('/image', async (req, res) => {
    const q = parse(ImportQuery, { url: req.query.url });
    await meter(caller(res).uid, 'search', res);
    try {
      const img = await fetchImage(q.url, clientSignal(req, res));
      res.setHeader('Content-Type', img.type);
      res.setHeader('Cache-Control', 'private, max-age=600');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      res.send(img.body);
    } catch (e) {
      if (isAbort(e)) return;
      throw e;
    }
  });

  r.post('/feedback', jsonBody(SMALL_BODY_LIMIT), async (req, res) => {
    const body = parse(FeedbackBody, req.body);
    await rateSample(body.id, caller(res).uid, body.correct, body.corrected_latex ?? null);
    res.json({ ok: true });
  });

  r.get('/accuracy', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await accuracyFor(caller(res).uid));
  });

  return r;
}
