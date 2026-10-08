// Server-only authoring entry: source ingest, approval queue, gap proposals.
// Maps the engine's KnowledgeStore (copied from the verity repo) to the
// browser contract in src/services/authoring.ts.
import sourceDocs from "./data/source_docs.json";
import gapReport from "./data/gap_report.json";
import unitsSeed from "./data/units_seed.json";
import { getStore, resetStore, sessionLog, AS_OF, ownerQueue } from "./server.ts";
import type {
  AccessRequest, AccessView, InsightsView, SuggestionView,
  ActionResult, AuthoringState, CandidateView, DecideRequest, DraftView, GapCluster, IngestView, SampleSource, UnitRow,
} from "../services/authoring.ts";

const docs = sourceDocs as Record<string, string>;
const RX = docs["rx_education_script_A.md"] ?? "";

// Demo sources. Synthetic. The "revised" script changes two lines; the v4
// script is a new document that repeats the opening, rewords the legal
// disclaimer and adds one new talking point.
const SAMPLES: SampleSource[] = [
  {
    id: "rx-current",
    label: "Rx education script (as approved)",
    hint: "Re-ingest the current script: nothing changed, so nothing is flagged.",
    text: RX,
  },
  {
    id: "rx-revised",
    label: "Rx education script, revised",
    hint: "Two edits: delivery time, and one word in the legal pricing disclaimer.",
    text: RX.replace("7 to 10 business days", "5 to 7 business days").replace(
      "based on your current plan and may change.",
      "based on your current plan and will not change.",
    ).replace("Last edited: 03/14/2026", "Last edited: 10/06/2026"),
  },
  {
    id: "outreach-v4",
    label: "Outreach script v4 (new document)",
    hint: "A new script that copies the opening, rewords the disclaimer and adds a talking point.",
    text: [
      "PHARMACY OUTREACH SCRIPT v4   (SYNTHETIC - FOR PROTOTYPE ONLY)",
      "Doc ID: KB-PHARM-0099 | Owner: Outbound Pharmacy Team | Last edited: 10/01/2026 | Effective: 10/01/2026",
      "",
      'Intro (read as written): "Thank you for calling. This call is on a recorded line and may be monitored for quality and training purposes. My name is [Advocate Name]. May I have your full name and date of birth?"',
      "",
      "Talking points:",
      "- Members can set up automatic refills for maintenance medications delivered by mail",
      "- Members can get up to a 100-day supply of maintenance medications by mail",
      "",
      'Pricing disclaimer - Verbatim (Legal): "The prices I give you today are estimates based on your current plan and might change. Your final cost will be confirmed once your prescription is processed."',
    ].join("\n"),
  },
  {
    id: "tip-sheet",
    label: "New-hire tip sheet (overlaps)",
    hint: "A training handout that restates an existing unit and packs several facts into one line: shows merge and split suggestions.",
    text: [
      "PHARMACY NEW-HIRE TIP SHEET   (SYNTHETIC - FOR PROTOTYPE ONLY)",
      "Doc ID: KB-PHARM-0210 | Owner: Pharmacy Training Team | Last edited: 09/20/2026 | Effective: 09/20/2026",
      "",
      "[BEFORE YOU DISCUSS ANY PRESCRIPTION]",
      "Verify identity: full name + DOB + member ID OR address on file (see ID&V article 7731).",
      "",
      "[MAIL ORDER]",
      "Explain mail order benefits: meds delivered to home, 90-day supply available for most maintenance medications, possible savings vs. retail. Do NOT quote $ unless the pricing tool shows member-specific cost.",
    ].join("\n"),
  },
];

const CONFLICT = new Set(["U-PH-107", "U-PH-007"]);
// Versions as seeded, so "Updated" marks only what changed in this session.
const SEED_VERSION = new Map(
  ((unitsSeed as unknown as { units: { unit_id: string; version: number }[] }).units ?? []).map((u) => [u.unit_id, u.version]),
);

