/**
 * Voice chat in a Collaborate room: every pair of people in the call has a direct WebRTC audio
 * connection (at most 4 people, so at most 3 connections each). The Realtime Database only carries
 * the short setup messages, in each person's own inbox at rooms/{code}/signal/{uid}.
 *
 * Of each pair, the person with the smaller uid makes the offer, so the two never offer at once.
 * Some school and mobile networks block direct connections; then audio goes through the TURN
 * relay the API configures (see services/server/src/turn.ts).
 */
import { authFetch } from '../auth/authFetch';
import { me, onRoom, roomLive, roomState, setMyVoice } from './room';
import type { Live } from './rtdb';

export interface VoiceState {
  on: boolean;
  muted: boolean;
  connecting: boolean;
  /** uid -> connection state of the call with that person. */
  peers: Record<string, RTCPeerConnectionState>;
  error: string | null;
  /** uid -> talking right now (this person included), from the audio level. */
  speaking: Record<string, boolean>;
}

let state: VoiceState = { on: false, muted: false, connecting: false, peers: {}, error: null, speaking: {} };
const listeners = new Set<() => void>();
function set(patch: Partial<VoiceState>) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
}
export const voiceState = (): VoiceState => state;
export function onVoice(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * ICE servers come from the Slate API, which hands out short-lived TURN credentials (Cloudflare or
 * coturn), so no TURN secret is ever in the web app. Public STUN is the fallback.
 */
let ice: RTCIceServer[] = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
let relay = false;

async function loadIce(): Promise<void> {
  try {
    const res = await authFetch('/api/turn');
    if (!res.ok) return;
    const data = (await res.json()) as { iceServers?: RTCIceServer[]; relay?: boolean };
    if (Array.isArray(data.iceServers) && data.iceServers.length) {
      ice = data.iceServers;
      relay = data.relay === true;
    }
  } catch {
    // keep STUN only; calls still work on open networks
  }
}

export const hasRelay = (): boolean => relay;

// --- who is talking ---------------------------------------------------------------------------

let actx: AudioContext | null = null;
let levelTimer = 0;
const levels = new Map<string, { src: MediaStreamAudioSourceNode; an: AnalyserNode; buf: Float32Array<ArrayBuffer> }>();

function listen(uid: string, s: MediaStream) {
  if (!actx) return;
  unlisten(uid);
  try {
    const src = actx.createMediaStreamSource(s);
    const an = actx.createAnalyser();
    an.fftSize = 512;
    src.connect(an);
    levels.set(uid, { src, an, buf: new Float32Array(an.fftSize) });
  } catch {
    // this stream can't be measured
  }
}

function unlisten(uid: string) {
  const l = levels.get(uid);
  if (!l) return;
  l.src.disconnect();
  levels.delete(uid);
}

/** Marks who is talking; a little lower level keeps someone marked, so the ring doesn't flicker. */
function measure() {
  const next: Record<string, boolean> = {};
  let changed = false;
  for (const [uid, l] of levels) {
    l.an.getFloatTimeDomainData(l.buf);
    let sum = 0;
    for (const v of l.buf) sum += v * v;
    const rms = Math.sqrt(sum / l.buf.length);
    const was = !!state.speaking[uid];
    const on = rms > (was ? 0.012 : 0.025);
    if (on) next[uid] = true;
    if (on !== was) changed = true;
  }
  for (const uid of Object.keys(state.speaking)) if (!levels.has(uid)) changed = true;
  if (changed) set({ speaking: next });
}

interface Peer {
  pc: RTCPeerConnection;
  /** The other person's call session, once known. */
  sid: string | null;
  audio: HTMLAudioElement;
  queued: RTCIceCandidateInit[];
  offerer: boolean;
}

let L: Live | null = null;
let stream: MediaStream | null = null;
let sid = '';
const peers = new Map<string, Peer>();
let stops: (() => void)[] = [];
let retry = 0;

const inbox = (uid: string) => `rooms/${roomState().code}/signal/${uid}`;

function send(to: string, k: 'offer' | 'answer' | 'ice' | 'bye', body: Record<string, unknown>) {
  if (!L) return;
  const s = JSON.stringify({ sid, ...body });
  if (s.length > 20_000) return;
  const msg = L.m.push(L.m.ref(L.db, inbox(to)));
  void L.m.set(msg, { f: L.uid, k, s }).catch(() => {});
}

function close(uid: string) {
  const p = peers.get(uid);
  if (!p) return;
  peers.delete(uid);
  unlisten(uid);
  p.pc.onicecandidate = null;
  p.pc.onconnectionstatechange = null;
  p.pc.ontrack = null;
  p.pc.close();
  p.audio.srcObject = null;
  p.audio.remove();
  const next = { ...state.peers };
  delete next[uid];
  set({ peers: next });
}

function makePeer(uid: string, offerer: boolean): Peer {
  close(uid);
  const pc = new RTCPeerConnection({ iceServers: ice });
  const audio = document.createElement('audio');
  audio.autoplay = true;
  audio.setAttribute('playsinline', '');
  audio.dataset.voice = uid;
  audio.style.display = 'none';
  document.body.append(audio);
  const p: Peer = { pc, sid: null, audio, queued: [], offerer };
  for (const t of stream?.getTracks() ?? []) pc.addTrack(t, stream!);
  pc.ontrack = (e) => {
    const remote = e.streams[0] ?? new MediaStream([e.track]);
    audio.srcObject = remote;
    listen(uid, remote);
    void audio.play().catch(() => {});
  };
  pc.onicecandidate = (e) => {
    if (e.candidate) send(uid, 'ice', { to: p.sid, c: e.candidate.toJSON() });
  };
  pc.onconnectionstatechange = () => {
    set({ peers: { ...state.peers, [uid]: pc.connectionState } });
    // A failed call is tried again by whoever offers, once things settle.
    if (pc.connectionState === 'failed' && peers.get(uid) === p) {
      close(uid);
      if (offerer) scheduleSync(4000);
    }
  };
  peers.set(uid, p);
  set({ peers: { ...state.peers, [uid]: pc.connectionState } });
  return p;
}

async function offerTo(uid: string) {
  const p = makePeer(uid, true);
  try {
    const offer = await p.pc.createOffer();
    await p.pc.setLocalDescription(offer);
    send(uid, 'offer', { sdp: p.pc.localDescription?.sdp });
  } catch {
    close(uid);
  }
}

async function flushIce(p: Peer) {
  const list = p.queued;
  p.queued = [];
  for (const c of list) await p.pc.addIceCandidate(c).catch(() => {});
}

async function onMessage(from: string, k: string, raw: string) {
  let body: { sid?: string; to?: string | null; sdp?: string; c?: RTCIceCandidateInit };
  try {
    body = JSON.parse(raw);
  } catch {
    return;
  }
  if (typeof body.sid !== 'string') return;
  // Messages meant for an earlier call of ours are stale.
  if (body.to && body.to !== sid) return;
  const voiceOn = roomState().members.some((m) => m.uid === from && m.voice);
  if (k === 'bye') {
    close(from);
    return;
  }
  if (k === 'offer' && typeof body.sdp === 'string') {
    if (!voiceOn && !roomState().members.some((m) => m.uid === from)) return;
    const p = makePeer(from, false);
    p.sid = body.sid;
    try {
      await p.pc.setRemoteDescription({ type: 'offer', sdp: body.sdp });
      await flushIce(p);
      const answer = await p.pc.createAnswer();
      await p.pc.setLocalDescription(answer);
      send(from, 'answer', { to: body.sid, sdp: p.pc.localDescription?.sdp });
    } catch {
      close(from);
    }
    return;
  }
  const p = peers.get(from);
  if (!p) return;
  if (k === 'answer' && typeof body.sdp === 'string' && p.offerer && p.pc.signalingState === 'have-local-offer') {
    p.sid = body.sid;
    try {
      await p.pc.setRemoteDescription({ type: 'answer', sdp: body.sdp });
      await flushIce(p);
    } catch {
      close(from);
    }
    return;
  }
  if (k === 'ice' && body.c) {
    if (p.sid && p.sid !== body.sid) return;
    if (!p.pc.remoteDescription) p.queued.push(body.c);
    else await p.pc.addIceCandidate(body.c).catch(() => {});
  }
}

/** Connects to everyone else in the call, and drops anyone who left it. */
function sync() {
  if (!L || !state.on) return;
  const others = roomState().members.filter((m) => m.uid !== L!.uid && m.voice && m.online);
  const want = new Set(others.map((m) => m.uid));
  for (const uid of [...peers.keys()]) if (!want.has(uid)) close(uid);
  for (const m of others) {
    if (peers.has(m.uid)) continue;
    if (L.uid < m.uid) void offerTo(m.uid);
  }
}

function scheduleSync(ms: number) {
  clearTimeout(retry);
  retry = window.setTimeout(sync, ms);
}

export async function startVoice(): Promise<void> {
  if (state.on || state.connecting) return;
  const live = roomLive(() => void stopVoice());
  if (!live || roomState().status !== 'live') return;
  if (!navigator.mediaDevices?.getUserMedia) {
    set({ error: 'This browser cannot use a microphone here. Voice needs a secure (https) page.' });
    return;
  }
  set({ connecting: true, error: null });
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
  } catch (e) {
    const denied = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
    set({ connecting: false, error: denied ? 'Microphone access was blocked. Allow it in the browser to talk.' : 'No microphone was found.' });
    return;
  }
  await loadIce();
  L = live;
  try {
    actx = new AudioContext();
    listen(live.uid, stream);
    levelTimer = window.setInterval(measure, 150);
  } catch {
    // no level meter; voice still works
  }
  const a = new Uint32Array(2);
  crypto.getRandomValues(a);
  sid = `${a[0].toString(36)}${a[1].toString(36)}`;
  // Start with an empty inbox, so messages from an earlier call are not replayed.
  const box = L.m.ref(L.db, inbox(L.uid));
  await L.m.remove(box).catch(() => {});
  stops.push(
    L.m.onChildAdded(box, (c) => {
      const v = c.val();
      void L?.m.remove(c.ref).catch(() => {});
      if (v && typeof v.f === 'string' && typeof v.k === 'string' && typeof v.s === 'string') void onMessage(v.f, v.k, v.s);
    }),
    onRoom(() => {
      if (roomState().status !== 'live') void stopVoice();
      else sync();
    }),
  );
  set({ on: true, connecting: false, muted: false });
  await setMyVoice({ voice: true, muted: false });
  sync();
}

export async function stopVoice(): Promise<void> {
  clearTimeout(retry);
  stops.forEach((fn) => fn());
  stops = [];
  for (const uid of [...peers.keys()]) {
    send(uid, 'bye', {});
    close(uid);
  }
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  clearInterval(levelTimer);
  for (const uid of [...levels.keys()]) unlisten(uid);
  void actx?.close().catch(() => {});
  actx = null;
  const wasOn = state.on;
  L = null;
  set({ on: false, connecting: false, muted: false, peers: {}, speaking: {} });
  if (wasOn && me()) await setMyVoice({ voice: false, muted: false });
}

export function setMuted(muted: boolean): void {
  if (!stream) return;
  for (const t of stream.getAudioTracks()) t.enabled = !muted;
  set({ muted });
  void setMyVoice({ muted });
}
