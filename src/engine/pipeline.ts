// The serving pipeline: FOUNDATIONS section 7, steps 1 to 13.
// Baseline engine: every step is deterministic. Steps 3, 4, 10 and 11 have
// model-backed versions planned behind the same functions (model gateway);
// each must pass the same golden set before it replaces the baseline.

import type {
  Candidate, Exclusion, KnowledgeUnit, Outcome, PartResult, RequestContext,
  Role, ServeRequest, ServeResponse, TraceStep,
} from './types.ts';
import { KnowledgeIndex, MIN_COVERAGE, type VectorStore } from './retrieval.ts';
import { redact, safetyCheck, SAFETY_MESSAGE } from './guards.ts';
import type { Lexicon } from './text.ts';
import type { RegressionCase } from './regression.ts';
import type { Gateway } from '../gateway/gateway.ts';
import { runQueryAgent, QUERY_PROMPT_VERSION, type Assist, type AssistPart } from '../agents/queryAgent.ts';

export const ENGINE_VERSION = 'baseline-deterministic-0.1';

const AUTHORITY_RANK: Record<string, number> = { legal_approved: 3, policy: 2, knowledge_article: 1 };

export interface EngineData {
  units: KnowledgeUnit[];
  roles: Record<string, Role>;
  lexicon: Lexicon;
  asOf: string; // YYYY-MM-DD, used for staleness
  vectors?: VectorStore | null; // optional precomputed embeddings (hybrid ranking)
  golden?: RegressionCase[]; // regression cases the publication gate runs (see regression.ts)
}

let counter = 0;

export class Verity {
  private data: EngineData;
  private index: KnowledgeIndex;
  private byId = new Map<string, KnowledgeUnit>();

  constructor(data: EngineData) {
    this.data = data;
    this.index = new KnowledgeIndex(data.units, data.lexicon, data.vectors ?? null);
    for (const u of data.units) this.byId.set(u.unit_id, u);
  }

  unit(id: string): KnowledgeUnit | undefined {
    return this.byId.get(id);
  }

  /** Authoring-side helpers for the gap analyst (never used to serve a caller). */
  vocabulary(): Set<string> {
    return this.index.vocabulary();
  }

  nearest(query: string) {
    const allKbs = [...new Set(this.data.units.map((u) => u.knowledge_base))];
    return this.index.search(query, allKbs)[0];
  }

  prepare(query: string) {
    return this.index.prepared(query);
  }

  /**
   * Model-assisted serve: runs the query agent (step 4) through the gateway,
   * then the same deterministic pipeline. If the gateway is off, misses its
   * cache or fails, this is exactly serve(req).
   */
  async serveAsync(req: ServeRequest, gw: Gateway): Promise<ServeResponse> {
    const role = this.data.roles[req.role];
    if (!role || !gw.enabled || safetyCheck(req.query)) return this.serve(req);
    const redacted = redact(req.query).text.replace(/\[[A-Z_]+\]/g, '[REDACTED]');
    const assist = await runQueryAgent(gw, redacted, this.data.units, role, this.data.lexicon);
    return this.serve(req, assist ?? undefined);
  }

