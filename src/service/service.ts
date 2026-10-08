// One policy-enforcement layer for every interface (FOUNDATIONS section 12).
// The REST API (channels) and the MCP adapter (agents) both call this class,
// so neither can skip entitlement, redaction, or the outcome rules.
//
// Identity is bound to the connection, never passed as a tool argument:
// an agent cannot ask for a different role than the one it was issued.

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Verity } from '../engine/pipeline.ts';
import { redact } from '../engine/guards.ts';
import type { KnowledgeUnit, Role, ServeRequest, ServeResponse } from '../engine/types.ts';
import { Gateway } from '../gateway/gateway.ts';

export interface Identity {
  principal: string; // who is calling, e.g. "agent:agent-assist" or "user:priya"
  role: string; // resolved from the identity provider; Verity only consumes it
}

export interface SearchArgs {
  query: string;
  channel: string;
  input_mode?: 'typed' | 'voice';
  lob?: string | null;
  state?: string | null;
}

export function loadData(root: string) {
  const load = (p: string) => JSON.parse(readFileSync(join(root, p), 'utf8'));
  const unitsRaw = load('data/units_seed.json');
  return {
    units: (Array.isArray(unitsRaw) ? unitsRaw : unitsRaw.units) as KnowledgeUnit[],
    roles: load('data/roles.json').roles as Record<string, Role>,
    lexicon: load('data/lexicon.json').entries as Record<string, string>,
    asOf: load('data/golden_set.json').as_of_date_for_staleness as string,
  };
}

export class VerityService {
  readonly engine: Verity;
  readonly gateway: Gateway; // VERITY_MODEL_MODE=off (default) | live | cache-only
  private data: ReturnType<typeof loadData>;
  private runtimeDir: string;

  constructor(root: string, runtimeDir = join(root, 'runtime')) {
    this.data = loadData(root);
    this.engine = new Verity(this.data);
    this.gateway = new Gateway({ root });
    this.runtimeDir = runtimeDir;
    mkdirSync(runtimeDir, { recursive: true });
  }

  /** Throws if the identity's role is unknown. Used at server startup. */
  checkIdentity(id: Identity): void {
    this.role(id);
  }

  private role(id: Identity): Role {
    const r = this.data.roles[id.role];
    if (!r) throw new Error(`unknown role "${id.role}"`);
    return r;
  }

