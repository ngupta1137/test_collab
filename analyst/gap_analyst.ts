// Gap analyst (offline, batch). Reads the search log and the live gap queue,
// finds what Verity could not answer, and PROPOSES work for humans:
//   1. lexicon additions (typos, joined tokens), each re-tested before proposing
//   2. clusters of unanswered questions, each a draft-unit stub
//   3. for each cluster, whether a source document already covers it
//      (extraction gap) or not (content gap: route to the business owner)
// Nothing is published. Every proposal needs an author and an approver.
//
// Baseline is deterministic. The model-backed version (FOUNDATIONS section 11,
// the one agentic component) adds drafting from source passages and smarter
// clustering behind the same output format.
//
//   node analyst/gap_analyst.ts   -> analyst/gap_report.json, analyst/GAP_REPORT.md

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Verity } from '../src/engine/pipeline.ts';
import { loadData } from '../src/service/service.ts';
import { prepare } from '../src/engine/text.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = loadData(root);
const engine = new Verity(data);
const SERVING_ROLES = Object.keys(data.roles).filter((r) => data.roles[r].audience === 'advocate');

// ---- inputs -------------------------------------------------------------
const log: { id: string; text: string; seen?: string }[] = JSON.parse(readFileSync(join(root, 'data/search_log.json'), 'utf8')).queries;
const queuePath = join(root, 'runtime/gaps.jsonl');
const queue = existsSync(queuePath)
  ? readFileSync(queuePath, 'utf8').trim().split('\n').filter(Boolean).map((l, i) => ({ id: `GQ${i + 1}`, text: JSON.parse(l).query_redacted as string, seen: data.asOf }))
  : [];
const queries = [...log, ...queue];

// ---- 1. classify every query (as each advocate role) ---------------------
function bestOutcome(text: string, lexicon = data.lexicon) {
  const e = lexicon === data.lexicon ? engine : new Verity({ ...data, lexicon });
  const outcomes = SERVING_ROLES.map((role) => ({ role, r: e.serve({ query: text, role, channel: 'advocate_view', context: { lob: 'MAPD', state: null } }) }));
  const answered = outcomes.find((o) => o.r.outcome !== 'insufficient_evidence' && o.r.outcome !== 'not_authorized');
  if (answered) return { status: 'served', outcome: answered.r.outcome, role: answered.role, units: answered.r.parts.flatMap((p) => p.unit_ids) };
  if (outcomes.some((o) => o.r.outcome === 'not_authorized')) return { status: 'routed', outcome: 'not_authorized', role: null, units: [] };
  return { status: 'gap', outcome: 'insufficient_evidence', role: null, units: [] };
}
const classified = queries.map((q) => ({ ...q, ...bestOutcome(q.text) }));

// ---- 2. lexicon proposals -------------------------------------------------
const vocab = engine.vocabulary();
function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
}
const logTokens = new Set(queries.flatMap((q) => prepare(q.text, data.lexicon).tokens));
const proposals = new Map<string, { from: string; to: string; kind: string; evidence: string[] }>();
for (const q of queries) {
  for (const t of prepare(q.text, data.lexicon).tokens) {
    if (vocab.has(t)) continue;
    // joined letters and digits, e.g. "tier3" -> "tier 3", when the split form is used elsewhere
    const split = t.match(/^([a-z]+)(\d+)$/);
    if (split && logTokens.has(split[1])) {
      const key = `${t}->${split[1]} ${split[2]}`;
      proposals.set(key, { from: t, to: `${split[1]} ${split[2]}`, kind: 'joined_token', evidence: [...(proposals.get(key)?.evidence ?? []), q.id] });
      continue;
    }
    // probable typo of a word the knowledge base already uses
    if (t.length < 5) continue;
    const limit = t.length >= 8 ? 2 : 1;
    const near = [...vocab].filter((v) => Math.abs(v.length - t.length) <= limit && editDistance(t, v) <= limit);
    if (near.length === 1) {
      const key = `${t}->${near[0]}`;
      proposals.set(key, { from: t, to: near[0], kind: 'typo', evidence: [...(proposals.get(key)?.evidence ?? []), q.id] });
    }
  }
}
// Re-test each proposal: does it change any outcome?
const lexiconProposals = [...proposals.values()].map((p) => {
  const trial = { ...data.lexicon, [p.from]: p.to };
  const effects = p.evidence.map((qid) => {
    const q = queries.find((x) => x.id === qid)!;
    const before = classified.find((c) => c.id === qid)!;
    const after = bestOutcome(q.text, trial);
    return { query: qid, before: before.outcome, after: after.outcome, units: after.units };
  });
  return { ...p, effects, status: 'proposed: needs Knowledge Ops approval' };
});

