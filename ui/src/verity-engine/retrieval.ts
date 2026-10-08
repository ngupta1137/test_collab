// @ts-nocheck
// Copied from the Verity engine repo (src/engine, src/agents, src/gateway). Type-checked and tested there
// (node --test, 13 tests; evals/run.ts). Do not edit here: change it in verity and copy again.
// Step 6: two indexes.
// Body index: title + synonyms + body, filtered by entitlement INSIDE the
//   search (units outside the caller's knowledge bases are never scored, so
//   their bodies can never reach a model).
// Routing index: unit_id, title, knowledge_base, owner only. Searched across
//   all approved units so a restricted best match returns not_authorized with
//   the owning team instead of a false "nothing exists".
//
// Keyword ranking only in this baseline. The embedding half of hybrid search
// plugs in behind search() later and must pass the same golden set.

import type { Candidate, KnowledgeUnit } from './types.ts';
import { prepare, type Lexicon } from './text.ts';

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

  constructor(units: KnowledgeUnit[], lex: Lexicon) {
    this.lex = lex;
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
    return this.items
      .filter((it) => it.unit.status === 'approved' && knowledgeBases.includes(it.unit.knowledge_base))
      .map((it) => this.scoreOne(it, q, text, 'all'))
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score || a.unit_id.localeCompare(b.unit_id));
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
