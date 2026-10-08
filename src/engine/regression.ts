// Publication gate: before an approved unit goes live, the golden set is run on
// the store as it would be afterwards. A case that passes today and fails after
// the change is a regression. A critical one blocks publication; the author or
// Legal then fixes the unit, or updates the golden case with owner sign-off
// (the expected answer changed on purpose). Cases that already fail are not
// blamed on this change. Fully deterministic: no model is involved.

import { Verity, type EngineData } from './pipeline.ts';
import type { KnowledgeUnit, ServeRequest, ServeResponse } from './types.ts';

export interface RegressionCase {
  case_id: string;
  query: string;
  role: string;
  channel: string;
  input_mode?: 'typed' | 'voice';
  context: { lob?: string | null; state?: string | null };
  expected_outcome: string;
  expected_unit_ids: string[];
  expected_parts?: { part: string; outcome: string; unit_ids: string[] }[];
  must_match_verbatim_exactly?: boolean;
  severity_if_wrong: string;
}

export interface Regression {
  case_id: string;
  query: string;
  severity: string;
  was: string;
  now: string;
}

export interface RegressionReport {
  checked: number;
  allowed: boolean;
  blocking: Regression[]; // new critical failures
  warnings: Regression[]; // new non-critical failures
  summary: string;
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

function passes(c: RegressionCase, r: ServeResponse, engine: Verity): { ok: boolean; got: string } {
  const gotIds = [...new Set(r.parts.flatMap((p) => p.unit_ids))];
  let ok: boolean;
  if (c.expected_parts) {
    ok = c.expected_parts.every((ep, i) => r.parts[i]?.outcome === ep.outcome && sameSet(r.parts[i]!.unit_ids, ep.unit_ids));
  } else {
    const needIds = ['answer', 'stale', 'conflict'].includes(c.expected_outcome);
    ok = r.outcome === c.expected_outcome && (!needIds || sameSet(gotIds, c.expected_unit_ids));
  }
  if (ok && c.must_match_verbatim_exactly) {
    const exp = engine.unit(c.expected_unit_ids[0]!);
    ok = r.outcome === 'answer' && !!exp && r.parts.some((p) => p.text === exp.body);
  }
  return { ok, got: `${r.outcome}${gotIds.length ? ` [${gotIds.join(', ')}]` : ''}` };
}

export function checkPublication(data: EngineData, before: KnowledgeUnit[], after: KnowledgeUnit[], cases: RegressionCase[]): RegressionReport {
  const a = new Verity({ ...data, units: before });
  const b = new Verity({ ...data, units: after });
  const blocking: Regression[] = [];
  const warnings: Regression[] = [];
  for (const c of cases) {
    const req: ServeRequest = { query: c.query, role: c.role, channel: c.channel, input_mode: c.input_mode, context: { lob: c.context?.lob ?? null, state: c.context?.state ?? null } };
    const was = passes(c, a.serve(req), a);
    if (!was.ok) continue; // already failing: not caused by this change
    const now = passes(c, b.serve(req), b);
    if (now.ok) continue;
    const item = { case_id: c.case_id, query: c.query, severity: c.severity_if_wrong, was: was.got, now: now.got };
    (c.severity_if_wrong === 'critical' ? blocking : warnings).push(item);
  }
  const allowed = blocking.length === 0;
  return {
    checked: cases.length,
    allowed,
    blocking,
    warnings,
    summary: allowed
      ? `Regression check: ${cases.length} golden cases, no new critical failures${warnings.length ? `, ${warnings.length} non-critical change${warnings.length > 1 ? 's' : ''} to review` : ''}.`
      : `Blocked: ${blocking.length} golden case${blocking.length > 1 ? 's' : ''} would newly fail (${blocking.map((x) => x.case_id).join(', ')}). Fix the unit, or update the golden case with its owner's sign-off.`,
  };
}
