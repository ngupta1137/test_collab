// Authoring workflow: the approval gate between "proposed" and "published"
// (FOUNDATIONS sections 9 and 10, CLAUDE.md rules).
//
// Rules enforced here, deterministically:
// - Nothing is published without a named human approval. Principals that are
//   agents or models ("agent:...", "model:...") can propose but never decide.
// - Verbatim or legal-authority units route to Legal and only Legal can
//   approve them. Everything else routes to an author (Legal may also approve).
// - Only Legal may edit verbatim wording while approving.
// - Publishing a revision keeps the same unit_id and bumps the version; the
//   previous version is kept in history. A new unit gets a new id.
// - Every proposal and decision is written to an audit log.
// The engine that serves search is rebuilt from the published units after
// each decision, so a published change is live on the next query.

import type { KnowledgeUnit } from './types.ts';
import { Verity, type EngineData } from './pipeline.ts';
import { wordDiff } from './drift.ts';
import { checkPublication, type RegressionReport } from './regression.ts';
import { extract, type CandidateUnit, type ExtractionResult, type Suggestion } from './extract.ts';

export type DraftKind = 'new_unit' | 'revision' | 'gap_proposal';
export type DraftStatus = 'pending' | 'approved' | 'rejected' | 'merged' | 'split';
export type ApproverRole = 'legal' | 'author';

export interface Draft {
  draft_id: string;
  kind: DraftKind;
  status: DraftStatus;
  unit: KnowledgeUnit; // the proposed unit (status "in_review" until approved)
  replaces: string | null; // unit_id this revision would replace
  previous_body: string | null;
  diff: string[];
  route_to: 'Legal' | 'Author';
  reason: string;
  evidence: string[];
  proposed_by: string;
  proposed_at: string;
  decided_by?: string;
  decided_role?: ApproverRole;
  decided_at?: string;
  comment?: string;
  published_version?: number;
  suggestions: Suggestion[];
  merged_into?: string;
  split_into?: string[];
}

export interface AuditEntry {
  at: string;
  actor: string;
  action: 'proposed' | 'approved' | 'rejected' | 'published' | 'publish_blocked' | 'merged' | 'split' | 'access_granted' | 'access_revoked';
  draft_id: string;
  unit_id: string;
  detail: string;
}

export interface Approver {
  name: string; // a person, e.g. "Rita (Legal)"
  role: ApproverRole;
}

const PREFIX: Record<string, string> = { 'KB-PHARM': 'U-PH', 'KB-SHARED': 'U-SH', 'KB-INS': 'U-IN' };

export class WorkflowError extends Error {}
/** Approval refused because publishing would newly fail critical golden cases. */
export class PublishBlocked extends WorkflowError {
  report: RegressionReport;
  constructor(report: RegressionReport) {
    super(report.summary);
    this.report = report;
  }
}

export class KnowledgeStore {
  private data: EngineData;
  private live: KnowledgeUnit[];
  private history: KnowledgeUnit[] = [];
  private drafts: Draft[] = [];
  private audit: AuditEntry[] = [];
  private engineCache: Verity;
  private seq = 0;
  // What each source document said the last time it was ingested, section by
  // section, with the unit each section feeds. Drift = the source changed.
  private snapshots = new Map<string, CandidateUnit[]>();

  constructor(data: EngineData, sourceDocs: string[] = []) {
    // Own copy of roles so access changes never touch the caller's data.
    data = { ...data, roles: Object.fromEntries(Object.entries(data.roles).map(([k, r]) => [k, { ...r, knowledge_bases: [...r.knowledge_bases] }])) };
    this.data = data;
    this.live = data.units.map((u) => ({ ...u }));
    this.engineCache = new Verity({ ...data, units: this.live });
    for (const text of sourceDocs) {
      const r = extract(text, this.live, undefined, undefined, this.data.lexicon);
      this.snapshots.set(r.doc_id, r.candidates);
    }
  }

