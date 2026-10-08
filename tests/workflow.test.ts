// Authoring: source document -> candidate units -> approval gate -> published
// unit served by search.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadData } from '../src/service/service.ts';
import { extract } from '../src/engine/extract.ts';
import { KnowledgeStore, PublishBlocked, WorkflowError } from '../src/engine/workflow.ts';
import type { ServeRequest } from '../src/engine/types.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const doc = (f: string) => readFileSync(join(root, 'data/source_docs', f), 'utf8');
const ask = (query: string, role = 'pharmacy_advocate'): ServeRequest => ({ query, role, channel: 'advocate_view', context: { lob: 'MAPD', state: null } });
const legal = { name: 'Rita (Legal)', role: 'legal' as const };
const author = { name: 'Dana (Knowledge author)', role: 'author' as const };

test('extraction: messy script becomes typed units, coaching tips and retirement notes are not units', () => {
  const r = extract(doc('rx_education_script_A.md'), loadData(root).units);
  assert.equal(r.doc_id, 'KB-PHARM-0142');
  const verbatim = r.candidates.filter((c) => c.verbatim);
  assert.equal(verbatim.length, 3, 'opening, pricing disclaimer, closing');
  assert.ok(verbatim.every((c) => c.match.status === 'unchanged'), 'all three match approved units exactly');
  assert.ok(r.candidates.some((c) => c.type === 'procedure' && c.body.startsWith('1) Confirm shipping address')));
  assert.ok(!r.candidates.some((c) => /smile/i.test(c.body)), 'coaching tip skipped');
  assert.ok(r.skipped.some((s) => /retire/i.test(s.reason)), 'retirement note surfaced for the owner, not extracted');
});

test('dedup: the near-duplicate disclaimer in another script is flagged for Legal, never auto-matched', () => {
  const r = extract(doc('pharmacy_outreach_script_v3.md'), loadData(root).units);
  const d = r.candidates.find((c) => c.verbatim && /prices I give you/.test(c.body))!;
  assert.equal(d.match.status, 'changed');
  assert.equal(d.match.unit_id, 'U-PH-003');
  assert.equal(d.match.drift?.flag, true);
  assert.match(d.route_to, /^Legal/);
  const intro = r.candidates.find((c) => c.verbatim && /recorded line/.test(c.body))!;
  assert.equal(intro.match.status, 'unchanged', 'identical opening in a second script is recognized as the same unit');
});

test('approval gate: agents cannot approve, verbatim needs Legal, rejection needs a reason', () => {
  const store = new KnowledgeStore(loadData(root));
  const r = extract(doc('pharmacy_outreach_script_v3.md'), store.units());
  const c = r.candidates.find((x) => x.verbatim && x.match.status === 'changed')!;
  const d = store.proposeFromCandidate(c, 'agent:extraction')!;
  assert.equal(d.route_to, 'Legal');
  assert.throws(() => store.approve(d.draft_id, { name: 'agent:gap-analyst', role: 'legal' }), WorkflowError);
  assert.throws(() => store.approve(d.draft_id, author), /Legal/);
  assert.throws(() => store.reject(d.draft_id, legal, ''), /reason/);
  store.reject(d.draft_id, legal, 'Keep the approved wording; outreach script must be corrected');
  // Rejected: search still serves the approved v1 text.
  const res = store.engine().serve(ask('rx pricing disclaimer'));
  assert.deepEqual(res.parts[0]!.unit_ids, ['U-PH-003']);
  assert.match(res.parts[0]!.text!, /prices I share today/);
  assert.equal(store.units().find((u) => u.unit_id === 'U-PH-003')!.version, 1);
});

const allDocs = () => ['rx_education_script_A.md', 'pharmacy_outreach_script_v3.md', 'id_card_replacement_article.md'].map(doc);

test('source change: re-ingesting an unchanged document raises no flags; one edited line raises exactly one', () => {
  const store = new KnowledgeStore(loadData(root), allDocs());
  for (const t of allDocs()) assert.ok(store.ingest(t).candidates.every((c) => c.match.status === 'unchanged'));
  const r = store.ingest(doc('rx_education_script_A.md').replace('7 to 10 business days', '5 to 7 business days'));
  const flagged = r.candidates.filter((c) => c.match.status !== 'unchanged');
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0]!.match.unit_id, 'U-PH-006');
  assert.ok(flagged[0]!.match.drift!.diff.join(' ').includes('5 to'));
});

