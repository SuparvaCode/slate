/** Saved crops and results (data/samples), for building an eval set. Each record has an owner uid. */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { samplesDir } from './env.ts';
import { HttpError } from './http.ts';

export const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** data:image/png;base64,... or bare base64 -> [base64, bytes]. Same checks and messages as main.py. */
export function decodePng(image: string): [string, Buffer] {
  const b64 = image.startsWith('data:') ? image.slice(image.indexOf(',') + 1) : image;
  // base64.b64decode(validate=True): alphabet only, correct padding.
  if (!B64.test(b64) || b64.length % 4 !== 0) throw new HttpError(400, 'Image is not valid base64.');
  const raw = Buffer.from(b64, 'base64');
  if (raw.length < PNG_MAGIC.length || !raw.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
    throw new HttpError(400, 'Image must be a PNG.');
  }
  if (raw.length > MAX_IMAGE_BYTES) throw new HttpError(413, 'Image is larger than 5 MB.');
  return [b64, raw];
}

export const saveEnabled = (): boolean => (process.env.SLATE_SAVE_SAMPLES ?? '1') === '1';

export async function saveSample(raw: Buffer, record: Record<string, unknown>, owner: string): Promise<[string, boolean]> {
  const id = randomUUID().replace(/-/g, '').slice(0, 12);
  const saved = saveEnabled();
  if (saved) {
    const dir = samplesDir();
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${id}.png`), raw);
    await writeFile(join(dir, `${id}.json`), JSON.stringify({ owner, ...record }, null, 2));
  }
  return [id, saved];
}

const ID = /^[0-9a-f]{12}$/;

/** Marks the caller's own sample right or wrong. Someone else's sample is reported as not found. */
export async function rateSample(id: string, owner: string, correct: boolean, correctedLatex: string | null): Promise<void> {
  if (!ID.test(id)) throw new HttpError(404, 'Sample not found.');
  const path = join(samplesDir(), `${id}.json`);
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw new HttpError(404, 'Sample not found.');
  }
  if (data.owner !== owner) throw new HttpError(404, 'Sample not found.');
  data.feedback = { correct, corrected_latex: correctedLatex };
  await writeFile(path, JSON.stringify(data, null, 2));
}

/** Share of the caller's rated samples marked correct. */
export async function accuracyFor(owner: string): Promise<{ rated: number; correct: number; accuracy: number | null }> {
  let rated = 0;
  let correct = 0;
  let names: string[] = [];
  try {
    names = await readdir(samplesDir());
  } catch {
    names = [];
  }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const data = JSON.parse(await readFile(join(samplesDir(), name), 'utf8'));
      if (data.owner !== owner || !data.feedback) continue;
      rated += 1;
      correct += data.feedback.correct ? 1 : 0;
    } catch {
      // skip unreadable records
    }
  }
  return { rated, correct, accuracy: rated ? correct / rated : null };
}
