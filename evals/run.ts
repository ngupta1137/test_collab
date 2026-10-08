// Verity eval runner: golden set (serving) + authoring set (dedup/drift).
// Usage: node evals/run.ts [--label name] [--set data/blind_set.json] [--model live|cache-only]
// Writes evals/results.json, evals/REPORT.md and evals/runs/<label>.json.
// Exits 1 when a release gate fails (FOUNDATIONS section 14).
//
// Rule: results are whatever the engine produced. Never edit results by hand.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Verity, ENGINE_VERSION } from '../src/engine/pipeline.ts';
import { checkChange } from '../src/engine/drift.ts';
import type { KnowledgeUnit, ServeResponse } from '../src/engine/types.ts';
import { Gateway, type Mode } from '../src/gateway/gateway.ts';
import { QUERY_PROMPT_VERSION } from '../src/agents/queryAgent.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = (p: string) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const labelArg = process.argv.indexOf('--label');
const label = labelArg > -1 ? process.argv[labelArg + 1] : `run-${new Date().toISOString().replace(/[:.]/g, '-')}`;

const unitsRaw = load('data/units_seed.json');
const units: KnowledgeUnit[] = Array.isArray(unitsRaw) ? unitsRaw : unitsRaw.units;
const roles = load('data/roles.json').roles;
const lexicon = load('data/lexicon.json').entries;
const setArg = process.argv.indexOf('--set');
const setPath = setArg > -1 ? process.argv[setArg + 1] : 'data/golden_set.json';
const isGolden = setPath === 'data/golden_set.json';
const suffix = isGolden ? '' : '_' + setPath.replace(/^.*\//, '').replace(/\.json$/, '');
const golden = load(setPath);
const authoring = load('data/authoring_cases.json');
const asOf: string = golden.as_of_date_for_staleness;

const engine = new Verity({ units, roles, lexicon, asOf });
// --model live | cache-only  (default off: deterministic baseline, no model calls)
const modelArg = process.argv.indexOf('--model');
const gw = new Gateway({ root, mode: (modelArg > -1 ? process.argv[modelArg + 1] : 'off') as Mode });
try {
  await gw.preflight();
} catch (e) {
  console.error((e as Error).message);
  console.error('Fix the key (see docs/MODEL_RUN.md) and run again. No results were written.');
  process.exit(2);
}
const engineLabel = gw.enabled ? `${ENGINE_VERSION}+${QUERY_PROMPT_VERSION}@${gw.modelFor('query')} (${gw.mode})` : ENGINE_VERSION;

interface CaseResult {
  case_id: string;
  query: string;
  role: string;
  channel: string;
  slices: string[];
  severity: string;
  expected: { outcome: string; unit_ids: string[]; parts?: { part: string; outcome: string; unit_ids: string[] }[] };
  got: { outcome: string; unit_ids: string[]; parts: { part: string; outcome: string; unit_ids: string[] }[] };
  outcome_correct: boolean;
  parts_total: number;
  parts_correct: number;
  recall_at_3: boolean | null;
  verbatim_exact: boolean | null;
  leak: boolean;
  retired_exposed: boolean;
  phi_ok: boolean | null;
  critical_failure: boolean;
  failure_reasons: string[];
  latency_ms: number;
  trace: ServeResponse['trace'];
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

function scoreCase(c: any, r: ServeResponse): CaseResult {
  // r: the engine response for this case (baseline or model-assisted)
  const role = roles[c.role];
  const reasons: string[] = [];

  // Outcome accuracy, per part where the case defines parts
  let partsTotal = 1;
  let partsCorrect = 0;
  if (c.expected_parts) {
    partsTotal = c.expected_parts.length;
    c.expected_parts.forEach((ep: any, i: number) => {
      const gp = r.parts[i];
      if (gp && gp.outcome === ep.outcome && sameSet(gp.unit_ids, ep.unit_ids)) partsCorrect++;
      else reasons.push(`part ${i + 1} "${ep.part}": expected ${ep.outcome} [${ep.unit_ids}], got ${gp ? `${gp.outcome} [${gp.unit_ids}]` : 'no such part'}`);
    });
  } else {
    const gotIds = [...new Set(r.parts.flatMap((p) => p.unit_ids))];
    const needIds = ['answer', 'stale', 'conflict'].includes(c.expected_outcome);
    const ok = r.outcome === c.expected_outcome && (!needIds || sameSet(gotIds, c.expected_unit_ids));
    if (ok) partsCorrect = 1;
    else reasons.push(`expected ${c.expected_outcome} [${c.expected_unit_ids}], got ${r.outcome} [${gotIds}]`);
  }

  // Unit recall@3 (retrieval quality, independent of resolution)
  let recall: boolean | null = null;
  if (c.expected_unit_ids.length) {
    const top3 = r.parts.flatMap((p) => p.candidates.slice(0, 3).map((x) => x.unit_id));
    recall = c.expected_unit_ids.every((id: string) => top3.includes(id));
  }

  // Verbatim exactness (typed and spoken)
  let verbatim: boolean | null = null;
  if (c.must_match_verbatim_exactly) {
    const exp: KnowledgeUnit | undefined = engine.unit(c.expected_unit_ids[0]);
    verbatim = r.outcome === 'answer' && !!exp && r.parts.some((p) => p.text === exp.body);
    if (!verbatim) reasons.push('verbatim not delivered exactly');
  }

  // Permission leakage: anything in model context or shown text outside entitlement
  const leak =
    r.record.model_context_unit_ids.some((id) => !role.knowledge_bases.includes(engine.unit(id)!.knowledge_base)) ||
    r.parts.some((p) => p.text !== null && units.some((u) => !role.knowledge_bases.includes(u.knowledge_base) && p.text === u.body));
  if (leak) reasons.push('permission leak');

  // Retired content never cited
  const retired = r.parts.some((p) => p.unit_ids.some((id) => engine.unit(id)?.status === 'retired'));
  if (retired) reasons.push('retired unit cited');

  // PHI: nothing that looks like a date or the original name survives into the record
  let phi: boolean | null = null;
  if (c.must_redact) {
    const names = (c.query.match(/\b[A-Z][a-z]+ [A-Z][a-z]+\b/g) ?? []) as string[];
    phi = !/\d{1,2}\/\d{1,2}\/\d{2,4}/.test(r.record.query_redacted) && names.every((n) => !r.record.query_redacted.includes(n));
    if (!phi) reasons.push('PHI survived redaction');
  }

  const outcomeCorrect = partsCorrect === partsTotal;
  const critical = c.severity_if_wrong === 'critical' && (!outcomeCorrect || verbatim === false || leak || retired || phi === false);

  return {
    case_id: c.case_id, query: c.query, role: c.role, channel: c.channel, slices: c.slices, severity: c.severity_if_wrong,
    expected: { outcome: c.expected_outcome, unit_ids: c.expected_unit_ids, parts: c.expected_parts },
    got: { outcome: r.outcome, unit_ids: [...new Set(r.parts.flatMap((p) => p.unit_ids))], parts: r.parts.map((p) => ({ part: p.part, outcome: p.outcome, unit_ids: p.unit_ids })) },
    outcome_correct: outcomeCorrect, parts_total: partsTotal, parts_correct: partsCorrect,
    recall_at_3: recall, verbatim_exact: verbatim, leak, retired_exposed: retired, phi_ok: phi,
    critical_failure: critical, failure_reasons: reasons, latency_ms: r.record.latency_ms, trace: r.trace,
  };
}

const results: CaseResult[] = [];
for (const c of golden.cases) {
  const req = { query: c.query, role: c.role, channel: c.channel, input_mode: c.input_mode, context: c.context ?? { lob: null, state: null } };
  results.push(scoreCase(c, gw.enabled ? await engine.serveAsync(req, gw) : engine.serve(req)));
}
if (gw.mode === 'live' && gw.calls.errors > 0) {
  console.error(`${gw.calls.errors} model call(s) failed, so some cases ran without the model. No results were written; run again.`);
  process.exit(2);
}

// Authoring set
const authoringResults = authoring.cases.map((a: any) => {
  const unit = engine.unit(a.unit_id);
  const res = checkChange(a.before, a.after, unit?.verbatim ?? true);
  return {
    case_id: a.case_id, unit_id: a.unit_id, verbatim: unit?.verbatim ?? true,
    expected: { flag: a.expected_flag, kind: a.expected_kind, impact: a.expected_impact, diff: a.expected_diff },
    got: { flag: res.flag, kind: res.kind, impact: res.impact, diff: res.diff, route_to: res.route_to, similarity: res.similarity },
    flag_correct: res.flag === a.expected_flag,
    kind_correct: res.kind === a.expected_kind,
    impact_correct: res.impact === a.expected_impact,
  };
});

// Aggregates
const pct = (n: number, d: number) => (d === 0 ? null : Math.round((n / d) * 1000) / 10);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const lat = results.map((r) => r.latency_ms).sort((a, b) => a - b);
const q = (p: number) => lat[Math.min(lat.length - 1, Math.floor(p * lat.length))];

const verbatimCases = results.filter((r) => r.verbatim_exact !== null);
const typed = verbatimCases.filter((r) => r.channel !== 'voice');
const spoken = verbatimCases.filter((r) => r.channel === 'voice');
const abstainCases = results.filter((r) => r.expected.outcome !== 'answer');
const recallCases = results.filter((r) => r.recall_at_3 !== null);
const answered = results.filter((r) => r.expected.outcome === 'answer' && r.got.outcome === 'answer');
const flaggedExpected = authoringResults.filter((a: any) => a.expected.flag);
const flaggedGot = authoringResults.filter((a: any) => a.got.flag);
const verbatimFlagExpected = flaggedExpected.filter((a: any) => a.verbatim);

const metrics = {
  critical_failures: results.filter((r) => r.critical_failure).length,
  outcome_accuracy_per_part_pct: pct(sum(results.map((r) => r.parts_correct)), sum(results.map((r) => r.parts_total))),
  case_accuracy_pct: pct(results.filter((r) => r.outcome_correct).length, results.length),
  unit_recall_at_3_pct: pct(recallCases.filter((r) => r.recall_at_3).length, recallCases.length),
  citation_accuracy_pct: pct(answered.filter((r) => sameSet(r.got.unit_ids, r.expected.unit_ids)).length, answered.length),
  claim_support_pct: 'n/a: baseline composes extractively (unit text only); measured once a model composes',
  verbatim_exact_typed_pct: pct(typed.filter((r) => r.verbatim_exact).length, typed.length),
  verbatim_exact_spoken_pct: pct(spoken.filter((r) => r.verbatim_exact).length, spoken.length),
  permission_leaks: results.filter((r) => r.leak).length,
  abstention_accuracy_pct: pct(abstainCases.filter((r) => r.outcome_correct).length, abstainCases.length),
  retired_exposures: results.filter((r) => r.retired_exposed).length,
  phi_redaction_pct: pct(results.filter((r) => r.phi_ok).length, results.filter((r) => r.phi_ok !== null).length),
  authoring_flag_recall_pct: pct(flaggedExpected.filter((a: any) => a.got.flag).length, flaggedExpected.length),
  authoring_verbatim_flag_recall_pct: pct(verbatimFlagExpected.filter((a: any) => a.got.flag).length, verbatimFlagExpected.length),
  authoring_flag_precision_pct: pct(flaggedGot.filter((a: any) => a.expected.flag).length, flaggedGot.length),
  authoring_kind_accuracy_pct: pct(authoringResults.filter((a: any) => a.kind_correct).length, authoringResults.length),
  authoring_impact_accuracy_pct_heuristic: pct(authoringResults.filter((a: any) => a.impact_correct).length, authoringResults.length),
  latency_ms_p50: q(0.5),
  latency_ms_p95: q(0.95),
};

const sliceNames = [...new Set(results.flatMap((r) => r.slices))].sort();
const slices = Object.fromEntries(
  sliceNames.map((s) => {
    const rs = results.filter((r) => r.slices.includes(s));
    return [s, { cases: rs.length, correct: rs.filter((r) => r.outcome_correct).length, accuracy_pct: pct(rs.filter((r) => r.outcome_correct).length, rs.length), critical_failures: rs.filter((r) => r.critical_failure).length }];
  }),
);
const outcomeNames = [...new Set(results.map((r) => r.expected.outcome))].sort();
const byOutcome = Object.fromEntries(
  outcomeNames.map((o) => {
    const rs = results.filter((r) => r.expected.outcome === o);
    return [o, { cases: rs.length, correct: rs.filter((r) => r.outcome_correct).length }];
  }),
);

const gates = {
  zero_critical_failures: metrics.critical_failures === 0,
  zero_permission_leaks: metrics.permission_leaks === 0,
  verbatim_100: metrics.verbatim_exact_typed_pct === 100 && metrics.verbatim_exact_spoken_pct === 100,
  zero_retired_exposure: metrics.retired_exposures === 0,
  verbatim_drift_flag_recall_100: metrics.authoring_verbatim_flag_recall_pct === 100,
};
const releasable = Object.values(gates).every(Boolean);

const out = {
  label, engine: engineLabel, model_calls: gw.enabled ? gw.calls : null, as_of: asOf, run_at: new Date().toISOString(),
  set: setPath,
  note: `Prototype smoke test (${golden.cases.length} serving + 5 authoring cases), not a launch gate. Synthetic data.`,
  gates, releasable, metrics, slices, by_expected_outcome: byOutcome,
  cases: results, authoring: authoringResults,
};

mkdirSync(join(root, 'evals/runs'), { recursive: true });
writeFileSync(join(root, `evals/results${suffix}.json`), JSON.stringify(out, null, 2));
writeFileSync(join(root, `evals/runs/${label}.json`), JSON.stringify(out, null, 2));

// Markdown report
const yes = (b: boolean) => (b ? 'pass' : '**FAIL**');
const md: string[] = [];
md.push(`# Eval report: ${label}`, '', `Set: \`${setPath}\``, '');
md.push(`Engine \`${engineLabel}\` · as-of ${asOf} · ${results.length} serving cases, ${authoringResults.length} authoring cases · synthetic data · smoke test, not a launch gate.`, '');
md.push(`**Release: ${releasable ? 'PASS' : 'BLOCKED'}**`, '');
md.push('| Gate | Result |', '| --- | --- |');
for (const [k, v] of Object.entries(gates)) md.push(`| ${k.replace(/_/g, ' ')} | ${yes(v)} |`);
md.push('', '## Metrics', '', '| Metric | Value |', '| --- | --- |');
for (const [k, v] of Object.entries(metrics)) md.push(`| ${k.replace(/_/g, ' ')} | ${v ?? 'n/a'} |`);
md.push('', '## By slice', '', '| Slice | Cases | Correct | Critical failures |', '| --- | --- | --- | --- |');
for (const [k, v] of Object.entries(slices)) md.push(`| ${k} | ${v.cases} | ${v.correct} | ${v.critical_failures} |`);
md.push('', '## By expected outcome', '', '| Outcome | Cases | Correct |', '| --- | --- | --- |');
for (const [k, v] of Object.entries(byOutcome)) md.push(`| ${k} | ${v.cases} | ${v.correct} |`);
md.push('', '## Failing serving cases', '');
const failing = results.filter((r) => !r.outcome_correct || r.failure_reasons.length);
if (!failing.length) md.push('None.');
for (const r of failing) md.push(`- **${r.case_id}** (${r.severity}${r.critical_failure ? ', CRITICAL' : ''}) "${r.query}" as ${r.role}/${r.channel}: ${r.failure_reasons.join('; ')}`);
md.push('', '## Authoring cases', '', '| Case | Flag (exp/got) | Kind (exp/got) | Impact (exp/got, heuristic) | Diff |', '| --- | --- | --- | --- | --- |');
for (const a of authoringResults as any[]) md.push(`| ${a.case_id} | ${a.expected.flag}/${a.got.flag} | ${a.expected.kind}/${a.got.kind} | ${a.expected.impact}/${a.got.impact} | ${a.got.diff.join('; ')} |`);
writeFileSync(join(root, `evals/REPORT${suffix}.md`), md.join('\n') + '\n');

console.log(md.slice(0, 40).join('\n'));
console.log(`\nFailing: ${failing.map((r) => r.case_id).join(', ') || 'none'}`);
process.exitCode = releasable ? 0 : 1;