  serve(req: ServeRequest, assist?: Assist): ServeResponse {
    const t0 = performance.now();
    const trace: TraceStep[] = [];
    const add = (step: number, name: string, kind: TraceStep['kind'], detail: string) =>
      trace.push({ step, name, kind, detail });

    // 1. Identity and entitlements
    const role = this.data.roles[req.role];
    if (!role) throw new Error(`unknown role ${req.role}`);
    add(1, 'Resolve role and entitlements', 'D', `${req.role}: ${role.knowledge_bases.join(', ')}`);

    // 2. Redact PHI/PII before anything else sees the text
    const red = redact(req.query);
    add(2, 'Redact PHI/PII', 'D', red.applied.length ? `redacted ${red.applied.join(', ')}` : 'nothing to redact');
    const q = red.text.replace(/\[[A-Z_]+\]/g, ' ');

    const record = {
      request_id: `req-${Date.now()}-${++counter}`,
      as_of: this.data.asOf,
      query_redacted: red.text,
      redactions: red.applied,
      role: req.role,
      entitlement: role.knowledge_bases,
      channel: req.channel,
      partitions: { tenant: 'demo-tenant', environment: 'prototype', lob: req.context.lob, state: req.context.state },
      model_context_unit_ids: [] as string[],
      engine: assist ? `${ENGINE_VERSION}+${QUERY_PROMPT_VERSION}@${assist.model}` : ENGINE_VERSION,
      latency_ms: 0,
    };

    // 3. Safety pre-check, before retrieval
    // The pattern list runs first; the query agent's urgent flag can only ADD an escalation.
    const trigger = safetyCheck(req.query) ?? (assist?.urgent ? 'query agent: urgent' : null);
    if (trigger) {
      add(3, 'Safety pre-check', 'D+P', `triggered on "${trigger}"; no retrieval`);
      const part: PartResult = {
        part: red.text, outcome: 'safety_escalation', unit_ids: [], text: SAFETY_MESSAGE,
        message: 'Urgent language detected. Human handoff.', candidates: [], exclusions: [],
        resolution_path: ['safety pre-check'], verification: { verbatim_exact: null, in_scope: true },
      };
      record.latency_ms = Math.round(performance.now() - t0);
      return { outcome: 'safety_escalation', parts: [part], trace, record, gap_logged: false };
    }
    add(3, 'Safety pre-check', 'D+P', 'clear');

    // 4. Query understanding: lexicon, speech errors, multi-part split
    const parts = assist ? assist.parts.map((p) => p.text) : splitParts(q);
    const prep = this.index.prepared(q);
    add(4, 'Query understanding', 'P', assist
      ? `query agent ${assist.model} (${assist.source}): ${assist.parts.map((p) => `"${p.text}" -> [${p.unit_ids.join(', ')}]${p.restricted_ids.length ? ` restricted [${p.restricted_ids.join(', ')}]` : ''}`).join(' | ')}`
      : `normalized "${prep.text}"; lexicon ${prep.hits.join('; ') || 'none'}; ${parts.length} part(s)`);

    // 5. Hard partitions
    add(5, 'Hard partitions', 'D', `tenant, environment, lob=${req.context.lob ?? '?'}, state=${req.context.state ?? '?'}`);

    const results = parts.map((p, i) => this.resolvePart(p, role, req, add, record.model_context_unit_ids, assist?.parts[i]));

    // 12. Outcome per part
    const outcomes = results.map((r) => r.outcome);
    const overall: Outcome = outcomes.every((o) => o === outcomes[0])
      ? outcomes[0]
      : outcomes.includes('answer') ? 'answer' : outcomes[0];
    add(12, 'Return outcome per part', 'D', results.map((r) => `${r.part}: ${r.outcome}`).join(' | '));

    // 13. Reproducibility record and gap capture
    const gap = outcomes.includes('insufficient_evidence');
    record.latency_ms = Math.round(performance.now() - t0);
    add(13, 'Persist record', 'D', `${record.request_id}${gap ? '; gap logged to author queue' : ''}`);

    return { outcome: overall, parts: results, trace, record, gap_logged: gap };
  }