test('publishing: an approved revision is live on the next query, old version kept in history', () => {
  const store = new KnowledgeStore(loadData(root), allDocs());
  const r = store.ingest(doc('rx_education_script_A.md').replace('7 to 10 business days', '5 to 7 business days'));
  const c = r.candidates.find((x) => x.match.unit_id === 'U-PH-006')!;
  assert.equal(c.match.status, 'changed');
  const d = store.proposeFromCandidate(c, 'agent:extraction')!;
  assert.equal(d.route_to, 'Author');
  assert.ok(d.diff.some((x) => x.includes('5 to')));
  assert.throws(() => store.approve(d.draft_id, author, { body: '' }), /empty/);
  const u = store.approve(d.draft_id, author);
  assert.equal(u.version, 2);
  assert.equal(u.approved_by, author.name);
  const res = store.engine().serve(ask('how long does mail order delivery take'));
  assert.equal(res.parts[0]!.outcome, 'answer');
  assert.match(res.parts[0]!.text!, /5 to 7 business days/);
  assert.equal(store.versions('U-PH-006').length, 2);
  assert.deepEqual(store.log().map((e) => e.action), ['proposed', 'approved', 'published']);
  // The snapshot moved forward: ingesting the same edited document again raises nothing.
  assert.ok(store.ingest(doc('rx_education_script_A.md').replace('7 to 10 business days', '5 to 7 business days')).candidates.every((x) => x.match.status === 'unchanged'));
});

test('gap to unit: a proposed answer is invisible until approved, then answers the question', () => {
  const store = new KnowledgeStore(loadData(root));
  // Gap cluster C01 in analyst/GAP_REPORT.md: specialty (tier 3) copay questions, no approved source.
  const q = ask('specialty drug copay');
  const before = store.engine().serve(q).parts[0]!;
  const d = store.proposeGapUnit({
    title: 'Specialty (tier 3) drug copay', body: 'Specialty and tier 3 drug copays depend on the member plan. Quote only the member-specific amount shown in the pricing tool.',
    knowledge_base: 'KB-PHARM', owner: 'Pharmacy Ops', synonyms: ['specialty drug copay', 'tier 3 copay'], evidence: ['Q06', 'Q07', 'Q08'],
  }, 'agent:gap-analyst');
  assert.match(d.unit.unit_id, /^U-PH-2\d\d$/);
  assert.equal(before.outcome, 'insufficient_evidence');
  assert.equal(store.engine().serve(q).parts[0]!.unit_ids.includes(d.unit.unit_id), false, 'draft never served');
  store.approve(d.draft_id, author);
  const after = store.engine().serve(q).parts[0]!;
  assert.equal(after.outcome, 'answer');
  assert.equal(after.unit_ids[0], d.unit.unit_id);
  assert.equal(before.unit_ids.includes(d.unit.unit_id), false);
  // And it stays scoped: an insurance advocate cannot read pharmacy content.
  assert.equal(store.engine().serve({ ...q, role: 'insurance_advocate' }).parts[0]!.outcome, 'not_authorized');
});

test('suggestions: a rewritten restatement is offered as a merge, a packed line as a split; both are human decisions', () => {
  const store = new KnowledgeStore(loadData(root));
  const r = extract(doc('rx_education_script_A.md'), store.units());
  const idv = r.candidates.find((c) => c.title === 'Verify identity')!;
  assert.equal(idv.match.status, 'new');
  const merge = idv.suggestions.find((s) => s.kind === 'merge');
  assert.ok(merge && merge.kind === 'merge' && merge.unit_id === 'U-PH-002');
  const benefits = r.candidates.find((c) => c.title === 'Explain mail order benefits')!;
  const split = benefits.suggestions.find((s) => s.kind === 'split');
  assert.ok(split && split.kind === 'split' && split.parts.some((p) => p.unit_id === 'U-PH-007'), 'the 90-day clause is recognized as its own unit');
  assert.ok(r.candidates.filter((c) => c.verbatim).every((c) => c.suggestions.length === 0), 'verbatim never gets merge or split suggestions');
  assert.ok(r.candidates.filter((c) => c.type === 'procedure').every((c) => !c.suggestions.some((s) => s.kind === 'split')), 'numbered steps stay together');

  // Merge: no new unit, the source now maps to U-PH-002.
  const d = store.proposeFromCandidate(idv, 'agent:extraction')!;
  assert.throws(() => store.merge(d.draft_id, { name: 'agent:x', role: 'author' }, 'U-PH-002'), WorkflowError);
  store.merge(d.draft_id, author, 'U-PH-002');
  assert.equal(store.units().length, loadData(root).units.length, 'nothing new published');
  assert.equal(store.queue('merged').length, 1);

  // Split: new drafts only for statements no unit covers; the 90-day clause is not duplicated.
  const b = store.proposeFromCandidate({ ...benefits, match: { ...benefits.match, status: 'new', unit_id: null, unit_title: null, drift: null } }, 'agent:extraction')!;
  const parts = store.split(b.draft_id, author);
  assert.equal(parts.length, split.parts.filter((p) => !p.unit_id).length);
  assert.ok(parts.every((p) => !/90-day/.test(p.unit.body)));
  assert.deepEqual(store.log().slice(-1).map((e) => e.action), ['split']);
});

