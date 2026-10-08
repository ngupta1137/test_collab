// Author page server logic: ingest -> queue -> approval gate -> live on Ask.
import { beforeEach, describe, expect, it } from "vitest";
import { authoringState, changeAccess, claimGap, claimReview, decide, ingestSource, proposeCandidates, proposeGap, resetDemo } from "../verity-engine/authoring";
import { getStore, serveEngine } from "../verity-engine/server";

const sample = (id: string) => authoringState().samples.find((s) => s.id === id)!.text;
const dana = { name: "Dana (Knowledge author)", role: "author" as const };
const rita = { name: "Rita (Legal)", role: "legal" as const };
const ask = (query: string) => serveEngine({ query, role: "pharmacy_advocate", channel: "advocate_view", lob: "MAPD", state: null } as never);

describe("authoring", () => {
  beforeEach(() => resetDemo());

  it("re-ingesting the approved script flags nothing; the revised one flags exactly two", () => {
    expect(ingestSource(sample("rx-current")).candidates.every((c) => c.status === "unchanged")).toBe(true);
    const r = ingestSource(sample("rx-revised"));
    const flagged = r.candidates.filter((c) => c.status !== "unchanged");
    expect(flagged.map((c) => c.unit_id).sort()).toEqual(["U-PH-003", "U-PH-006"]);
    expect(flagged.find((c) => c.unit_id === "U-PH-003")!.impact).toBe("contradiction");
  });

  it("a new document: copied opening recognized, reworded disclaimer flagged for Legal, new talking point proposed", () => {
    const r = ingestSource(sample("outreach-v4"));
    const by = (re: RegExp) => r.candidates.find((c) => re.test(c.body))!;
    expect(by(/recorded line/).status).toBe("unchanged");
    expect(by(/prices I give you/).status).toBe("changed");
    expect(by(/prices I give you/).route_to).toMatch(/^Legal/);
    expect(by(/automatic refills/).status).toBe("new");
    expect(by(/100-day/).unit_id).toBe("U-PH-107");
  });

  it("the author cannot approve verbatim; Legal rejects it and the approved disclaimer stays live", () => {
    const text = sample("rx-revised");
    const cids = ingestSource(text).candidates.filter((c) => c.status === "changed").map((c) => c.cid);
    const q = proposeCandidates(text, cids);
    expect(q.ok).toBe(true);
    const legalDraft = q.state.queue.find((d) => d.unit_id === "U-PH-003")!;
    expect(legalDraft.route_to).toBe("Legal");
    const denied = decide({ draft_id: legalDraft.draft_id, action: "approve", approver: dana, body: null, reason: null });
    expect(denied.ok).toBe(false);
    expect(denied.error).toMatch(/Legal/);
    expect(decide({ draft_id: legalDraft.draft_id, action: "reject", approver: rita, body: null, reason: "Contradicts approved wording" }).ok).toBe(true);
    expect(ask("rx pricing disclaimer").parts[0]!.text).toMatch(/may change/);
  });

  it("an approved revision is served on the next search", () => {
    const text = sample("rx-revised");
    const cid = ingestSource(text).candidates.find((c) => c.unit_id === "U-PH-006")!.cid;
    const draft = proposeCandidates(text, [cid]).state.queue[0]!;
    const r = decide({ draft_id: draft.draft_id, action: "approve", approver: dana, body: null, reason: null });
    expect(r.message).toMatch(/U-PH-006 v2/);
    expect(ask("how long does mail order delivery take").parts[0]!.text).toMatch(/5 to 7/);
  });

  it("a gap answer needs a person-written body and is invisible until approved", () => {
    expect(proposeGap({ cluster_id: "C01", title: "x", body: " " }).ok).toBe(false);
    const p = proposeGap({ cluster_id: "C01", title: "Specialty (tier 3) drug copay", body: "Specialty and tier 3 drug copays depend on the member plan. Quote only the member-specific amount shown in the pricing tool." });
    expect(p.ok).toBe(true);
    expect(ask("specialty drug copay").parts[0]!.outcome).toBe("insufficient_evidence");
    decide({ draft_id: p.state.queue[0]!.draft_id, action: "approve", approver: dana, body: null, reason: null });
    expect(ask("specialty drug copay").parts[0]!.outcome).toBe("answer");
  });

  it("merge and split suggestions are offered and are reviewer decisions", () => {
    const text = authoringState().samples.find((x) => x.id === "rx-current")!.text.replace("Verify identity: full name + DOB", "Verify identity: full name, DOB");
    resetDemo();
    // A fresh store has a snapshot of the current script, so use a new document id to see suggestions.
    const doc = text.replace("KB-PHARM-0142", "KB-PHARM-0500");
    const r = ingestSource(doc);
    const idv = r.candidates.find((c) => c.title === "Verify identity")!;
    expect(idv.suggestions.some((sg) => sg.kind === "merge" && sg.unit_id === "U-PH-002")).toBe(true);
    const q = proposeCandidates(doc, [idv.cid]);
    const d = q.state.queue.find((x) => x.status === "pending")!;
    const m = decide({ draft_id: d.draft_id, action: "merge", target_unit_id: "U-PH-002", approver: dana, body: null, reason: null });
    expect(m.ok).toBe(true);
    expect(m.state.queue.find((x) => x.draft_id === d.draft_id)!.status).toBe("merged");
  });

  it("access changes need a person and a reason, and apply to the next search", () => {
    const ins = (q: string) => serveEngine({ query: q, role: "pharmacy_advocate", channel: "advocate_view", lob: "MAPD", state: null } as never).parts[0]!.outcome;
    const q = "how do I change a member primary care provider";
    expect(ins(q)).toBe("not_authorized");
    expect(changeAccess({ role: "pharmacy_advocate", knowledge_base: "KB-INS", grant: true, admin: "Sam (Access admin)", reason: "" }).ok).toBe(false);
    expect(changeAccess({ role: "pharmacy_advocate", knowledge_base: "KB-INS", grant: true, admin: "agent:bot", reason: "x" }).ok).toBe(false);
    expect(changeAccess({ role: "pharmacy_advocate", knowledge_base: "KB-INS", grant: true, admin: "Sam (Access admin)", reason: "Cross-trained pilot" }).ok).toBe(true);
    expect(ins(q)).toBe("answer");
    const st = authoringState();
    expect(st.insights.from_session).toBeGreaterThan(0);
    expect(st.audit[0]!.action).toBe("access_granted");
  });
  it("publication gate: a broad copay unit would newly fail a critical golden case, so approval is blocked and the card says why", () => {
    const d = getStore().proposeGapUnit({
      title: "Copay assistance program", body: "Members can get help with copays. Ask the pharmacy team for details.",
      knowledge_base: "KB-PHARM", owner: "Pharmacy Ops", synonyms: ["copay assistance program", "copay help"], evidence: ["Q99"],
    }, "agent:gap-analyst");
    const card = authoringState().queue.find((x) => x.draft_id === d.draft_id)!;
    expect(card.regression?.allowed).toBe(false);
    expect(card.regression?.blocking.length).toBeGreaterThan(0);
    const r = decide({ draft_id: d.draft_id, action: "approve", approver: dana, body: null, reason: null });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/^Blocked/);
    expect(authoringState().queue.find((x) => x.draft_id === d.draft_id)!.status).toBe("pending");
  });
});

