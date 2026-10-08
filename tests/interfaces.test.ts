// Interface tests: the MCP adapter and REST API must enforce exactly what the
// engine enforces. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { VerityService } from '../src/service/service.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const golden = JSON.parse(readFileSync(join(root, 'data/golden_set.json'), 'utf8')).cases;
const runtime = mkdtempSync(join(tmpdir(), 'verity-'));

async function mcpClient(role: string) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    // Test the bundled server: it is what Claude Desktop runs.
    args: [join(root, 'mcp/dist/verity-mcp.mjs')],
    env: { ...process.env, VERITY_ROLE: role, VERITY_PRINCIPAL: 'agent:test', VERITY_RUNTIME_DIR: runtime } as Record<string, string>,
  });
  const client = new Client({ name: 'verity-test', version: '0.0.1' });
  await client.connect(transport);
  return client;
}
const call = async (c: Client, name: string, args: Record<string, unknown>) =>
  JSON.parse(((await c.callTool({ name, arguments: args })) as any).content[0].text);

test('MCP: no tool lets the agent choose its role', async () => {
  const c = await mcpClient('pharmacy_advocate');
  const { tools } = await c.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ['get_unit', 'list_changes', 'report_gap', 'search_knowledge']);
  for (const t of tools) assert.ok(!('role' in ((t.inputSchema as any).properties ?? {})), `${t.name} exposes role`);
  await c.close();
});

test('MCP parity: every golden case returns the same outcome and citations as the engine', async () => {
  const service = new VerityService(root, runtime);
  const roles = [...new Set(golden.map((g: any) => g.role))] as string[];
  let checked = 0;
  for (const role of roles) {
    const c = await mcpClient(role);
    for (const g of golden.filter((x: any) => x.role === role)) {
      const direct = service.engine.serve({ query: g.query, role, channel: g.channel, input_mode: g.input_mode, context: g.context });
      const viaMcp = await call(c, 'search_knowledge', { query: g.query, channel: g.channel, input_mode: g.input_mode, lob: g.context.lob, state: g.context.state });
      assert.equal(viaMcp.outcome, direct.outcome, g.case_id);
      assert.deepEqual(viaMcp.parts.map((p: any) => p.citations.map((x: any) => x.unit_id)), direct.parts.map((p) => p.unit_ids), g.case_id);
      checked++;
    }
    await c.close();
  }
  assert.equal(checked, golden.length);
});

test('MCP get_unit: restricted, retired and verbatim cases', async () => {
  const c = await mcpClient('pharmacy_advocate');
  const restricted = await call(c, 'get_unit', { unit_id: 'U-IN-002' });
  assert.equal(restricted.status, 'not_authorized');
  assert.equal(restricted.body, undefined, 'restricted body must never be returned');
  assert.equal(restricted.owner !== undefined, true);
  const retired = await call(c, 'get_unit', { unit_id: 'U-SH-000' });
  assert.equal(retired.status, 'retired');
  assert.equal(retired.superseded_by, 'U-SH-002');
  assert.equal(retired.body, undefined);
  const verbatim = await call(c, 'get_unit', { unit_id: 'U-PH-003' });
  const seed = JSON.parse(readFileSync(join(root, 'data/units_seed.json'), 'utf8'));
  const u = (Array.isArray(seed) ? seed : seed.units).find((x: any) => x.unit_id === 'U-PH-003');
  assert.equal(verbatim.body, u.body);
  await c.close();
});

test('MCP report_gap and the call log never hold PHI', async () => {
  const c = await mcpClient('pharmacy_advocate');
  const gap = await call(c, 'report_gap', { query: 'member John Smith DOB 03/04/1950 asks about tier 3 copay' });
  assert.ok(!gap.query_redacted.includes('John Smith'));
  assert.ok(!gap.query_redacted.includes('03/04/1950'));
  await call(c, 'search_knowledge', { query: 'member Jane Doe DOB 01/02/1945 wants MO setup', channel: 'advocate_view' });
  await c.close();
  for (const f of ['calls.jsonl', 'gaps.jsonl']) {
    const log = readFileSync(join(runtime, f), 'utf8');
    for (const phi of ['John Smith', 'Jane Doe', '03/04/1950', '01/02/1945']) assert.ok(!log.includes(phi), `${phi} found in ${f}`);
  }
});

