// Build data/embeddings.json: one vector per approved unit plus one per known query
// (golden set, blind set, search log). Run on a machine that can download the model once:
//
//   npm install --no-save @huggingface/transformers
//   node evals/embed.ts
//
// The model runs locally. No unit text or query leaves the machine and no API key is used.
// Synthetic data only. Commit the output so the demo ranks hybrid offline; units whose text
// changed after the build are detected by hash and fall back to keyword ranking.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadData } from '../src/service/service.ts';
import { prepare } from '../src/engine/text.ts';
import { unitVectorHash, unitVectorText, type VectorStore } from '../src/engine/retrieval.ts';

const MODEL = process.env.VERITY_EMBED_MODEL ?? 'Xenova/all-MiniLM-L6-v2';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = loadData(root);
const load = (p: string) => JSON.parse(readFileSync(join(root, p), 'utf8'));

const { pipeline } = await import('@huggingface/transformers');
const embedder = await pipeline('feature-extraction', MODEL);
const embed = async (t: string): Promise<number[]> => Array.from((await embedder(t, { pooling: 'mean', normalize: true })).data as Float32Array).map((x) => Math.round(x * 1e5) / 1e5);

const out: VectorStore = { model: MODEL, units: {}, queries: {} };
for (const u of data.units.filter((x) => x.status === 'approved')) out.units[u.unit_id] = { hash: unitVectorHash(u), vec: await embed(unitVectorText(u)) };

const queries = new Set<string>();
for (const f of ['data/golden_set.json', 'data/blind_set.json', 'data/holdout_set.json']) for (const c of load(f).cases) queries.add(c.query);
for (const q of load('data/search_log.json').queries) queries.add(q.text);
for (const q of queries) {
  const key = prepare(q, data.lexicon).text; // the key search() looks up
  if (key && !out.queries[key]) out.queries[key] = await embed(key);
}
writeFileSync(join(root, 'data/embeddings.json'), JSON.stringify(out));
console.log(`${Object.keys(out.units).length} units, ${Object.keys(out.queries).length} queries embedded with ${MODEL}`);