  private resolvePart(
    part: string,
    role: Role,
    req: ServeRequest,
    add: (s: number, n: string, k: TraceStep['kind'], d: string) => void,
    modelContext: string[],
    assistPart?: AssistPart,
  ): PartResult {
    const exclusions: Exclusion[] = [];
    const path: string[] = [];
    const base = { part, candidates: [] as Candidate[], exclusions, resolution_path: path };

    // 6. Search body index (entitlement-filtered) and, if needed, routing index
    // A unit referenced by id is a lookup, not a search (F11). The same
    // entitlement rule applies: outside the caller's knowledge bases it is
    // not_authorized, with the routing fields only.
    const idRef = part.match(/\bU-[A-Z]{2}-\d{3}\b/i)?.[0].toUpperCase();
    const refUnit = idRef ? this.byId.get(idRef) : undefined;
    if (refUnit && !role.knowledge_bases.includes(refUnit.knowledge_base)) {
      path.push(`unit id ${refUnit.unit_id} requested; in ${refUnit.knowledge_base}, outside entitlement`);
      add(6, 'Search', 'D', `id lookup ${refUnit.unit_id}: not entitled`);
      return {
        ...base, outcome: 'not_authorized', unit_ids: [], text: null, owner_team: refUnit.owner,
        message: `This is owned by ${refUnit.owner} (${refUnit.knowledge_base}). Transfer or ask that team.`,
        verification: { verbatim_exact: null, in_scope: true },
      };
    }
    let candidates = refUnit && refUnit.status === 'approved'
      ? [{ unit_id: refUnit.unit_id, version: refUnit.version, score: 100, coverage: 1, phrase_match: true, anchored: true }]
      : this.index.search(part, role.knowledge_bases);
    // Query agent proposals (already filtered to real, in-scope, approved ids)
    // go first. They only nominate candidates; steps 7 to 9 still decide.
    if (assistPart && assistPart.unit_ids.length) {
      const top = Math.max(0, ...candidates.map((c) => c.score));
      const proposed = assistPart.unit_ids.map((id) => {
        const u = this.byId.get(id)!;
        return { unit_id: id, version: u.version, score: top + 10, coverage: 1, phrase_match: true, anchored: true };
      });
      candidates = [...proposed, ...candidates.filter((c) => !assistPart.unit_ids.includes(c.unit_id))];
      path.push(`query agent proposed ${assistPart.unit_ids.join(', ')}`);
    }
    base.candidates = candidates.slice(0, 5);
    // A candidate qualifies on query coverage, or when the query contains one of
    // its curated synonym phrases (FAILURES.md F02). Coverage only counts when at
    // least one word hits the title or synonyms: body-only matches are
    // incidental words ("on file", "pharmacy system"), not topic (F06).
    const qualifying = candidates.filter((c) => (c.coverage >= MIN_COVERAGE && c.anchored) || c.phrase_match);
    add(6, 'Search', 'D', `"${part}": ${candidates.slice(0, 3).map((c) => `${c.unit_id} s=${c.score} cov=${c.coverage}`).join(', ') || 'no hits'}`);

    if (qualifying.length === 0 && assistPart && assistPart.restricted_ids.length) {
      const r = this.byId.get(assistPart.restricted_ids[0])!;
      path.push(`query agent matched "${r.title}" in ${r.knowledge_base}, outside entitlement (routing fields only)`);
      return {
        ...base, outcome: 'not_authorized', unit_ids: [], text: null, owner_team: r.owner,
        message: `This is owned by ${r.owner} (${r.knowledge_base}). Transfer or ask that team.`,
        verification: { verbatim_exact: null, in_scope: true },
      };
    }
    if (qualifying.length === 0) {
      const restricted = this.index.route(part).filter((r) => !role.knowledge_bases.includes(r.knowledge_base));
      if (restricted.length > 0) {
        const r = restricted[0];
        path.push(`routing index: "${r.title}" in ${r.knowledge_base}, outside entitlement`);
        return {
          ...base, outcome: 'not_authorized', unit_ids: [], text: null, owner_team: r.owner,
          message: `This is owned by ${r.owner} (${r.knowledge_base}). Transfer or ask that team.`,
          verification: { verbatim_exact: null, in_scope: true },
        };
      }
      path.push('no entitled unit above coverage threshold; routing index found nothing restricted');
      return this.abstain(base, 'No approved content found. Logged as a gap for the knowledge team.');
    }

    // Same-question cluster: near the top score and sharing a synonym phrase with the top unit.
    const top = qualifying[0];
    const topPhrases = new Set(this.index.phrases(top.unit_id));
    const cluster = qualifying.filter(
      (c) => c === top || (c.score >= 0.8 * top.score && this.index.phrases(c.unit_id).some((p) => topPhrases.has(p))),
    );
    path.push(`cluster: ${cluster.map((c) => c.unit_id).join(', ')}`);

    // 7. Eligibility: effective, not past review date
    const asOf = this.data.asOf;
    let live = cluster.map((c) => this.byId.get(c.unit_id)!).filter((u) => {
      if (u.effective_date > asOf) { exclusions.push({ unit_id: u.unit_id, reason: 'not yet effective' }); return false; }
      return true;
    });
    const stale = new Set(live.filter((u) => u.review_date < asOf).map((u) => u.unit_id));
    add(7, 'Eligibility', 'D', `${live.length} eligible${stale.size ? `; past review date: ${[...stale].join(', ')}` : ''}`);

    // 8. Applicability: lob, state, plan year, audience, channel
    const needs: string[] = [];
    live = live.filter((u) => {
      const why = this.notApplicable(u, role, req.channel, req.context);
      if (why === 'needs_state') { needs.push(u.unit_id); return true; }
      if (why) { exclusions.push({ unit_id: u.unit_id, reason: why }); return false; }
      return true;
    });
    add(8, 'Applicability', 'D', `${live.length} applicable${exclusions.length ? `; excluded ${exclusions.map((e) => `${e.unit_id} (${e.reason})`).join(', ')}` : ''}`);

    if (live.length === 0) {
      path.push('relevant units exist but none applies to this caller and context');
      return this.abstain(base, 'Approved content exists but does not apply here. Logged as a gap.');
    }
    if (live.every((u) => needs.includes(u.unit_id))) {
      path.push(`applicability depends on state: ${needs.join(', ')}`);
      return {
        ...base, outcome: 'needs_clarification', unit_ids: [], text: null,
        message: "Which state is the member's plan in?",
        verification: { verbatim_exact: null, in_scope: true },
      };
    }
    live = live.filter((u) => !needs.includes(u.unit_id));

    // 9. Authority, then recency; equal and disagreeing: conflict
    const best = Math.max(...live.map((u) => AUTHORITY_RANK[u.authority_level]));
    live = live.filter((u) => AUTHORITY_RANK[u.authority_level] === best);
    const superseded = new Set(live.map((u) => u.supersedes).filter((s): s is string => !!s));
    live = live.filter((u) => !superseded.has(u.unit_id));
    // Recency acts only through an explicit supersedes link (applied above).
    // Run 01 showed implicit date recency silently picks a winner between two
    // live, approved units that disagree, which is the model-free version of
    // "the system picked". See evals/FAILURES.md F01.
    if (superseded.size) path.push(`supersedes: ${[...superseded].join(', ')} replaced`);
    add(9, 'Authority and recency', 'D', live.length > 1 ? `conflict: ${live.map((u) => u.unit_id).join(' vs ')}` : `selected ${live[0].unit_id}`);

    if (live.length > 1) {
      path.push('equal authority and applicability; units disagree');
      return {
        ...base, outcome: 'conflict', unit_ids: live.map((u) => u.unit_id), text: null,
        owner_team: [...new Set(live.map((u) => u.owner))].join(', '),
        message: 'Two approved sources disagree. Both shown; routed to owners.',
        verification: { verbatim_exact: null, in_scope: true },
      };
    }

    const unit = live[0];
    modelContext.push(unit.unit_id);

    // 10. Compose: verbatim inserted by unit_id; baseline is extractive for everything
    const text = req.channel === 'voice' && !unit.verbatim && unit.spoken_version ? unit.spoken_version : unit.body;
    add(10, 'Compose', unit.verbatim ? 'D' : 'P', unit.verbatim ? `verbatim ${unit.unit_id} v${unit.version} inserted by id` : `extractive from ${unit.unit_id} v${unit.version}`);

    // 11. Verify: verbatim exact, in scope
    const verbatimExact = unit.verbatim ? text === unit.body : null;
    const inScope = role.knowledge_bases.includes(unit.knowledge_base);
    add(11, 'Verify', 'D+P', `verbatim_exact=${verbatimExact ?? 'n/a'}; in_scope=${inScope}`);
    if (verbatimExact === false || !inScope) {
      path.push('verification failed; answer withheld');
      return this.abstain(base, 'Verification failed. Answer withheld.');
    }

    if (stale.has(unit.unit_id)) {
      path.push(`past review date ${unit.review_date}`);
      return {
        ...base, outcome: 'stale', unit_ids: [unit.unit_id], text,
        message: `Past its review date (${unit.review_date}). Do not present as current; owner notified.`,
        verification: { verbatim_exact: verbatimExact, in_scope: inScope },
      };
    }
    return {
      ...base, outcome: 'answer', unit_ids: [unit.unit_id], text,
      message: `${unit.title} · ${unit.owner} · v${unit.version} · effective ${unit.effective_date}`,
      verification: { verbatim_exact: verbatimExact, in_scope: inScope },
    };
  }

