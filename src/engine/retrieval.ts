// Step 6: two indexes.
// Body index: title + synonyms + body, filtered by entitlement INSIDE the
//   search (units outside the caller's knowledge bases are never scored, so
//   their bodies can never reach a model).
// Routing index: unit_id, title, knowledge_base, owner only. Searched across
//   all approved units so a restricted best match returns not_authorized with
//   the owning team instead of a false "nothing exists".
//
// Keyword ranking is the baseline. The embedding half of hybrid search is
// optional: with precomputed vectors (data/embeddings.json, built by
// evals/embed.mjs) it re-orders the entitled candidates by meaning. It only
// ranks. Answer/decline gates (coverage, anchoring) still come from the
// keyword side, and a unit outside the caller's knowledge bases is never
// scored, so no vector ever reaches a model out of scope.

import type { Candidate, KnowledgeUnit } from './types.ts';
import { createHash } from 'node:crypto';
import { prepare, type Lexicon } from './text.ts';
import { normalizeForHash } from './drift.ts';

/** Precomputed vectors. Units are keyed by id and checked against a hash of their text so stale vectors are ignored. */
export interface VectorStore {
  model: string;
  units: Record<string, { hash: string; vec: number[] }>;
  queries: Record<string, number[]>; // normalized query text -> vector (offline demo: unseen queries fall back to keyword only)
}
// Experimental, off by default: let meaning alone qualify the single best entitled unit when it is
// clearly the closest (cosine >= T and ahead of the runner-up by >= margin). Swept in evals before any use.
export const SEMANTIC_GATE = process.env.VERITY_SEMANTIC_GATE ? Number(process.env.VERITY_SEMANTIC_GATE) : null;
export const SEMANTIC_MARGIN = Number(process.env.VERITY_SEMANTIC_MARGIN ?? 0.08);
export const HYBRID_WEIGHT = Number(process.env.VERITY_HYBRID_WEIGHT ?? 0.5); // share of the final rank given to meaning

/** What a unit's vector was built from. A changed unit hashes differently, so its old vector is ignored. */
export function unitVectorText(u: KnowledgeUnit): string {
  return `${u.title}. ${u.synonyms.join(', ')}. ${u.body}`;
}
export function unitVectorHash(u: KnowledgeUnit): string {
  return createHash('sha1').update(normalizeForHash(unitVectorText(u))).digest('hex').slice(0, 16);
}

function cosine(a: number[], b: number[]): number {
  let d = 0, x = 0, y = 0;
  for (let i = 0; i < a.length; i++) { d += a[i]! * b[i]!; x += a[i]! * a[i]!; y += b[i]! * b[i]!; }
  return x && y ? d / Math.sqrt(x * y) : 0;
}

export const MIN_COVERAGE = Number(process.env.VERITY_MIN_COVERAGE ?? 0.5); // env override is for threshold sweeps only

interface Indexed {
  unit: KnowledgeUnit;
  title: Set<string>;
  syn: Set<string>;
  body: Set<string>;
  synPhrases: string[];
  synTokens: Map<string, string[]>;
}

export class KnowledgeIndex {
  private items: Indexed[];
  private idf = new Map<string, number>();
  private maxIdf = 0;
  private lex: Lexicon;
  private vectors: VectorStore | null;

  constructor(units: KnowledgeUnit[], lex: Lexicon, vectors: VectorStore | null = null) {
    this.lex = lex;
    if (vectors) {
      const fresh: VectorStore['units'] = {};
      for (const u of units) if (vectors.units[u.unit_id]?.hash === unitVectorHash(u)) fresh[u.unit_id] = vectors.units[u.unit_id]!;
      vectors = { ...vectors, units: fresh };
    }
    this.vectors = vectors;
    this.items = units.map((u) => {
      const syn = u.synonyms.map((s) => prepare(s, lex));
      return {
        unit: u,
        title: new Set(prepare(u.title, lex).tokens),
        syn: new Set(syn.flatMap((s) => s.tokens)),
        body: new Set(prepare(u.body, lex).tokens),
        synPhrases: syn.map((s) => s.text).filter((t) => t.length > 0),
        synTokens: new Map(syn.map((s) => [s.text, s.tokens])),
      };
    });
    const df = new Map<string, number>();
    for (const it of this.items) {
      for (const t of new Set([...it.title, ...it.syn, ...it.body])) df.set(t, (df.get(t) ?? 0) + 1);
    }
    const n = this.items.length;
    for (const [t, d] of df) this.idf.set(t, Math.log(1 + n / d));
    this.maxIdf = Math.log(1 + n);
  }

  private idfOf(t: string): number {
    return this.idf.get(t) ?? this.maxIdf;
  }

