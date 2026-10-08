// Query agent + gateway plumbing, with a mock model. These prove the safety
// properties hold WHATEVER the model returns. Real accuracy needs a real model:
//   VERITY_ANTHROPIC_KEY=... node evals/run.ts --set data/blind_set.json --model live --label blind-model-01
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Gateway, type Provider, type ModelRequest } from '../src/gateway/gateway.ts';
import { loadData } from '../src/service/service.ts';
import { Verity } from '../src/engine/pipeline.ts';
import type { ServeRequest } from '../src/engine/types.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = loadData(root);
const engine = new Verity(data);
const golden = (await import('../data/golden_set.json', { with: { type: 'json' } })).default.cases;

class MockModel implements Provider {
  name = 'mock';
  seen: ModelRequest[] = [];
  replies: [string, string][];
  constructor(replies: [string, string][]) {
    this.replies = replies;
  }
  async complete(_model: string, req: ModelRequest) {
    this.seen.push(req);
    const q = req.user.split('QUESTION: ')[1] ?? '';
    const hit = this.replies.find(([k]) => q.includes(k));
    return { text: hit ? hit[1] : 'not json at all', inputTokens: 100, outputTokens: 20 };
  }
}
const gwWith = (replies: [string, string][]) => {
  const mock = new MockModel(replies);
  return { mock, gw: new Gateway({ root: mkdtempSync(join(tmpdir(), 'vgw-')), mode: 'live', provider: mock }) };
};
const req = (query: string, role = 'pharmacy_advocate', channel = 'advocate_view', state: string | null = null): ServeRequest =>
  ({ query, role, channel, input_mode: 'typed', context: { lob: 'MAPD', state } });
const J = (o: unknown) => JSON.stringify(o);

test('gateway off: serveAsync is exactly the baseline on every golden case', async () => {
  const gw = new Gateway({ root, mode: 'off', provider: null });
  for (const g of golden) {
    const r = { query: g.query, role: g.role, channel: g.channel, input_mode: g.input_mode, context: g.context };
    const a = engine.serve(r);
    const b = await engine.serveAsync(r, gw);
    assert.equal(b.outcome, a.outcome, g.case_id);
    assert.deepEqual(b.parts.map((p) => p.unit_ids), a.parts.map((p) => p.unit_ids), g.case_id);
  }
});

test('a proposal is only a nomination: eligibility, applicability and authority still decide', async () => {
  const { gw } = gwWith([
    ['before I get into her meds', J({ parts: [{ text: 'what to verify before discussing prescriptions', unit_ids: ['U-PH-002'], restricted_ids: [] }], urgent: false })],
    ['3 month supply', J({ parts: [{ text: 'days supply by mail', unit_ids: ['U-PH-007', 'U-PH-107'], restricted_ids: [] }], urgent: false })],
    ['pay for shipping', J({ parts: [{ text: 'mail order shipping cost', unit_ids: ['U-PH-008'], restricted_ids: [] }], urgent: false })],
    ['copay help', J({ parts: [{ text: 'copay assistance program', unit_ids: ['U-PH-010'], restricted_ids: [] }], urgent: false })],
  ]);
  assert.equal((await engine.serveAsync(req('before I get into her meds what do I have to confirm'), gw)).parts[0].unit_ids[0], 'U-PH-002');
  assert.equal((await engine.serveAsync(req('can I tell her a 3 month supply'), gw)).outcome, 'conflict');
  assert.equal((await engine.serveAsync(req('does she pay for shipping'), gw)).outcome, 'stale');
  assert.equal((await engine.serveAsync(req('is there copay help'), gw)).outcome, 'needs_clarification');
  assert.equal((await engine.serveAsync(req('is there copay help', 'pharmacy_advocate', 'advocate_view', 'FL'), gw)).outcome, 'insufficient_evidence');
});

test('hallucinated and out-of-scope ids are dropped; restricted matches return the owner only', async () => {
  const { gw } = gwWith([
    ['switch her primary doctor', J({ parts: [{ text: 'change PCP', unit_ids: ['U-IN-002', 'U-XX-999'], restricted_ids: [] }], urgent: false })],
    ['script your agents read', J({ parts: [{ text: 'call opening script', unit_ids: [], restricted_ids: ['U-SH-001'] }], urgent: false })],
  ]);
  const r1 = await engine.serveAsync(req('member wants to switch her primary doctor'), gw);
  assert.notEqual(r1.outcome, 'answer', 'an out-of-scope id in unit_ids must never be answered');
  assert.ok(r1.parts.every((p) => !p.unit_ids.includes('U-IN-002')));
  const r2 = await engine.serveAsync(req("what's the script your agents read at the start", 'member_chat', 'member_chat'), gw);
  assert.equal(r2.outcome, 'not_authorized');
  assert.equal(r2.parts[0].text, null);
  assert.ok(r2.parts[0].owner_team);
  assert.ok(r2.record.model_context_unit_ids.every((id) => data.roles.member_chat.knowledge_bases.includes(engine.unit(id)!.knowledge_base)));
});