  /** Ingest a source document: extract candidates and compare with the last snapshot and the approved units. Publishes nothing. */
  ingest(text: string): ExtractionResult {
    const docId = text.match(/Doc ID:\s*([^|\n]+)/i)?.[1]?.trim();
    return extract(text, this.live, docId ? this.snapshots.get(docId) : undefined, undefined, this.data.lexicon);
  }

  /** Candidate behind a pending revision, so approving it moves the snapshot forward. */
  private pendingSources = new Map<string, CandidateUnit>();

  engine(): Verity {
    return this.engineCache;
  }

  units(): KnowledgeUnit[] {
    return this.live;
  }

  versions(unitId: string): KnowledgeUnit[] {
    return [...this.history.filter((u) => u.unit_id === unitId), ...this.live.filter((u) => u.unit_id === unitId)];
  }

  queue(status?: DraftStatus): Draft[] {
    return status ? this.drafts.filter((d) => d.status === status) : [...this.drafts];
  }

  log(): AuditEntry[] {
    return [...this.audit];
  }

  private now(): string {
    return this.data.asOf;
  }

  private nextId(kb: string): string {
    const prefix = PREFIX[kb] ?? 'U-XX';
    const used = this.live.concat(this.history).concat(this.drafts.map((d) => d.unit))
      .filter((u) => u.unit_id.startsWith(prefix))
      .map((u) => Number(u.unit_id.slice(prefix.length + 1)) || 0);
    return `${prefix}-${String(Math.max(200, ...used) + 1).padStart(3, '0')}`;
  }

  private record(actor: string, action: AuditEntry['action'], d: Draft, detail: string) {
    this.audit.push({ at: this.now(), actor, action, draft_id: d.draft_id, unit_id: d.unit.unit_id, detail });
  }

  /** Propose a unit from an extraction candidate. Unchanged candidates are not queued. */
  proposeFromCandidate(c: CandidateUnit, proposedBy: string): Draft | null {
    if (c.match.status === 'unchanged') return null;
    const remember = (d: Draft) => { this.pendingSources.set(d.draft_id, c); return d; };
    const base = c.match.status === 'changed' && c.match.unit_id ? this.live.find((u) => u.unit_id === c.match.unit_id) : undefined;
    const unit: KnowledgeUnit = base
      ? { ...base, body: c.body, status: 'in_review', approved_by: '', source_doc: c.source_doc, source_section: c.source_section }
      : {
          unit_id: this.nextId(c.knowledge_base),
          title: c.title,
          type: c.type,
          body: c.body,
          verbatim: c.verbatim,
          spoken_version: null,
          knowledge_base: c.knowledge_base,
          audience: ['advocate'],
          channels: c.verbatim ? ['advocate_view', 'voice'] : ['advocate_view', 'member_chat', 'voice'],
          authority_level: c.verbatim ? 'legal_approved' : 'knowledge_article',
          source_doc: c.source_doc,
          source_section: c.source_section,
          effective_date: c.effective_date,
          review_date: c.review_date,
          version: 0,
          status: 'in_review',
          supersedes: null,
          synonyms: c.suggested_synonyms,
          owner: c.owner,
          approved_by: '',
          applies_to: { lob: ['MAPD', 'PDP'], states: 'ALL', plan_year: 2026 },
        };
    const reason = base
      ? `Source ${c.source_doc} ${c.source_section} differs from approved ${base.unit_id} v${base.version} (${c.match.drift?.impact.replace(/_/g, ' ') ?? 'changed'}). Proposed fix: publish the new wording as v${base.version + 1}, or reject and ask the source owner to correct the document.`
      : `New content in ${c.source_doc} ${c.source_section}; no approved unit covers it.`;
    return remember(this.propose({
      kind: base ? 'revision' : 'new_unit',
      unit,
      replaces: base?.unit_id ?? null,
      previous_body: base?.body ?? null,
      reason,
      evidence: [`${c.source_doc} ${c.source_section}`, `extractor ${c.extractor}`],
      proposedBy,
      suggestions: c.suggestions ?? [],
    }));
  }