describe("owner queue and gap claims", () => {
  beforeEach(() => resetDemo());
  it("a stale answer opens an owner item once, repeats raise the count, and a claim is recorded", () => {
    const ask = (q: string) => serveEngine({ query: q, role: "pharmacy_advocate", channel: "advocate_view", lob: "MAPD", state: null } as never);
    ask("is there a shipping fee for mail order");
    ask("is there a shipping fee for mail order");
    const items = authoringState().reviews;
    expect(items).toHaveLength(1);
    expect(items[0]!.asks).toBe(2);
    expect(claimReview(items[0]!.item_id, "Dana").ok).toBe(true);
    expect(authoringState().reviews[0]!.claimed_by).toBe("Dana");
  });
  it("gap clusters show age and suggested owner; the first claim holds", () => {
    const g = authoringState().gaps[0]!;
    expect(g.age_days).toBeGreaterThan(0);
    expect(g.suggested_owner).toBeTruthy();
    claimGap(g.cluster_id, "Dana");
    claimGap(g.cluster_id, "Lee");
    expect(authoringState().gaps[0]!.claimed_by).toBe("Dana");
  });
});

describe("channel compare", () => {
  it("the same question on three channels cites the same unit; verbatim text is identical", () => {
    const on = (channel: string) => serveEngine({ query: "rx pricing disclaimer", role: "pharmacy_advocate", channel, input_mode: channel === "voice" ? "voice" : "typed", lob: "MAPD", state: null } as never).parts[0]!;
    const [a, v] = [on("advocate_view"), on("voice")];
    expect(a.outcome).toBe("answer");
    expect(v.citations.map((c) => c.unit_id)).toEqual(a.citations.map((c) => c.unit_id));
    expect(v.text).toBe(a.text);
  });
});