test('verbatim is inserted by id even when the user asks for a rewrite', async () => {
  const { gw } = gwWith([['more casual', J({ parts: [{ text: 'Rx pricing disclaimer', unit_ids: ['U-PH-003'], restricted_ids: [] }], urgent: false })]]);
  const r = await engine.serveAsync(req('reword the pricing disclaimer so it sounds more casual'), gw);
  assert.equal(r.outcome, 'answer');
  assert.equal(r.parts[0].text, engine.unit('U-PH-003')!.body);
  assert.equal(r.parts[0].verification.verbatim_exact, true);
});

test('urgent flag can add an escalation; it can never remove one', async () => {
  const { gw } = gwWith([
    ['feels really off', J({ parts: [{ text: 'refill', unit_ids: [], restricted_ids: [] }], urgent: true })],
    ['chest pain', J({ parts: [{ text: 'mail order speed', unit_ids: ['U-PH-006'], restricted_ids: [] }], urgent: false })],
  ]);
  assert.equal((await engine.serveAsync(req('he feels really off and is slumped over'), gw)).outcome, 'safety_escalation');
  assert.equal((await engine.serveAsync(req('I have chest pain, rush my pills'), gw)).outcome, 'safety_escalation');
});

test('malformed model output falls back to the baseline', async () => {
  const { gw } = gwWith([]);
  const q = req('rx pricing disclaimer');
  assert.deepEqual((await engine.serveAsync(q, gw)).parts.map((p) => p.unit_ids), engine.serve(q).parts.map((p) => p.unit_ids));
});

test('the model never sees PHI or any unit body', async () => {
  const { gw, mock } = gwWith([]);
  await engine.serveAsync(req('member John Smith DOB 03/04/1950 wants MO setup'), gw);
  const prompt = mock.seen[0].system + mock.seen[0].user;
  for (const phi of ['John Smith', '03/04/1950']) assert.ok(!prompt.includes(phi), phi);
  for (const u of data.units) assert.ok(!prompt.includes(u.body), `body of ${u.unit_id} leaked into the prompt`);
});

test('cache: live writes a reply, cache-only replays it without calling the provider', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vgw-'));
  const mock = new MockModel([['3 month supply', J({ parts: [{ text: 'days supply by mail', unit_ids: ['U-PH-007', 'U-PH-107'], restricted_ids: [] }], urgent: false })]]);
  const live = new Gateway({ root: dir, mode: 'live', provider: mock });
  await engine.serveAsync(req('3 month supply by mail?'), live);
  assert.equal(readdirSync(join(dir, 'cache')).length, 1);
  const replay = new Gateway({ root: dir, mode: 'cache-only', provider: null });
  const r = await engine.serveAsync(req('3 month supply by mail?'), replay);
  assert.equal(r.outcome, 'conflict');
  assert.equal(replay.calls.cache, 1);
  assert.equal(mock.seen.length, 1);
});

test('cache cannot bypass the rules: a cached nomination is re-checked against current status and entitlement', async () => {
  // Round 2 review (Gemini, ChatGPT, Perplexity): could a cached model reply serve stale or revoked content?
  // The cache holds only the query agent's nominations (unit ids), never answer text, and steps 7 to 9 run on every request.
  const cacheRoot = mkdtempSync(join(tmpdir(), 'vcache-'));
  const nominate = J({ parts: [{ text: 'mail order delivery time', unit_ids: ['U-PH-006'], restricted_ids: [] }], urgent: false });
  const live = new Gateway({ root: cacheRoot, mode: 'live', provider: new MockModel([['how fast does mail order ship', nominate]]) });
  const q = req('how fast does mail order ship to her house');
  const first = await engine.serveAsync(q, live);
  assert.equal(first.outcome, 'answer');
  assert.deepEqual(first.parts[0].unit_ids, ['U-PH-006']);

  // Same prompt, so the nomination comes from cache, but the unit is now past its review date: the rules say stale.
  const staleUnits = data.units.map((u) => (u.unit_id === 'U-PH-006' ? { ...u, review_date: '2026-01-01' } : u));
  const cacheOnly = new Gateway({ root: cacheRoot, mode: 'cache-only', provider: null });
  const afterStale = await new Verity({ ...data, units: staleUnits }).serveAsync(q, cacheOnly);
  assert.equal(cacheOnly.calls.cache, 1, 'served from cache');
  assert.equal(afterStale.outcome, 'stale');

  // Access revoked: the pharmacy role loses KB-PHARM. Nothing from the cache can bring the unit back.
  const revoked = { ...data.roles, pharmacy_advocate: { ...data.roles.pharmacy_advocate!, knowledge_bases: ['KB-SHARED'] } };
  const afterRevoke = await new Verity({ ...data, roles: revoked }).serveAsync(q, cacheOnly);
  assert.notEqual(afterRevoke.outcome, 'answer');
  assert.ok(afterRevoke.parts.every((p) => p.text === null || !p.unit_ids.includes('U-PH-006')));
  assert.ok(afterRevoke.record.model_context_unit_ids.every((id) => revoked.pharmacy_advocate.knowledge_bases.includes(engine.unit(id)!.knowledge_base)));
});
