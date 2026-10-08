// Verity engine types. Synthetic data only.

export type Outcome =
  | 'answer'
  | 'needs_clarification'
  | 'insufficient_evidence'
  | 'conflict'
  | 'stale'
  | 'not_authorized'
  | 'safety_escalation';

export type Authority = 'legal_approved' | 'policy' | 'knowledge_article';

export interface AppliesTo {
  lob: string[];
  states: 'ALL' | string[];
  plan_year: number;
}

export interface KnowledgeUnit {
  unit_id: string;
  title: string;
  type: string;
  body: string;
  verbatim: boolean;
  spoken_version: string | null;
  knowledge_base: string;
  audience: string[];
  channels: string[];
  authority_level: Authority;
  source_doc: string;
  source_section: string;
  effective_date: string;
  review_date: string;
  version: number;
  status: string;
  supersedes: string | null;
  synonyms: string[];
  owner: string;
  approved_by: string;
  applies_to: AppliesTo;
}

export interface Role {
  label: string;
  knowledge_bases: string[];
  audience: string;
  lob: string[];
}

export interface RequestContext {
  lob: string | null;
  state: string | null;
  plan_year?: number;
}

export interface ServeRequest {
  query: string;
  role: string;
  channel: string; // where the answer is delivered: advocate_view | member_chat | voice
  input_mode?: 'typed' | 'voice'; // how the question arrived (FAILURES.md F03)
  context: RequestContext;
}

export interface Candidate {
  unit_id: string;
  version: number;
  score: number;
  coverage: number;
  phrase_match: boolean; // query contains one of the unit's curated synonym phrases
  anchored: boolean; // at least one query word matched the title or synonyms, not only the body
}

export interface Exclusion {
  unit_id: string;
  reason: string;
}

export interface TraceStep {
  step: number;
  name: string;
  kind: 'D' | 'P' | 'D+P' | 'H';
  detail: string;
}

export interface PartResult {
  part: string;
  outcome: Outcome;
  unit_ids: string[];
  text: string | null; // what the channel displays or speaks
  message: string; // one-line explanation for the user
  owner_team?: string; // for not_authorized and conflict routing
  candidates: Candidate[];
  exclusions: Exclusion[];
  resolution_path: string[];
  verification: { verbatim_exact: boolean | null; in_scope: boolean };
}

export interface ReproRecord {
  request_id: string;
  as_of: string;
  query_redacted: string;
  redactions: string[];
  role: string;
  entitlement: string[];
  channel: string;
  partitions: Record<string, unknown>;
  model_context_unit_ids: string[]; // bodies that would be sent to a model
  engine: string;
  latency_ms: number;
}

export interface ServeResponse {
  outcome: Outcome; // overall: first part's outcome, or safety
  parts: PartResult[];
  trace: TraceStep[];
  record: ReproRecord;
  gap_logged: boolean;
}