test('access: only a named person can grant or revoke, with a reason; search follows immediately', () => {
  const data = loadData(root);
  const store = new KnowledgeStore(data);
  const q = { query: 'how do I change a member primary care provider', role: 'pharmacy_advocate', channel: 'advocate_view', context: { lob: 'MAPD', state: null } };
  assert.equal(store.engine().serve(q).parts[0]!.outcome, 'not_authorized');
  assert.throws(() => store.setAccess('pharmacy_advocate', 'KB-INS', true, { name: 'agent:assist' }, 'needed'), /cannot change access/);
  assert.throws(() => store.setAccess('pharmacy_advocate', 'KB-INS', true, { name: 'Sam (Access admin)' }, ' '), /reason/);
  store.setAccess('pharmacy_advocate', 'KB-INS', true, { name: 'Sam (Access admin)' }, 'Cross-trained team pilot');
  assert.equal(store.engine().serve(q).parts[0]!.outcome, 'answer');
  assert.ok(!data.roles['pharmacy_advocate']!.knowledge_bases.includes('KB-INS'), 'source data untouched');
  store.setAccess('pharmacy_advocate', 'KB-INS', false, { name: 'Sam (Access admin)' }, 'Pilot ended');
  assert.equal(store.engine().serve(q).parts[0]!.outcome, 'not_authorized');
  assert.deepEqual(store.log().map((e) => e.action), ['access_granted', 'access_revoked']);
});

test('tag suggestions: scope and synonyms are proposed only when the text states them, and the author accepts at approval', () => {
  const data = loadData(root);
  const store = new KnowledgeStore(data);
  // Real source docs state no line of business, state or plan year, so no scope is guessed.
  for (const f of ['rx_education_script_A.md', 'pharmacy_outreach_script_v3.md', 'id_card_replacement_article.md'])
    for (const c of extract(doc(f), store.units(), undefined, undefined, data.lexicon).candidates)
      assert.ok(!c.suggestions.some((s) => s.kind === 'tags' && (s.lob || s.states || s.plan_year)), `${f}: no invented scope`);
  // A fabricated paragraph that does state scope.
  const text = doc('rx_education_script_A.md').replace('7 to 10 business days', '7 to 10 business days for MAPD members in Florida and TX on plan year 2027');
  const c = store.ingest(text).candidates.find((x) => x.match.unit_id === 'U-PH-006')!;
  const tags = c.suggestions.find((s) => s.kind === 'tags');
  assert.ok(tags && tags.kind === 'tags');
  assert.deepEqual(tags.lob, ['MAPD']);
  assert.deepEqual([...tags.states!].sort(), ['FL', 'TX']);
  assert.equal(tags.plan_year, 2027);
  const d = store.proposeFromCandidate(c, 'agent:extraction')!;
  const u = store.approve(d.draft_id, author, { applies_to: { lob: tags.lob!, states: tags.states!, plan_year: tags.plan_year! } });
  assert.deepEqual(u.applies_to.lob, ['MAPD']);
  assert.equal(u.applies_to.plan_year, 2027);
});

test('publication gate: a unit that would newly fail a critical golden case is blocked, and nothing goes live', () => {
  const store = new KnowledgeStore(loadData(root));
  // Golden: a Kentucky-only copay program must decline for a Florida member. A broad "copay help" unit would answer instead.
  const d = store.proposeGapUnit({
    title: 'Copay assistance program', body: 'Members can get help with copays. Ask the pharmacy team for details.',
    knowledge_base: 'KB-PHARM', owner: 'Pharmacy Ops', synonyms: ['copay assistance program', 'copay help', 'copay program'], evidence: ['Q99'],
  }, 'agent:gap-analyst');
  const preview = store.previewRegression(d.draft_id);
  assert.equal(preview.allowed, false);
  assert.ok(preview.blocking.length > 0 && preview.blocking.every((b) => b.severity === 'critical' && b.was !== b.now));
  assert.match(preview.summary, /^Blocked/);
  assert.throws(() => store.approve(d.draft_id, author), PublishBlocked);
  assert.equal(store.queue('pending').length, 1, 'still pending, not approved');
  assert.equal(store.units().some((u) => u.unit_id === d.unit.unit_id), false, 'not live');
  assert.deepEqual(store.log().map((e) => e.action), ['proposed', 'publish_blocked']);
  // The same gate lets an ordinary unit through and says so.
  const ok = store.proposeGapUnit({
    title: 'Specialty (tier 3) drug copay', body: 'Quote only the member-specific amount shown in the pricing tool.',
    knowledge_base: 'KB-PHARM', owner: 'Pharmacy Ops', synonyms: ['specialty drug copay', 'tier 3 copay'], evidence: ['Q06'],
  }, 'agent:gap-analyst');
  assert.equal(store.previewRegression(ok.draft_id).allowed, true);
  store.approve(ok.draft_id, author);
});
