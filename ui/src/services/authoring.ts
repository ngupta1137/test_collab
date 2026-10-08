// Authoring contract between the Author page and the server. Browser-safe:
// types only. The engine (extraction, approval gate, publishing) runs on the
// server in src/verity-engine/authoring.ts.

export type CandidateStatus = "unchanged" | "changed" | "new";
export type ApproverRole = "legal" | "author";

export interface CandidateView {
  cid: string;
  title: string;
  type: string;
  body: string;
  verbatim: boolean;
  knowledge_base: string;
  owner: string;
  source_section: string;
  status: CandidateStatus;
  unit_id: string | null;
  unit_title: string | null;
  similarity: number;
  diff: string[];
  impact: string | null;
  route_to: string;
  suggestions: SuggestionView[];
}

export interface IngestView {
  doc_id: string;
  title: string;
  owner: string;
  effective_date: string;
  extractor: string;
  candidates: CandidateView[];
  skipped: { text: string; reason: string }[];
  notes: string[];
}

export type SuggestionView =
  | { kind: "merge"; unit_id: string; unit_title: string; overlap: number; reason: string }
  | { kind: "split"; parts: { text: string; unit_id: string | null; unit_title: string | null }[]; reason: string }
  | { kind: "tags"; lob: string[] | null; states: string[] | null; plan_year: number | null; synonyms: string[]; evidence: string[]; reason: string };

export interface RegressionView {
  allowed: boolean;
  checked: number;
  summary: string;
  blocking: { case_id: string; query: string; was: string; now: string }[];
  warnings: { case_id: string; query: string; was: string; now: string }[];
}

export interface DraftView {
  draft_id: string;
  kind: "new_unit" | "revision" | "gap_proposal";
  status: "pending" | "approved" | "rejected" | "merged" | "split";
  unit_id: string;
  title: string;
  body: string;
  verbatim: boolean;
  knowledge_base: string;
  owner: string;
  route_to: "Legal" | "Author";
  reason: string;
  diff: string[];
  previous_body: string | null;
  proposed_by: string;
  decided_by: string | null;
  decided_role: string | null;
  comment: string | null;
  published_version: number | null;
  suggestions: SuggestionView[];
  regression: RegressionView | null; // golden-set check for a pending draft: what publishing it would do
  merged_into: string | null;
  split_into: string[];
}

export interface AuditView {
  at: string;
  actor: string;
  action: string;
  draft_id: string;
  unit_id: string;
  detail: string;
}

export interface UnitRow {
  unit_id: string;
  title: string;
  owner: string;
  version: number;
  verbatim: boolean;
  status: string;
  updated: boolean; // published (or newly created) in this session
  badge: "conflict" | "stale" | "retired" | null;
}

export interface GapCluster {
  cluster_id: string;
  demand: number;
  questions: { id: string; text: string }[];
  gap_type: string;
  nearest: { unit_id: string; title: string; owner: string } | null;
  suggested_title: string;
  knowledge_base: string;
  owner: string;
  synonyms: string[];
  proposed_draft: string | null;
  first_seen: string | null;
  age_days: number | null;
  suggested_owner: string;
  claimed_by: string | null;
}

export interface ReviewItemView {
  item_id: string;
  kind: "stale" | "conflict";
  unit_ids: string[];
  owner: string;
  status: "open" | "claimed" | "resolved";
  opened: string;
  asks: number;
  example_query: string;
  claimed_by: string | null;
  note: string;
}

export interface SampleSource {
  id: string;
  label: string;
  hint: string;
  text: string;
}

export interface AccessView {
  roles: { role: string; label: string; knowledge_bases: string[] }[];
  knowledge_bases: string[];
}

export interface InsightsView {
  total: number;
  from_log: number;
  from_session: number;
  outcomes: { outcome: string; count: number }[];
  unanswered_rate: number;
  top_gaps: { cluster_id: string; demand: number; example: string; drafted: boolean }[];
  recent: { at: string; role: string; channel: string; query: string; outcome: string }[];
}

export interface AuthoringState {
  units: UnitRow[];
  queue: DraftView[];
  audit: AuditView[];
  gaps: GapCluster[];
  reviews: ReviewItemView[];
  samples: SampleSource[];
  as_of: string;
  access: AccessView;
  insights: InsightsView;
}

export interface DecideRequest {
  draft_id: string;
  action: "approve" | "reject" | "merge" | "split";
  target_unit_id?: string | null;
  approver: { name: string; role: ApproverRole };
  body: string | null;
  reason: string | null;
  accept_tags?: boolean; // approve with the suggested scope and synonyms
}

export interface ActionResult {
  ok: boolean;
  error: string | null;
  message: string | null;
  state: AuthoringState;
}

export interface AccessRequest {
  role: string;
  knowledge_base: string;
  grant: boolean;
  admin: string;
  reason: string;
}