  /** The unit as it would be published, and the live set afterwards. Nothing is changed. */
  private plan(d: Draft, approvedBy: string, edits?: { body?: string; title?: string; applies_to?: Partial<KnowledgeUnit['applies_to']>; synonyms?: string[] }) {
    const prev = d.replaces ? this.live.find((u) => u.unit_id === d.replaces) : undefined;
    const published: KnowledgeUnit = {
      ...d.unit,
      body: edits?.body ?? d.unit.body,
      title: edits?.title ?? d.unit.title,
      applies_to: { ...d.unit.applies_to, ...(edits?.applies_to ?? {}) },
      synonyms: edits?.synonyms ?? d.unit.synonyms,
      status: 'approved',
      version: prev ? prev.version + 1 : 1,
      effective_date: this.now(),
      approved_by: approvedBy,
    };
    const after = prev ? this.live.map((u) => (u.unit_id === prev.unit_id ? published : u)) : [...this.live, published];
    return { prev, published, after };
  }

  private regression(_prev: KnowledgeUnit | undefined, _published: KnowledgeUnit, after: KnowledgeUnit[]): RegressionReport {
    return checkPublication(this.data, this.live, after, this.data.golden ?? []);
  }

  /** What the golden set says about publishing this draft, for the review card. Changes nothing. */
  previewRegression(draftId: string, edits?: { body?: string; title?: string; applies_to?: Partial<KnowledgeUnit['applies_to']>; synonyms?: string[] }): RegressionReport {
    const d = this.drafts.find((x) => x.draft_id === draftId);
    if (!d) throw new WorkflowError(`unknown draft ${draftId}`);
    const { prev, published, after } = this.plan(d, 'preview', edits);
    return this.regression(prev, published, after);
  }

  /** Turn a gap-analyst cluster into a draft. The body is whatever a human or the analyst supplied. */
  proposeGapUnit(input: { title: string; body: string; knowledge_base: string; owner: string; synonyms: string[]; evidence: string[] }, proposedBy: string): Draft {
    const unit: KnowledgeUnit = {
      unit_id: this.nextId(input.knowledge_base),
      title: input.title,
      type: 'fact',
      body: input.body,
      verbatim: false,
      spoken_version: null,
      knowledge_base: input.knowledge_base,
      audience: ['advocate'],
      channels: ['advocate_view', 'member_chat', 'voice'],
      authority_level: 'knowledge_article',
      source_doc: 'gap-analyst',
      source_section: input.evidence.join(', '),
      effective_date: this.now(),
      review_date: `${Number(this.now().slice(0, 4)) + 1}${this.now().slice(4)}`,
      version: 0,
      status: 'in_review',
      supersedes: null,
      synonyms: input.synonyms,
      owner: input.owner,
      approved_by: '',
      applies_to: { lob: ['MAPD', 'PDP'], states: 'ALL', plan_year: 2026 },
    };
    return this.propose({ kind: 'gap_proposal', unit, replaces: null, previous_body: null, reason: `Unanswered questions with demand: ${input.evidence.join(', ')}`, evidence: input.evidence, proposedBy });
  }

  private propose(p: { kind: DraftKind; unit: KnowledgeUnit; replaces: string | null; previous_body: string | null; reason: string; evidence: string[]; proposedBy: string; suggestions?: Suggestion[] }): Draft {
    const dup = this.drafts.find((d) => d.status === 'pending' && d.unit.unit_id === p.unit.unit_id && d.unit.body === p.unit.body);
    if (dup) return dup;
    const legal = p.unit.verbatim || p.unit.authority_level === 'legal_approved';
    const d: Draft = {
      draft_id: `D-${String(++this.seq).padStart(3, '0')}`,
      kind: p.kind,
      status: 'pending',
      unit: p.unit,
      replaces: p.replaces,
      previous_body: p.previous_body,
      diff: p.previous_body ? wordDiff(p.previous_body, p.unit.body) : [],
      route_to: legal ? 'Legal' : 'Author',
      reason: p.reason,
      evidence: p.evidence,
      proposed_by: p.proposedBy,
      proposed_at: this.now(),
      suggestions: p.suggestions ?? [],
    };
    this.drafts.push(d);
    this.record(p.proposedBy, 'proposed', d, `${d.kind}, routed to ${d.route_to}`);
    return d;
  }

