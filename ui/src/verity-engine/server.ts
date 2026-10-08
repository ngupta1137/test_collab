// Server-only entry: runs the Verity engine and maps its result to the UI
// contract in src/services/verity.ts (same shape as POST /v1/search in the
// verity repo). Imported only from server functions, so unit bodies, roles
// and rules never ship to the browser.
import { OwnerQueue } from "./ownerQueue.ts";
import unitsRaw from './data/units_seed.json';
import rolesRaw from './data/roles.json';
import lexiconRaw from './data/lexicon.json';
import sourceDocs from './data/source_docs.json';
import goldenRaw from './data/golden_set.json';
import { KnowledgeStore } from './workflow.ts';
import type { SearchRequest, SearchResponse } from '../services/verity.ts';

export const AS_OF = '2026-10-06'; // same as-of date as the golden set

// One in-memory knowledge store per server process: search and authoring share
// it, so a unit approved on the Author page is served on the next Ask query.
// Restarting the server resets the demo to the seed data.
let store: KnowledgeStore | null = null;
export function getStore(): KnowledgeStore {
  if (!store) {
    const raw = unitsRaw as unknown as { units?: unknown[] } | unknown[];
    const units = (Array.isArray(raw) ? raw : raw.units ?? []) as never;
    store = new KnowledgeStore(
      {
        units,
        roles: (rolesRaw as unknown as { roles: never }).roles,
        lexicon: (lexiconRaw as unknown as { entries: never }).entries,
        asOf: AS_OF,
        golden: (goldenRaw as unknown as { cases: never }).cases, // the publication gate runs these on every approval
      },
      Object.values(sourceDocs as Record<string, string>),
    );
  }
  return store;
}

export function resetStore(): void {
  store = null;
  ownerQueue = new OwnerQueue();
  sessionLog.length = 0;
  callLog.length = 0;
}

// Every call through either interface in this server session, newest last.
// Queries are logged after PHI redaction.
export interface CallEntry { at: string; iface: 'REST' | 'MCP'; principal: string; role: string; tool: string; outcome: string }
export const callLog: CallEntry[] = [];
export function logCall(e: Omit<CallEntry, 'at'>): void {
  callLog.push({ at: new Date().toISOString(), ...e });
  if (callLog.length > 500) callLog.shift();
}

// Searches made in this server session, PHI already redacted by the engine.
// Feeds the search insights view; reset with the demo.
export interface SessionSearch { at: string; role: string; channel: string; query: string; outcomes: string[] }
export let ownerQueue = new OwnerQueue();
export const sessionLog: SessionSearch[] = [];

const ROLES = new Set(['pharmacy_advocate', 'insurance_advocate', 'member_chat']);

// What the person does next when Verity cannot give an approved answer.
// "I don't know" on a live call needs a recovery path, not just a refusal.
export function nextStep(outcome: string, role: string, owner: string | null): string | null {
  const member = role === 'member_chat';
  switch (outcome) {
    case 'insufficient_evidence':
      return member
        ? 'Offer to connect the member with an advocate or schedule a call-back. Do not answer from general knowledge. The question is logged for the knowledge team.'
        : 'Do not answer from memory. Tell the member you will confirm, then ask your supervisor or warm-transfer to the help desk. The gap is logged for an author.';
    case 'conflict':
      return member
        ? 'Do not state either version as current. Offer to connect the member with an advocate.'
        : `Do not state either version as current. Tell the member you will confirm. Both owners${owner ? ` (${owner})` : ''} are notified to resolve it.`;
    case 'stale':
      return `Do not quote it as current. Confirm with the owner${owner ? ` (${owner})` : ''} or transfer.`;
    case 'not_authorized':
      return member ? 'Connect the member with an advocate who can help.' : `Warm-transfer to ${owner ?? 'the owning team'}, or ask them to answer.`;
    case 'needs_clarification':
      return member ? null : 'Ask the member the question above, then search again.';
    default:
      return null;
  }
}

export function serveEngine(req: SearchRequest, via: { iface: 'REST' | 'MCP'; principal: string } = { iface: 'REST', principal: 'ui:ask-page' }): SearchResponse {
  if (!ROLES.has(req.role)) throw new Error(`unknown role ${req.role}`);
  const e = getStore().engine();
  const r = e.serve({
    query: String(req.query ?? '').slice(0, 1000),
    role: req.role,
    channel: req.channel,
    input_mode: req.input_mode ?? 'typed',
    context: { lob: req.lob ?? null, state: req.state ?? null },
  });
  for (const p of r.parts) {
    if (p.outcome !== "stale" && p.outcome !== "conflict") continue;
    const owner = p.owner_team ?? (p.unit_ids[0] ? e.unit(p.unit_ids[0])?.owner : null) ?? "Knowledge Ops";
    ownerQueue.open(p.outcome, p.unit_ids, owner, r.record.query_redacted, AS_OF);
  }
  sessionLog.push({ at: new Date().toISOString(), role: req.role, channel: req.channel, query: r.record.query_redacted, outcomes: r.parts.map((p) => p.outcome) });
  if (sessionLog.length > 500) sessionLog.shift();
  logCall({ iface: via.iface, principal: via.principal, role: req.role, tool: `${via.iface === 'MCP' ? 'search_knowledge' : 'search'} "${r.record.query_redacted.slice(0, 80)}"`, outcome: r.parts.map((p) => p.outcome).join(', ') });
  return {
    request_id: r.record.request_id,
    outcome: r.outcome,
    parts: r.parts.map((p) => ({
      part: p.part,
      outcome: p.outcome,
      message: p.message,
      text: p.text,
      owner_team: p.owner_team ?? null,
      next_step: nextStep(p.outcome, req.role, p.owner_team ?? (p.outcome === 'stale' && p.unit_ids[0] ? e.unit(p.unit_ids[0])?.owner ?? null : null)),
      citations: p.unit_ids.map((id) => {
        const u = e.unit(id)!;
        return {
          unit_id: u.unit_id, version: u.version, title: u.title, owner: u.owner,
          effective_date: u.effective_date, verbatim: u.verbatim,
          ...(p.outcome === 'conflict' ? { text: u.body } : {}),
        };
      }),
    })),
    trace: r.trace.map((t) => `${t.step}. ${t.name} [${t.kind}]: ${t.detail}`),
    engine: r.record.engine,
  };
}