  private abstain(base: Omit<PartResult, 'outcome' | 'unit_ids' | 'text' | 'message' | 'verification'>, message: string): PartResult {
    return { ...base, outcome: 'insufficient_evidence', unit_ids: [], text: null, message, verification: { verbatim_exact: null, in_scope: true } };
  }

  private notApplicable(u: KnowledgeUnit, role: Role, channel: string, ctx: RequestContext): string | 'needs_state' | null {
    if (!u.audience.includes(role.audience)) return `audience ${role.audience}`;
    if (!u.channels.includes(channel)) return `channel ${channel}`;
    if (ctx.lob && !u.applies_to.lob.includes(ctx.lob)) return `lob ${ctx.lob}`;
    const year = ctx.plan_year ?? Number(this.data.asOf.slice(0, 4));
    if (u.applies_to.plan_year !== year) return `plan year ${year}`;
    if (u.applies_to.states !== 'ALL') {
      if (!ctx.state) return 'needs_state';
      if (!u.applies_to.states.includes(ctx.state)) return `state ${ctx.state}`;
    }
    return null;
  }
}

// Split "how long does mail order take and is shipping free" into parts.
export function splitParts(q: string): string[] {
  const parts = q
    .split(/\s+and\s+(?=(?:is|are|does|do|can|what|how|when|where|will)\b)/i)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : [q.trim()];
}
