// Scripted MCP demo: an agent connecting to Verity over MCP, no Claude
// Desktop needed. Use it as the fallback if Desktop misbehaves on the day.
//   node mcp/dist/verity-mcp-demo.mjs        (bundled, any Node 18+)
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const bundled = join(here, 'verity-mcp.mjs');
const serverPath = existsSync(bundled) ? bundled : join(here, 'dist', 'verity-mcp.mjs');

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const color: Record<string, string> = {
  answer: '\x1b[32m', needs_clarification: '\x1b[34m', insufficient_evidence: '\x1b[33m', conflict: '\x1b[35m',
  stale: '\x1b[90m', not_authorized: '\x1b[31m', safety_escalation: '\x1b[31m', approved: '\x1b[32m', retired: '\x1b[90m', logged: '\x1b[33m',
};
const tag = (o: string) => `${color[o] ?? ''}[${o}]\x1b[0m`;

async function connect(role: string) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env: { ...process.env, VERITY_ROLE: role, VERITY_PRINCIPAL: 'agent:agent-assist-demo' } as Record<string, string>,
  });
  const client = new Client({ name: 'agent-assist-demo', version: '0.1.0' });
  await client.connect(transport);
  return client;
}
async function call(c: Client, name: string, args: Record<string, unknown>) {
  console.log(dim(`\n  -> ${name}(${JSON.stringify(args)})`));
  const r: any = await c.callTool({ name, arguments: args });
  return JSON.parse(r.content[0].text);
}
function showSearch(r: any) {
  for (const p of r.parts) {
    console.log(`  ${tag(p.outcome)} ${p.message}`);
    if (p.text) console.log(`     "${p.text}"`);
    for (const c of p.citations) {
      console.log(dim(`     cites ${c.unit_id} v${c.version}${c.verbatim ? ' (verbatim, exact)' : ''} · ${c.owner}`));
      if (c.text) console.log(`       "${c.text}"`);
    }
  }
}

console.log(bold('\nVerity over MCP: an agent gets the same rules as a person'));
const pharm = await connect('pharmacy_advocate');
const { tools } = await pharm.listTools();
console.log(dim(`  connected as pharmacy_advocate (role set by the connection, not by the agent)`));
console.log(dim(`  tools: ${tools.map((t) => t.name).join(', ')}`));

console.log(bold('\n1. Agent asks for the Rx pricing disclaimer'));
showSearch(await call(pharm, 'search_knowledge', { query: 'rx pricing disclaimer', channel: 'advocate_view', lob: 'MAPD' }));

console.log(bold('\n2. Agent tries to read an insurance-only unit'));
const denied = await call(pharm, 'get_unit', { unit_id: 'U-IN-002' });
console.log(`  ${tag(denied.status)} "${denied.title}" belongs to ${denied.owner} (${denied.knowledge_base}). No body returned.`);

console.log(bold('\n3. Agent asks something two approved sources disagree on'));
showSearch(await call(pharm, 'search_knowledge', { query: 'how many days supply can i get by mail', channel: 'advocate_view', lob: 'MAPD' }));

console.log(bold('\n4. Agent asks something Verity has no approved answer for'));
showSearch(await call(pharm, 'search_knowledge', { query: 'tier 3 copay for specialty drug', channel: 'advocate_view', lob: 'MAPD' }));
console.log(dim('  gap logged automatically to the author queue'));

console.log(bold('\n5. Agent checks what changed recently'));
const ch = await call(pharm, 'list_changes', { since: '2026-01-01' });
for (const c of ch.changes.slice(0, 4)) console.log(`  ${c.effective_date}  ${c.unit_id}  ${c.title}  ${dim(c.change)}`);

await pharm.close();
console.log(bold('\nSame enforcement layer as the advocate UI. Every call above is in runtime/calls.jsonl, PHI redacted.\n'));