// ---- 3. cluster unanswered questions -------------------------------------
const accepted = Object.fromEntries(lexiconProposals.map((p) => [p.from, p.to]));
const gapQueries = classified
  .filter((c) => c.status === 'gap')
  .map((c) => ({ ...c, tokens: new Set(prepare(c.text, { ...data.lexicon, ...accepted }).tokens) }));
const parent = gapQueries.map((_, i) => i);
const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
for (let i = 0; i < gapQueries.length; i++)
  for (let j = i + 1; j < gapQueries.length; j++) {
    const a = gapQueries[i].tokens;
    const b = gapQueries[j].tokens;
    const shared = [...a].filter((t) => b.has(t)).length;
    const jaccard = shared / new Set([...a, ...b]).size;
    if (shared >= 2 || jaccard >= 0.5) parent[find(i)] = find(j);
  }
const groups = new Map<number, typeof gapQueries>();
gapQueries.forEach((q, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), q]));

// Source evidence: does any source document already say something about this?
const sources = readdirSync(join(root, 'data/source_docs')).map((f) => ({
  file: f,
  lines: readFileSync(join(root, 'data/source_docs', f), 'utf8').split('\n').filter((l) => l.trim()),
}));
function sourceEvidence(tokens: Set<string>) {
  const hits: { file: string; line: string; shared: string[] }[] = [];
  for (const s of sources)
    for (const line of s.lines) {
      const lt = new Set(prepare(line, data.lexicon).tokens);
      const shared = [...tokens].filter((t) => lt.has(t));
      if (shared.length >= 2) hits.push({ file: s.file, line: line.trim().slice(0, 160), shared });
    }
  return hits;
}

const clusters = [...groups.values()]
  .map((qs) => {
    const tokens = new Set(qs.flatMap((q) => [...q.tokens]));
    const counts = new Map<string, number>();
    qs.forEach((q) => q.tokens.forEach((t) => counts.set(t, (counts.get(t) ?? 0) + 1)));
    const core = [...counts.entries()].filter(([, n]) => n === qs.length || qs.length === 1).map(([t]) => t);
    const evidence = sourceEvidence(tokens);
    const nearest = engine.nearest(qs[0].text);
    const nearestUnit = nearest ? engine.unit(nearest.unit_id) : undefined;
    return {
      cluster_id: '',
      questions: qs.map((q) => ({ id: q.id, text: q.text })),
      demand: qs.length,
      first_seen: qs.map((q: any) => q.seen as string | undefined).filter(Boolean).sort()[0] ?? null,
      age_days: (() => { const f = qs.map((q: any) => q.seen as string | undefined).filter(Boolean).sort()[0]; return f ? Math.max(0, Math.round((Date.parse(data.asOf) - Date.parse(f)) / 86400000)) : null; })(),
      suggested_owner: nearestUnit?.owner ?? 'Knowledge Ops (triage)',
      core_terms: core,
      gap_type: evidence.length ? 'extraction gap: a source passage exists, no approved unit yet' : 'content gap: no approved source; route to the business owner',
      source_evidence: evidence,
      nearest_existing_unit: nearestUnit ? { unit_id: nearestUnit.unit_id, title: nearestUnit.title, owner: nearestUnit.owner, coverage: nearest!.coverage } : null,
      draft_unit: {
        status: 'proposed',
        title: null as string | null, // written by the author (model-drafted in the agentic version)
        synonyms: qs.map((q) => q.text.toLowerCase()),
        body: null as string | null,
        knowledge_base: null as string | null,
        owner: 'to be assigned by Knowledge Ops',
        needs: ['author', 'approver', evidence.length ? 'confirm source passage' : 'business owner to supply the policy'],
      },
    };
  })
  .sort((a, b) => b.demand - a.demand || a.questions[0].id.localeCompare(b.questions[0].id))
  .map((c, i) => ({ ...c, cluster_id: `C${String(i + 1).padStart(2, '0')}` }));

