// Verity MCP adapter (stdio). A thin layer over VerityService: same
// entitlement filter, redaction, outcomes and logs as the REST API.
//
// Identity comes from the connection, not from tool arguments:
//   VERITY_ROLE=pharmacy_advocate VERITY_PRINCIPAL=agent:agent-assist node mcp/server.ts
// In production this is the agent's OAuth identity, resolved by the gateway.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { VerityService, type Identity } from '../src/service/service.ts';
import { findRoot } from '../src/service/root.ts';

const root = findRoot(import.meta.url);
const service = new VerityService(root, process.env.VERITY_RUNTIME_DIR || undefined);
const identity: Identity = {
  role: process.env.VERITY_ROLE ?? 'pharmacy_advocate',
  principal: process.env.VERITY_PRINCIPAL ?? 'agent:unknown',
};

// Fail loudly at startup (stderr only; stdout belongs to the MCP protocol).
try {
  service.checkIdentity(identity);
} catch (e) {
  console.error(`Verity MCP: ${(e as Error).message}. Valid roles: pharmacy_advocate, insurance_advocate, member_chat.`);
  process.exit(1);
}

const server = new McpServer({ name: 'verity', version: '0.1.0' });
const json = (x: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(x, null, 2) }] });
const safe = <A,>(fn: (a: A) => unknown) => async (a: A) => {
  try {
    return json(await fn(a));
  } catch (e) {
    return { isError: true, content: [{ type: 'text' as const, text: `Verity error: ${(e as Error).message}` }] };
  }
};

server.registerTool(
  'search_knowledge',
  {
    title: 'Search approved knowledge',
    description:
      'Search Verity for approved, current, applicable knowledge. Returns one outcome per question part: ' +
      'answer | needs_clarification | insufficient_evidence | conflict | stale | not_authorized | safety_escalation. ' +
      'Rules for the calling agent: if a citation has verbatim=true, use the returned text EXACTLY, never paraphrase it. ' +
      'Do not answer from your own knowledge when the outcome is not "answer". ' +
      'For needs_clarification, ask the user the returned question. For conflict or stale, do not state either version as current.',
    inputSchema: {
      query: z.string().describe('The question, as asked. PHI is redacted before processing.'),
      channel: z.enum(['advocate_view', 'member_chat', 'voice']).describe('Where the answer will be delivered'),
      input_mode: z.enum(['typed', 'voice']).optional().describe('How the question arrived'),
      lob: z.string().nullable().optional().describe('Line of business, e.g. MAPD or PDP'),
      state: z.string().nullable().optional().describe('Two-letter state of the member plan, if known'),
    },
  },
  safe((args: any) => service.searchAsync(identity, 'mcp', args)),
);

server.registerTool(
  'get_unit',
  {
    title: 'Get one knowledge unit',
    description:
      'Fetch an approved knowledge unit by id (for example to insert verbatim text by reference). ' +
      'Units outside your entitlement return not_authorized with the owning team only. Retired units are never served.',
    inputSchema: {
      unit_id: z.string(),
      version: z.number().int().optional().describe('Pin a version; omit for current'),
    },
  },
  safe(({ unit_id, version }: any) => service.getUnit(identity, 'mcp', unit_id, version)),
);

server.registerTool(
  'report_gap',
  {
    title: 'Report a knowledge gap',
    description:
      'Log a question Verity could not answer, for the knowledge team. Goes to an author queue; nothing is published automatically.',
    inputSchema: {
      query: z.string(),
      context: z.record(z.string(), z.unknown()).optional(),
    },
  },
  safe(({ query, context }: any) => service.reportGap(identity, 'mcp', query, context ?? {})),
);

server.registerTool(
  'list_changes',
  {
    title: 'List knowledge changes',
    description: 'Units within your entitlement that became effective, were replaced or were retired on or after a date (YYYY-MM-DD).',
    inputSchema: { since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) },
  },
  safe(({ since }: any) => service.listChanges(identity, 'mcp', since)),
);

await server.connect(new StdioServerTransport());