  private checkApprover(d: Draft, who: Approver) {
    if (d.status !== 'pending') throw new WorkflowError(`${d.draft_id} is already ${d.status}`);
    if (!who.name?.trim()) throw new WorkflowError('A named person must decide');
    if (/^(agent|model|system)\b/i.test(who.name)) throw new WorkflowError('AI agents and models can propose, never approve or reject');
    if (d.route_to === 'Legal' && who.role !== 'legal') throw new WorkflowError(`${d.draft_id} needs Legal approval (verbatim or legal content)`);
  }

  approve(draftId: string, who: Approver, edits?: { body?: string; title?: string; applies_to?: Partial<KnowledgeUnit['applies_to']>; synonyms?: string[] }): KnowledgeUnit {
    const d = this.drafts.find((x) => x.draft_id === draftId);
    if (!d) throw new WorkflowError(`unknown draft ${draftId}`);
    this.checkApprover(d, who);
    if (edits?.body !== undefined && edits.body !== d.unit.body && d.unit.verbatim && who.role !== 'legal')
      throw new WorkflowError('Only Legal can change verbatim wording');
    if (edits?.body !== undefined && !edits.body.trim()) throw new WorkflowError('Body cannot be empty');

    const { prev, published, after } = this.plan(d, who.name, edits);
    // Publication gate: the golden set runs on the store as it would be afterwards.
    const report = this.regression(prev, published, after);
    if (!report.allowed) {
      this.record(who.name, 'publish_blocked', d, report.summary);
      throw new PublishBlocked(report);
    }
    if (prev) this.history.push({ ...prev, status: 'superseded' });
    this.live = after;
    d.status = 'approved';
    d.decided_by = who.name;
    d.decided_role = who.role;
    d.decided_at = this.now();
    d.published_version = published.version;
    if (edits?.body !== undefined && edits.body !== d.unit.body) d.comment = 'edited at approval';
    this.record(who.name, 'approved', d, edits?.body !== undefined ? 'approved with edits' : 'approved as proposed');
    this.record(who.name, 'published', d, `${published.unit_id} v${published.version}`);
    this.moveSnapshot(d.draft_id, published.unit_id, published.title);
    this.engineCache = new Verity({ ...this.data, units: this.live });
    return published;
  }

  /** Accept a merge suggestion: link the source passage to an existing unit; nothing new is published. */
  merge(draftId: string, who: Approver, targetUnitId: string): Draft {
    const d = this.drafts.find((x) => x.draft_id === draftId);
    if (!d) throw new WorkflowError(`unknown draft ${draftId}`);
    this.checkApprover(d, who);
    if (d.kind === 'revision') throw new WorkflowError('A revision already belongs to its unit; approve or reject it');
    const target = this.live.find((u) => u.unit_id === targetUnitId && u.status === 'approved');
    if (!target) throw new WorkflowError(`${targetUnitId} is not an approved unit`);
    if (target.verbatim && who.role !== 'legal') throw new WorkflowError(`${targetUnitId} is verbatim: only Legal can link sources to it`);
    d.status = 'merged';
    d.merged_into = target.unit_id;
    d.decided_by = who.name;
    d.decided_role = who.role;
    d.decided_at = this.now();
    this.moveSnapshot(d.draft_id, target.unit_id, target.title);
    this.record(who.name, 'merged', d, `source linked to ${target.unit_id}; no new unit`);
    return d;
  }