// ---- outputs --------------------------------------------------------------
const summary = {
  queries: queries.length,
  from_search_log: log.length,
  from_gap_queue: queue.length,
  served: classified.filter((c) => c.status === 'served').length,
  routed_not_authorized: classified.filter((c) => c.status === 'routed').length,
  unanswered: gapQueries.length,
  clusters: clusters.length,
  lexicon_proposals: lexiconProposals.length,
};
const report = { engine: 'gap-analyst-baseline-0.1', as_of: data.asOf, summary, lexicon_proposals: lexiconProposals, clusters, classified: classified.map(({ id, text, status, outcome, role, units }) => ({ id, text, status, outcome, role, units })) };
writeFileSync(join(root, 'analyst/gap_report.json'), JSON.stringify(report, null, 2) + '\n');

const md: string[] = [];
md.push('# Gap report', '');
md.push(`Baseline gap analyst · as-of ${data.asOf} · synthetic search log. Everything below is a proposal for a human; nothing is published.`, '');
md.push(`**${summary.queries} queries:** ${summary.served} served, ${summary.routed_not_authorized} routed to another team, **${summary.unanswered} unanswered** in ${summary.clusters} clusters. ${summary.lexicon_proposals} lexicon proposals.`, '');
md.push('## Lexicon proposals', '', '| Proposal | Kind | Evidence | Effect when re-tested |', '| --- | --- | --- | --- |');
for (const p of lexiconProposals) md.push(`| "${p.from}" → "${p.to}" | ${p.kind} | ${p.evidence.join(', ')} | ${p.effects.map((e) => `${e.query}: ${e.before} → ${e.after}${e.units.length ? ` (${e.units.join(', ')})` : ''}`).join('; ')} |`);
if (!lexiconProposals.length) md.push('| none | | | |');
md.push('', '## Unanswered clusters, by demand', '');
md.push('| Cluster | Questions | Age | Suggested owner | Gap type | Nearest existing unit |', '| --- | --- | --- | --- | --- | --- |');
for (const c of clusters)
  md.push(`| ${c.cluster_id} (${c.demand}) | ${c.questions.map((q) => `${q.id} "${q.text}"`).join('<br>')} | ${c.age_days === null ? 'n/a' : c.age_days + ' days'} | ${c.suggested_owner} | ${c.gap_type} | ${c.nearest_existing_unit ? `${c.nearest_existing_unit.unit_id} ${c.nearest_existing_unit.title} (coverage ${c.nearest_existing_unit.coverage})` : 'none'} |`);
md.push('', '## Served or routed', '', '| Query | Outcome | Unit |', '| --- | --- | --- |');
for (const c of classified.filter((x) => x.status !== 'gap')) md.push(`| ${c.id} "${c.text}" | ${c.outcome}${c.role ? ` (${c.role})` : ''} | ${c.units.join(', ')} |`);
writeFileSync(join(root, 'analyst/GAP_REPORT.md'), md.join('\n') + '\n');
console.log(md.join('\n'));