test('REST: identity required, same enforcement as MCP', async () => {
  process.env.VERITY_RUNTIME_DIR = runtime;
  const { server } = await import('../rest/server.ts');
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as any).port;
  const post = (path: string, body: unknown, role?: string) =>
    fetch(`http://localhost:${port}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(role ? { 'X-Verity-Role': role } : {}) }, body: JSON.stringify(body) });

  assert.equal((await post('/v1/search', { query: 'rx pricing disclaimer', channel: 'advocate_view' })).status, 401);
  const ok = await (await post('/v1/search', { query: 'rx pricing disclaimer', channel: 'advocate_view', lob: 'MAPD' }, 'pharmacy_advocate')).json();
  assert.equal(ok.outcome, 'answer');
  assert.equal(ok.parts[0].citations[0].unit_id, 'U-PH-003');
  const denied = await (await post('/v1/search', { query: 'rx pricing disclaimer', channel: 'advocate_view', lob: 'MAPD' }, 'insurance_advocate')).json();
  assert.equal(denied.outcome, 'not_authorized');
  assert.equal(denied.parts[0].text, null);
  const calls = await (await fetch(`http://localhost:${port}/v1/calls`, { headers: { 'X-Verity-Role': 'pharmacy_advocate' } })).json();
  assert.ok(calls.some((x: any) => x.interface === 'rest') && calls.some((x: any) => x.interface === 'mcp'));
  server.close();
});

test('hybrid plumbing: vectors only re-rank entitled units; stale or missing vectors fall back to keyword', async () => {
  const { loadData: ld } = await import('../src/service/service.ts');
  const { Verity: V } = await import('../src/engine/pipeline.ts');
  const { unitVectorHash } = await import('../src/engine/retrieval.ts');
  const { prepare } = await import('../src/engine/text.ts');
  const base = ld(new URL('..', import.meta.url).pathname);
  const req = { query: 'rx pricing disclaimer', role: 'pharmacy_advocate', channel: 'advocate_view', context: { lob: 'MAPD', state: null } } as const;
  const plain = new V(base).serve({ ...req }).parts[0]!;
  // Fake vectors: every unit orthogonal to the query except a restricted insurance unit that matches it perfectly.
  const key = prepare(req.query, base.lexicon).text;
  const restricted = base.units.find((u) => u.knowledge_base === 'KB-INS')!;
  const units = Object.fromEntries(base.units.map((u) => [u.unit_id, { hash: unitVectorHash(u), vec: u.unit_id === restricted.unit_id ? [1, 0] : [0, 1] }]));
  const hybrid = new V({ ...base, vectors: { model: 'fake', units, queries: { [key]: [1, 0] } } }).serve({ ...req }).parts[0]!;
  assert.equal(hybrid.outcome, plain.outcome, 'a perfect vector match outside the role cannot change the outcome');
  assert.ok(!hybrid.unit_ids.includes(restricted.unit_id), 'out-of-scope unit never returned');
  // Stale hash: vectors ignored, same result as keyword.
  const stale = Object.fromEntries(Object.entries(units).map(([k, v]) => [k, { ...v, hash: 'stale' }]));
  const s = new V({ ...base, vectors: { model: 'fake', units: stale, queries: { [key]: [1, 0] } } }).serve({ ...req }).parts[0]!;
  assert.deepEqual(s.unit_ids, plain.unit_ids);
});

test('stale and conflict outcomes open owner review items; repeats bump the count, claims are recorded', () => {
  const service = new VerityService(root, mkdtempSync(join(tmpdir(), 'verity-')));
  const id = { principal: 'agent:test', role: 'pharmacy_advocate' };
  const ask = (q: string) => service.search(id as never, 'test', { query: q, channel: 'advocate_view', lob: 'MAPD', state: null } as never);
  assert.equal(ask('is there a shipping fee for mail order').outcome, 'stale');
  assert.equal(ask('how many days supply can i get by mail').outcome, 'conflict');
  ask('is there a shipping fee for mail order');
  const items = service.ownerQueue.list();
  assert.equal(items.length, 2);
  const stale = items.find((i) => i.kind === 'stale')!;
  assert.deepEqual(stale.unit_ids, ['U-PH-008']);
  assert.equal(stale.asks, 2);
  assert.equal(items.find((i) => i.kind === 'conflict')!.unit_ids.sort().join(), 'U-PH-007,U-PH-107');
  assert.equal(service.ownerQueue.claim(stale.item_id, 'Dana')!.status, 'claimed');
});

test('gap clusters carry age and a suggested owner; the first claim holds', async () => {
  const { OwnerQueue } = await import('../src/engine/ownerQueue.ts');
  const report = JSON.parse(readFileSync(join(root, 'analyst/gap_report.json'), 'utf8'));
  assert.ok(report.clusters.every((c: any) => typeof c.suggested_owner === 'string' && c.age_days !== null));
  const q = new OwnerQueue();
  assert.equal(q.claimGap('C01', 'Dana', '2026-10-06').by, 'Dana');
  assert.equal(q.claimGap('C01', 'Lee', '2026-10-06').by, 'Dana');
});