  /** Accept a split suggestion: one draft per statement that no approved unit covers yet. */
  split(draftId: string, who: Approver): Draft[] {
    const d = this.drafts.find((x) => x.draft_id === draftId);
    if (!d) throw new WorkflowError(`unknown draft ${draftId}`);
    this.checkApprover(d, who);
    const sug = d.suggestions.find((x) => x.kind === 'split');
    if (!sug || sug.kind !== 'split') throw new WorkflowError(`${draftId} has no split suggestion`);
    const created: Draft[] = [];
    sug.parts.forEach((part, i) => {
      if (part.unit_id) return; // already its own approved unit
      const text = part.text.charAt(0).toUpperCase() + part.text.slice(1).replace(/\.?$/, '.');
      const unit: KnowledgeUnit = { ...d.unit, unit_id: this.nextId(d.unit.knowledge_base), title: `${d.unit.title} (${i + 1} of ${sug.parts.length})`, body: text, version: 0, status: 'in_review', supersedes: null };
      created.push(this.propose({ kind: 'new_unit', unit, replaces: null, previous_body: null, reason: `Split from ${d.draft_id}: one statement of ${sug.parts.length}.`, evidence: d.evidence, proposedBy: `${who.name}, split of ${d.draft_id}` }));
    });
    d.status = 'split';
    d.split_into = created.map((x) => x.draft_id);
    d.decided_by = who.name;
    d.decided_role = who.role;
    d.decided_at = this.now();
    const linked = sug.parts.filter((p) => p.unit_id).map((p) => p.unit_id);
    this.record(who.name, 'split', d, `${created.length} new draft(s)${linked.length ? `; already covered by ${linked.join(', ')}` : ''}`);
    return created;
  }

  private moveSnapshot(draftId: string, unitId: string, unitTitle: string) {
    const src = this.pendingSources.get(draftId);
    if (!src) return;
    const snap = (this.snapshots.get(src.source_doc) ?? []).filter((x) => x.source_section !== src.source_section);
    this.snapshots.set(src.source_doc, [...snap, { ...src, match: { ...src.match, status: 'unchanged', unit_id: unitId, unit_title: unitTitle, drift: null } }]);
  }

  /** Knowledge bases each role may search (entitlement), as the engine applies it now. */
  access(): Record<string, { label: string; knowledge_bases: string[] }> {
    return Object.fromEntries(Object.entries(this.data.roles).map(([k, r]) => [k, { label: r.label, knowledge_bases: [...r.knowledge_bases] }]));
  }

  knowledgeBases(): string[] {
    return [...new Set(this.live.map((u) => u.knowledge_base))].sort();
  }

  /**
   * Grant or revoke a role's access to a knowledge base. Human only, named,
   * with a reason, audited; takes effect on the next search because
   * entitlement is applied inside the search.
   */
  setAccess(role: string, kb: string, grant: boolean, who: { name: string }, reason: string): void {
    if (!who.name?.trim()) throw new WorkflowError('A named person must change access');
    if (/^(agent|model|system)\b/i.test(who.name)) throw new WorkflowError('AI agents and models cannot change access');
    if (!reason?.trim()) throw new WorkflowError('An access change needs a reason');
    const r = this.data.roles[role];
    if (!r) throw new WorkflowError(`unknown role ${role}`);
    if (!this.knowledgeBases().includes(kb)) throw new WorkflowError(`unknown knowledge base ${kb}`);
    const has = r.knowledge_bases.includes(kb);
    if (grant === has) throw new WorkflowError(`${role} ${grant ? 'already has' : 'does not have'} ${kb}`);
    r.knowledge_bases = grant ? [...r.knowledge_bases, kb] : r.knowledge_bases.filter((x) => x !== kb);
    this.audit.push({ at: this.now(), actor: who.name, action: grant ? 'access_granted' : 'access_revoked', draft_id: '-', unit_id: kb, detail: `${role}: ${reason}` });
    this.engineCache = new Verity({ ...this.data, units: this.live });
  }

  reject(draftId: string, who: Approver, reason: string): Draft {
    const d = this.drafts.find((x) => x.draft_id === draftId);
    if (!d) throw new WorkflowError(`unknown draft ${draftId}`);
    this.checkApprover(d, who);
    if (!reason?.trim()) throw new WorkflowError('A rejection needs a reason');
    d.status = 'rejected';
    d.decided_by = who.name;
    d.decided_role = who.role;
    d.decided_at = this.now();
    d.comment = reason;
    this.record(who.name, 'rejected', d, reason);
    return d;
  }
}