function units(): UnitRow[] {
  return getStore()
    .units()
    .filter((u) => u.status !== "duplicate_candidate")
    .map((u) => ({
      unit_id: u.unit_id,
      title: u.title,
      owner: u.owner,
      version: u.version,
      verbatim: u.verbatim,
      status: u.status,
      updated: u.version > (SEED_VERSION.get(u.unit_id) ?? 0),
      badge: u.status === "retired" ? "retired" : u.review_date < AS_OF ? "stale" : CONFLICT.has(u.unit_id) ? "conflict" : null,
    }));
}

function regressionView(draftId: string): DraftView["regression"] {
  try {
    const r = getStore().previewRegression(draftId);
    return { allowed: r.allowed, checked: r.checked, summary: r.summary, blocking: r.blocking, warnings: r.warnings };
  } catch {
    return null;
  }
}

function draftView(d: ReturnType<ReturnType<typeof getStore>["queue"]>[number]): DraftView {
  return {
    draft_id: d.draft_id,
    kind: d.kind,
    status: d.status,
    unit_id: d.unit.unit_id,
    title: d.unit.title,
    body: d.unit.body,
    verbatim: d.unit.verbatim,
    knowledge_base: d.unit.knowledge_base,
    owner: d.unit.owner,
    route_to: d.route_to,
    reason: d.reason,
    diff: d.diff,
    previous_body: d.previous_body,
    proposed_by: d.proposed_by,
    decided_by: d.decided_by ?? null,
    decided_role: d.decided_role ?? null,
    comment: d.comment ?? null,
    published_version: d.published_version ?? null,
    suggestions: (d.suggestions ?? []) as SuggestionView[],
    regression: d.status === "pending" ? regressionView(d.draft_id) : null,
    merged_into: d.merged_into ?? null,
    split_into: d.split_into ?? [],
  };
}

const gapDrafts = new Map<string, string>(); // cluster_id -> draft_id

function gaps(): GapCluster[] {
  const report = gapReport as unknown as {
    clusters: {
      cluster_id: string; demand: number; first_seen?: string | null; age_days?: number | null; suggested_owner?: string; questions: { id: string; text: string }[]; gap_type: string;
      nearest_existing_unit: { unit_id: string; title: string; owner: string } | null;
      draft_unit: { title: string | null; synonyms: string[] };
    }[];
  };
  const live = getStore().units();
  return report.clusters.map((c) => {
    const near = c.nearest_existing_unit ? live.find((u) => u.unit_id === c.nearest_existing_unit!.unit_id) : undefined;
    const first = c.questions[0]?.text ?? c.cluster_id;
    return {
      cluster_id: c.cluster_id,
      demand: c.demand,
      questions: c.questions,
      gap_type: c.gap_type,
      nearest: c.nearest_existing_unit ? { unit_id: c.nearest_existing_unit.unit_id, title: c.nearest_existing_unit.title, owner: c.nearest_existing_unit.owner } : null,
      suggested_title: c.draft_unit.title ?? first.charAt(0).toUpperCase() + first.slice(1),
      knowledge_base: near?.knowledge_base ?? "KB-PHARM",
      owner: near?.owner ?? "Knowledge Ops",
      synonyms: c.draft_unit.synonyms ?? c.questions.map((q) => q.text),
      proposed_draft: gapDrafts.get(c.cluster_id) ?? null,
      first_seen: c.first_seen ?? null,
      age_days: c.age_days ?? null,
      suggested_owner: c.suggested_owner ?? "Knowledge Ops (triage)",
      claimed_by: ownerQueue.gapClaim(c.cluster_id)?.by ?? null,
    };
  });
}

function access(): AccessView {
  const s = getStore();
  return {
    roles: Object.entries(s.access()).map(([role, r]) => ({ role, label: r.label, knowledge_bases: r.knowledge_bases })),
    knowledge_bases: s.knowledgeBases(),
  };
}

