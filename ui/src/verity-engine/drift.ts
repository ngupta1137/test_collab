// @ts-nocheck
// Copied from the Verity engine repo (src/engine, src/agents, src/gateway). Type-checked and tested there
// (node --test, 13 tests; evals/run.ts). Do not edit here: change it in verity and copy again.
// Authoring-time dedup and drift (FOUNDATIONS section 10).
// Steps 1 and 2 are deterministic and decide the FLAG. Step 4 (impact
// classification) is a model job in production; the baseline below is a
// keyword heuristic that only sets queue priority. Nothing in step 4 can
// clear a flag.


export function normalizeForHash(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

// FNV-1a (portable, no node:crypto) for the UI copy; the verity repo uses sha256.
export function hash(s: string): string {
  let h = 0x811c9dc5;
  for (const ch of normalizeForHash(s)) { h ^= ch.codePointAt(0)!; h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

function words(s: string): string[] {
  return normalizeForHash(s).replace(/[.,;:!?]/g, '').split(' ').filter(Boolean);
}

/** Word-level diff via LCS; consecutive edits grouped as "old->new", "+added", "-removed". */
export function wordDiff(before: string, after: string): string[] {
  const a = words(before);
  const b = words(after);
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: string[] = [];
  let del: string[] = [];
  let ins: string[] = [];
  const flush = () => {
    if (del.length && ins.length) out.push(`${del.join(' ')}->${ins.join(' ')}`);
    else if (ins.length) out.push(`+${ins.join(' ')}`);
    else if (del.length) out.push(`-${del.join(' ')}`);
    del = [];
    ins = [];
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { flush(); i++; j++; }
    else if (j < b.length && (i >= a.length || dp[i][j + 1] >= dp[i + 1][j])) ins.push(b[j++]);
    else del.push(a[i++]);
  }
  flush();
  return out;
}

export interface DriftResult {
  flag: boolean;
  kind: 'formatting_only' | 'near_duplicate' | 'drift' | 'semantic_duplicate';
  impact: string;
  diff: string[];
  route_to: string;
  hash_before: string;
  hash_after: string;
  similarity: number;
  impact_source: 'baseline-heuristic';
}

const NEGATION = /\b(not|never|no longer|cannot|won't|will not)\b/;
const NARROWING = /\b(except|only|unless|excluding|not available in)\b/;

export function checkChange(before: string, after: string, verbatim: boolean): DriftResult {
  const hb = hash(before);
  const ha = hash(after);
  const a = new Set(words(before));
  const b = new Set(words(after));
  const inter = [...a].filter((w) => b.has(w)).length;
  const similarity = Math.round((inter / new Set([...a, ...b]).size) * 100) / 100;
  if (hb === ha) {
    return { flag: false, kind: 'formatting_only', impact: 'none', diff: [], route_to: 'none', hash_before: hb, hash_after: ha, similarity: 1, impact_source: 'baseline-heuristic' };
  }
  const diff = wordDiff(before, after);
  const added = diff.map((d) => (d.startsWith('+') ? d.slice(1) : d.includes('->') ? d.split('->')[1] : '')).join(' ');
  const removed = diff.map((d) => (d.startsWith('-') ? d.slice(1) : d.includes('->') ? d.split('->')[0] : '')).join(' ');

  let kind: DriftResult['kind'];
  let impact: string;
  if (NEGATION.test(added) && !NEGATION.test(removed)) { kind = 'drift'; impact = 'contradiction'; }
  else if (diff.every((d) => d.startsWith('+')) && NARROWING.test(added)) { kind = 'drift'; impact = 'narrowing_scope'; }
  else if (similarity >= 0.6) { kind = 'near_duplicate'; impact = 'equivalent_wording'; }
  else { kind = 'semantic_duplicate'; impact = 'equivalent_meaning'; }

  // Any textual change is flagged. Similarity and impact only set routing and priority.
  const owner = verbatim ? 'Legal (verbatim)' : 'Author';
  const priority = impact === 'contradiction' ? ', high priority' : impact === 'equivalent_meaning' ? ', low priority' : '';
  return { flag: true, kind, impact, diff, route_to: owner + priority, hash_before: hb, hash_after: ha, similarity, impact_source: 'baseline-heuristic' };
}