  private scoreOne(it: Indexed, q: string[], qText: string, fields: 'all' | 'title'): Candidate {
    let score = 0;
    let anchored = false;
    let matched = 0;
    let total = 0;
    for (const t of new Set(q)) {
      const idf = this.idfOf(t);
      total += idf;
      let w = 0;
      if (fields === 'all' && it.syn.has(t)) w = 3;
      else if (it.title.has(t)) w = 2;
      else if (fields === 'all' && it.body.has(t)) w = 1;
      if (w >= 2) anchored = true;
      if (w > 0) {
        score += w * idf;
        matched += idf;
      }
    }
    // Phrase match: a curated synonym phrase appears in the query AND makes up at
    // least half of the query's content words. "closing statement" contains
    // "closing" (1 of 2); "is the pharmacy opening on sunday" contains
    // "opening" (1 of 3), which is not enough to qualify on its own.
    let phraseMatch = false;
    if (fields === 'all') {
      const qSet = new Set(q);
      for (const p of it.synPhrases) {
        if (!` ${qText} `.includes(` ${p} `)) continue;
        if (p.includes(' ')) score += 2;
        const pTokens = it.synTokens.get(p) ?? [];
        if (pTokens.length && pTokens.every((t) => qSet.has(t)) && pTokens.length / qSet.size >= 0.5) phraseMatch = true;
      }
    }
    return {
      unit_id: it.unit.unit_id,
      version: it.unit.version,
      score: Math.round(score * 100) / 100,
      coverage: total > 0 ? Math.round((matched / total) * 100) / 100 : 0,
      phrase_match: phraseMatch,
      anchored,
    };
  }

  /** Body index search with the entitlement filter applied inside the query. */
  search(query: string, knowledgeBases: string[]): Candidate[] {
    const { tokens: q, text } = prepare(query, this.lex);
    const entitled = this.items.filter((it) => it.unit.status === 'approved' && knowledgeBases.includes(it.unit.knowledge_base));
    const kw = entitled.map((it) => this.scoreOne(it, q, text, 'all'));
    const qv = this.vectors?.queries[text];
    if (!qv) return kw.filter((c) => c.score > 0).sort((a, b) => b.score - a.score || a.unit_id.localeCompare(b.unit_id));

    // Hybrid: blend normalized keyword score with cosine similarity. Semantic-only
    // hits stay visible but carry coverage 0, so they cannot open an answer on their own.
    const top = Math.max(1, ...kw.map((c) => c.score));
    const blended = kw.map((c) => {
      const v = this.vectors!.units[c.unit_id];
      const sem = v ? Math.max(0, cosine(qv, v.vec)) : 0;
      return { c, rank: (1 - HYBRID_WEIGHT) * (c.score / top) + HYBRID_WEIGHT * sem, sem };
    });
    if (SEMANTIC_GATE !== null) {
      const bySem = [...blended].sort((a, b) => b.sem - a.sem);
      const [first, second] = bySem;
      if (first && first.sem >= SEMANTIC_GATE && first.sem - (second?.sem ?? 0) >= SEMANTIC_MARGIN) { first.c.phrase_match = true; first.c.anchored = true; }
    }
    return blended
      .filter((x) => x.c.score > 0 || x.sem >= 0.5)
      .sort((a, b) => b.rank - a.rank || a.c.unit_id.localeCompare(b.c.unit_id))
      .map((x) => x.c);
  }

  /** Routing index: titles only, all approved units, never returns a body. */
  route(query: string): { unit_id: string; title: string; knowledge_base: string; owner: string; coverage: number }[] {
    const { tokens: q, text } = prepare(query, this.lex);
    return this.items
      .filter((it) => it.unit.status === 'approved')
      .map((it) => ({ it, c: this.scoreOne(it, q, text, 'title') }))
      .filter((x) => x.c.coverage >= MIN_COVERAGE)
      .sort((a, b) => b.c.coverage - a.c.coverage)
      .map((x) => ({
        unit_id: x.it.unit.unit_id,
        title: x.it.unit.title,
        knowledge_base: x.it.unit.knowledge_base,
        owner: x.it.unit.owner,
        coverage: x.c.coverage,
      }));
  }

  /** Every token the index knows (titles, synonyms, bodies), after normalization. */
  vocabulary(): Set<string> {
    return new Set(this.items.flatMap((it) => [...it.title, ...it.syn, ...it.body]));
  }

  /** Synonym phrases of a unit, after lexicon normalization (used for same-question clusters). */
  phrases(unitId: string): string[] {
    return this.items.find((it) => it.unit.unit_id === unitId)?.synPhrases ?? [];
  }

  prepared(query: string) {
    return prepare(query, this.lex);
  }
}