const UNANSWERED = new Set(["insufficient_evidence", "needs_clarification"]);

function insights(): InsightsView {
  const report = gapReport as unknown as { classified: { outcome: string }[] };
  const logOutcomes = report.classified.map((c) => c.outcome);
  const sessionOutcomes = sessionLog.map((x) => x.outcomes[0] ?? "insufficient_evidence");
  const all = [...logOutcomes, ...sessionOutcomes];
  const counts = new Map<string, number>();
  for (const o of all) counts.set(o, (counts.get(o) ?? 0) + 1);
  const g = gaps();
  return {
    total: all.length,
    from_log: logOutcomes.length,
    from_session: sessionOutcomes.length,
    outcomes: [...counts.entries()].map(([outcome, count]) => ({ outcome, count })).sort((a, b) => b.count - a.count),
    unanswered_rate: all.length ? all.filter((o) => UNANSWERED.has(o)).length / all.length : 0,
    top_gaps: g
      .slice()
      .sort((a, b) => b.demand - a.demand)
      .slice(0, 5)
      .map((c) => ({ cluster_id: c.cluster_id, demand: c.demand, example: c.questions[0]?.text ?? "", drafted: c.proposed_draft !== null })),
    recent: sessionLog
      .slice(-8)
      .reverse()
      .map((x) => ({ at: x.at.slice(11, 19), role: x.role, channel: x.channel, query: x.query, outcome: x.outcomes.join(", ") })),
  };
}

export function authoringState(): AuthoringState {
  const s = getStore();
  return {
    access: access(),
    insights: insights(),
    units: units(),
    queue: s.queue().map(draftView).reverse(),
    audit: s.log().reverse(),
    gaps: gaps(),
    reviews: ownerQueue.list().map((i) => ({ ...i })),
    samples: SAMPLES,
    as_of: AS_OF,
  };
}

const clip = (t: unknown) => String(t ?? "").slice(0, 20000);

export function ingestSource(text: string): IngestView {
  const r = getStore().ingest(clip(text));
  return {
    doc_id: r.doc_id,
    title: r.title,
    owner: r.owner,
    effective_date: r.effective_date,
    extractor: r.extractor,
    skipped: r.skipped,
    notes: r.lifecycle_notes,
    candidates: r.candidates.map(
      (c): CandidateView => ({
        cid: c.cid,
        title: c.title,
        type: c.type,
        body: c.body,
        verbatim: c.verbatim,
        knowledge_base: c.knowledge_base,
        owner: c.owner,
        source_section: c.source_section,
        status: c.match.status,
        unit_id: c.match.unit_id,
        unit_title: c.match.unit_title,
        similarity: c.match.similarity,
        diff: c.match.drift?.diff ?? [],
        impact: c.match.drift?.impact ?? null,
        route_to: c.route_to,
        suggestions: (c.suggestions ?? []) as SuggestionView[],
      }),
    ),
  };
}

const ok = (message: string): ActionResult => ({ ok: true, error: null, message, state: authoringState() });
const fail = (e: unknown): ActionResult => ({ ok: false, error: (e as Error).message, message: null, state: authoringState() });

/** Re-extracts on the server and queues the chosen candidates; the browser never supplies unit content. */
export function proposeCandidates(text: string, cids: string[]): ActionResult {
  try {
    const s = getStore();
    const r = s.ingest(clip(text));
    const chosen = r.candidates.filter((c) => cids.includes(c.cid) && c.match.status !== "unchanged");
    const drafts = chosen.map((c) => s.proposeFromCandidate(c, "agent:extraction (rules-v0)")).filter(Boolean);
    return ok(drafts.length ? `${drafts.length} sent to the review queue` : "Nothing to send: no changed or new units selected");
  } catch (e) {
    return fail(e);
  }
}