  private log(file: string, entry: Record<string, unknown>) {
    appendFileSync(join(this.runtimeDir, file), JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
  }

  /** Visible call log: every interface call, with PHI already redacted. */
  callLog(limit = 50): Record<string, unknown>[] {
    try {
      const lines = readFileSync(join(this.runtimeDir, 'calls.jsonl'), 'utf8').trim().split('\n');
      return lines.slice(-limit).map((l) => JSON.parse(l));
    } catch {
      return [];
    }
  }

  private toRequest(id: Identity, args: SearchArgs): ServeRequest {
    return {
      query: args.query,
      role: id.role,
      channel: args.channel,
      input_mode: args.input_mode ?? 'typed',
      context: { lob: args.lob ?? null, state: args.state ?? null },
    };
  }

  /** Baseline only (synchronous). */
  search(id: Identity, iface: string, args: SearchArgs) {
    this.role(id);
    return this.finish(id, iface, args, this.engine.serve(this.toRequest(id, args)));
  }

  /** Uses the query agent when the gateway is on; identical to search() when it is off. */
  async searchAsync(id: Identity, iface: string, args: SearchArgs) {
    this.role(id);
    return this.finish(id, iface, args, await this.engine.serveAsync(this.toRequest(id, args), this.gateway));
  }

  private finish(id: Identity, iface: string, args: SearchArgs, r: ServeResponse) {
    const out = {
      request_id: r.record.request_id,
      outcome: r.outcome,
      parts: r.parts.map((p) => ({
        part: p.part,
        outcome: p.outcome,
        message: p.message,
        text: p.text,
        owner_team: p.owner_team ?? null,
        citations: p.unit_ids.map((uid) => {
          const u = this.engine.unit(uid)!;
          return {
            unit_id: u.unit_id, version: u.version, title: u.title, owner: u.owner, effective_date: u.effective_date, verbatim: u.verbatim,
            // For a conflict, show both approved texts side by side (both are in scope); never pick one.
            ...(p.outcome === 'conflict' ? { text: u.body } : {}),
          };
        }),
      })),
      trace: r.trace.map((t) => `${t.step}. ${t.name} [${t.kind}]: ${t.detail}`),
      engine: r.record.engine,
    };
    if (r.gap_logged) this.reportGap(id, 'auto', args.query, { lob: args.lob ?? null, state: args.state ?? null, channel: args.channel }, r.record.request_id);
    this.log('calls.jsonl', {
      interface: iface, principal: id.principal, role: id.role, tool: 'search_knowledge',
      args: { ...args, query: r.record.query_redacted }, outcome: r.outcome, request_id: r.record.request_id,
    });
    return out;
  }

  getUnit(id: Identity, iface: string, unitId: string, version?: number) {
    const role = this.role(id);
    const u = this.engine.unit(unitId);
    let result: Record<string, unknown>;
    if (!u) result = { status: 'not_found', unit_id: unitId };
    else if (!role.knowledge_bases.includes(u.knowledge_base))
      // Routing-index fields only: title and owner, never the body.
      result = { status: 'not_authorized', unit_id: u.unit_id, title: u.title, owner: u.owner, knowledge_base: u.knowledge_base };
    else if (u.status === 'retired') {
      const next = this.data.units.find((x) => x.supersedes === u.unit_id);
      result = { status: 'retired', unit_id: u.unit_id, superseded_by: next?.unit_id ?? null, note: 'Retired units are never served.' };
    } else if (u.status !== 'approved') result = { status: u.status, unit_id: u.unit_id, note: 'Not approved; not servable.' };
    else if (version !== undefined && version !== u.version)
      result = { status: 'version_unavailable', unit_id: u.unit_id, current_version: u.version };
    else
      result = {
        status: u.review_date < this.data.asOf ? 'stale' : 'approved',
        unit_id: u.unit_id, version: u.version, title: u.title, type: u.type, verbatim: u.verbatim,
        body: u.body, spoken_version: u.spoken_version, owner: u.owner, approved_by: u.approved_by,
        effective_date: u.effective_date, review_date: u.review_date, applies_to: u.applies_to,
        channels: u.channels, source: `${u.source_doc} ${u.source_section}`,
      };
    this.log('calls.jsonl', { interface: iface, principal: id.principal, role: id.role, tool: 'get_unit', args: { unit_id: unitId, version }, outcome: result.status });
    return result;
  }

  reportGap(id: Identity, iface: string, query: string, context: Record<string, unknown> = {}, requestId?: string) {
    this.role(id);
    const red = redact(query);
    const gap = { gap_id: `gap-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, query_redacted: red.text, role: id.role, principal: id.principal, context, request_id: requestId ?? null, source: iface };
    this.log('gaps.jsonl', gap);
    if (iface !== 'auto') this.log('calls.jsonl', { interface: iface, principal: id.principal, role: id.role, tool: 'report_gap', args: { query: red.text }, outcome: 'logged', gap_id: gap.gap_id });
    return { status: 'logged', gap_id: gap.gap_id, query_redacted: red.text, next: 'Author queue (Knowledge Ops). Nothing is published without approval.' };
  }

  listChanges(id: Identity, iface: string, since: string) {
    const role = this.role(id);
    const changes = this.data.units
      .filter((u) => role.knowledge_bases.includes(u.knowledge_base))
      .filter((u) => u.effective_date >= since || (u.status === 'retired' && u.review_date >= since))
      .map((u) => ({
        unit_id: u.unit_id, title: u.title, version: u.version, status: u.status,
        effective_date: u.effective_date, supersedes: u.supersedes, verbatim: u.verbatim,
        change: u.status === 'retired' ? 'retired' : u.supersedes ? 'replaces ' + u.supersedes : 'new or updated',
      }))
      .sort((a, b) => b.effective_date.localeCompare(a.effective_date));
    this.log('calls.jsonl', { interface: iface, principal: id.principal, role: id.role, tool: 'list_changes', args: { since }, outcome: `${changes.length} changes` });
    return { since, count: changes.length, changes };
  }
}
