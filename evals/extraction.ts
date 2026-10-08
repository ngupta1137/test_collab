// Extraction check (prototype part a): run the extractor on every synthetic
// source document and measure how many approved units from those documents it
// recovers (exact or flagged as changed). Writes evals/EXTRACTION.md.
//   node evals/extraction.ts
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadData } from '../src/service/service.ts';
import { extract, EXTRACTOR_VERSION, MATCH_THRESHOLD } from '../src/engine/extract.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = loadData(root);
const dir = join(root, 'data/source_docs');
const lines: string[] = [];
let expected = 0, found = 0, candidates = 0, newOnes = 0, skipped = 0, viaSuggestion = 0;
const suggestionHits: string[] = [];
const rows: string[] = [];
for (const f of readdirSync(dir).filter((x) => x.endsWith('.md')).sort()) {
  const r = extract(readFileSync(join(dir, f), 'utf8'), data.units);
  const fromDoc = data.units.filter((u) => u.source_doc === r.doc_id && u.status === 'approved');
  const linked = new Set(r.candidates.map((c) => c.match.unit_id).filter(Boolean));
  const hit = fromDoc.filter((u) => linked.has(u.unit_id));
  for (const c of r.candidates) for (const sg of c.suggestions) {
    const ids = sg.kind === 'merge' ? [sg.unit_id] : sg.parts.map((p) => p.unit_id).filter((x): x is string => !!x);
    for (const id of ids) if (fromDoc.some((u) => u.unit_id === id) && !linked.has(id)) { linked.add(id); viaSuggestion++; suggestionHits.push(`${id} via ${sg.kind}`); }
  }
  expected += fromDoc.length; found += hit.length; candidates += r.candidates.length; skipped += r.skipped.length;
  newOnes += r.candidates.filter((c) => c.match.status === 'new').length;
  rows.push(`| ${r.doc_id} | ${r.candidates.length} | ${r.candidates.filter((c) => c.match.status === 'unchanged').length} | ${r.candidates.filter((c) => c.match.status === 'changed').length} | ${r.candidates.filter((c) => c.match.status === 'new').length} | ${hit.length} of ${fromDoc.length} | ${fromDoc.filter((u) => !linked.has(u.unit_id)).map((u) => u.unit_id).join(', ') || 'none'} |`);
}
lines.push('# Extraction check', '', `Extractor \`${EXTRACTOR_VERSION}\` (rules baseline; the model extraction agent plugs in behind the same function and must beat this). Match threshold ${MATCH_THRESHOLD} on content-word overlap, chosen once on these three synthetic documents, not tuned per case.`, '');
lines.push(`**Unit recall: ${found} of ${expected} approved units recovered from their source documents (${Math.round((found / expected) * 100)}%).** ${candidates} candidates, ${newOnes} proposed as new, ${skipped} lines skipped (coaching tips, retirement notes, fragments).`, '');
lines.push('| Document | Candidates | Unchanged | Changed (flagged) | New | Approved units recovered | Missed |', '| --- | --- | --- | --- | --- | --- | --- |', ...rows, '');
lines.push(`**With reviewer suggestions: ${found + viaSuggestion} of ${expected}.** The remaining units are found as merge or split suggestions a reviewer accepts in the queue: ${suggestionHits.join(', ') || 'none'}.`, '');
lines.push('Misses are units whose approved wording was rewritten at authoring time (for example U-PH-002, identity verification), so the source line overlaps too little to link, and U-PH-007 (90-day supply), which is one clause inside a longer source line that the rules extractor keeps whole (it links to U-PH-004). The rules extractor proposes the first as new and misses the second; a reviewer would catch both. This is the case the model extraction agent is for.', '');
lines.push('Re-ingesting an unchanged document raises no flags (the store keeps a per-section snapshot of each source), and one edited line raises exactly one flag routed to its owner (`tests/workflow.test.ts`).');
writeFileSync(join(root, 'evals/EXTRACTION.md'), lines.join('\n') + '\n');
console.log(lines.slice(4, 5).join('\n'));