export function decide(req: DecideRequest): ActionResult {
  try {
    const s = getStore();
    const who = { name: String(req.approver?.name ?? ""), role: req.approver?.role === "legal" ? ("legal" as const) : ("author" as const) };
    if (req.action === "merge") {
      const d = s.merge(req.draft_id, who, String(req.target_unit_id ?? ""));
      return ok(`Linked the source to ${d.merged_into}. No new unit was created.`);
    }
    if (req.action === "split") {
      const parts = s.split(req.draft_id, who);
      return ok(`Split into ${parts.length} new draft${parts.length === 1 ? "" : "s"}; statements already covered were linked, not duplicated.`);
    }
    if (req.action === "approve") {
      const draft = s.queue().find((x) => x.draft_id === req.draft_id);
      const tags = req.accept_tags ? (draft?.suggestions ?? []).find((x) => x.kind === "tags") : undefined;
      const edits: { body?: string; applies_to?: Record<string, unknown>; synonyms?: string[] } = {};
      if (req.body !== null && req.body !== undefined) edits.body = clip(req.body);
      if (tags && tags.kind === "tags") {
        edits.applies_to = { ...(tags.lob ? { lob: tags.lob } : {}), ...(tags.states ? { states: tags.states } : {}), ...(tags.plan_year ? { plan_year: tags.plan_year } : {}) };
        edits.synonyms = [...new Set([...(draft?.unit.synonyms ?? []), ...tags.synonyms])];
      }
      const u = s.approve(req.draft_id, who, Object.keys(edits).length ? edits : undefined);
      return ok(`Published ${u.unit_id} v${u.version}. It is live on the Ask page now.`);
    }
    s.reject(req.draft_id, who, String(req.reason ?? ""));
    return ok(`Rejected ${req.draft_id}. The approved version stays live.`);
  } catch (e) {
    return fail(e);
  }
}

export function proposeGap(input: { cluster_id: string; title: string; body: string }): ActionResult {
  try {
    const c = gaps().find((g) => g.cluster_id === input.cluster_id);
    if (!c) throw new Error(`unknown cluster ${input.cluster_id}`);
    if (!String(input.body ?? "").trim()) throw new Error("Write the answer first: the gap analyst groups the questions, a person supplies the content");
    const d = getStore().proposeGapUnit(
      {
        title: clip(input.title) || c.suggested_title,
        body: clip(input.body),
        knowledge_base: c.knowledge_base,
        owner: c.owner,
        synonyms: c.synonyms,
        evidence: c.questions.map((q) => q.id),
      },
      "Dana (Knowledge author), from gap analyst cluster " + c.cluster_id,
    );
    gapDrafts.set(c.cluster_id, d.draft_id);
    return ok(`${d.draft_id} sent to the review queue (${d.route_to})`);
  } catch (e) {
    return fail(e);
  }
}

export function claimGap(clusterId: string, by: string): ActionResult {
  const c = gaps().find((g) => g.cluster_id === clusterId);
  if (!c) return fail(new Error(`unknown cluster ${clusterId}`));
  const claim = ownerQueue.claimGap(clusterId, by, AS_OF);
  return ok(claim.by === by ? `${clusterId} is yours` : `${clusterId} is already claimed by ${claim.by}`);
}

export function claimReview(itemId: string, by: string): ActionResult {
  const i = ownerQueue.claim(itemId, by);
  return i ? ok(`${itemId} claimed by ${by}`) : fail(new Error(`cannot claim ${itemId}`));
}

export function resetDemo(): ActionResult {
  resetStore();
  void import("./agents.ts").then((m) => m.resetAgentState());
  gapDrafts.clear();
  return ok("Demo reset to the seed data");
}

export function changeAccess(req: AccessRequest): ActionResult {
  try {
    getStore().setAccess(String(req.role), String(req.knowledge_base), !!req.grant, { name: String(req.admin ?? "") }, String(req.reason ?? ""));
    return ok(`${req.grant ? "Granted" : "Revoked"} ${req.knowledge_base} for ${req.role}. It applies to the next search.`);
  } catch (e) {
    return fail(e);
  }
}
