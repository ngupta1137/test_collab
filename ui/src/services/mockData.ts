import type { Citation, Outcome, SearchRequest, SearchResponse } from "./verity";

const ENTITLEMENTS: Record<string, string> = {
  pharmacy_advocate: "KB-PHARM, KB-SHARED",
  insurance_advocate: "KB-INS, KB-SHARED",
  member_chat: "KB-PHARM (member-safe), KB-SHARED",
};

interface Fixture {
  outcome: Outcome;
  message: string;
  text: string | null;
  owner_team?: string | null;
  citations?: Citation[];
  intent: string;
}

const cite = (
  unit_id: string,
  version: number,
  title: string,
  owner: string,
  effective_date: string,
  verbatim: boolean,
  text?: string,
): Citation => ({ unit_id, version, title, owner, effective_date, verbatim, ...(text ? { text } : {}) });

const GAP: Fixture = {
  outcome: "insufficient_evidence",
  message: "No approved content found. Logged as a gap for the knowledge team.",
  text: null,
  intent: "unknown",
};

function match(req: SearchRequest): Fixture {
  const q = req.query.toLowerCase();
  const has = (s: string) => q.includes(s);

  if (has("chest pain") || has("can't breathe") || has("can’t breathe")) {
    return {
      outcome: "safety_escalation",
      message: "Urgent language detected. Human handoff.",
      text: "This sounds urgent. If this is a medical emergency, call 911 now. I am connecting you with a person who can help right away.",
      intent: "safety",
    };
  }
  if (has("pricing disclaimer")) {
    if (req.role === "insurance_advocate") {
      return {
        outcome: "not_authorized",
        message: "This is owned by Compliance (KB-PHARM). Transfer or ask that team.",
        text: null,
        owner_team: "Compliance",
        intent: "pricing_disclaimer",
      };
    }
    return {
      outcome: "answer",
      message: "Pricing disclaimer (Rx) · Compliance · v1 · effective 2026-01-15",
      text: "The prices I share today are estimates based on your current plan and may change. Your final cost will be confirmed when your prescription is processed.",
      citations: [cite("U-PH-003", 1, "Pricing disclaimer (Rx)", "Compliance", "2026-01-15", true)],
      intent: "pricing_disclaimer",
    };
  }
  if (has("closing")) {
    return {
      outcome: "answer",
      message: "Call closing: no impact on membership · Compliance · v2 · effective 2026-01-15",
      text: "Your decision today has no impact on your plan membership. Is there anything else I can help you with today?",
      citations: [cite("U-SH-002", 2, "Call closing: no impact on membership", "Compliance", "2026-01-15", true)],
      intent: "call_closing",
    };
  }
  if (has("days supply") || has("90")) {
    return {
      outcome: "conflict",
      message: "Two approved sources disagree. Both shown; routed to owners.",
      text: null,
      owner_team: "Pharmacy Ops, Outbound Pharmacy",
      citations: [
        cite("U-PH-007", 1, "Days supply by mail (90-day)", "Pharmacy Ops", "2026-01-15", false,
          "A 90-day supply is available by mail for most maintenance medications."),
        cite("U-PH-107", 3, "Days supply by mail (100-day, legacy)", "Outbound Pharmacy", "2025-11-01", false,
          "Members can get up to a 100-day supply of maintenance medications by mail."),
      ],
      intent: "days_supply",
    };
  }
  if (has("copay")) {
    if (!req.state) {
      return { outcome: "needs_clarification", message: "Which state is the member's plan in?", text: null, intent: "copay_assistance" };
    }
    if (req.state === "KY") {
      return {
        outcome: "answer",
        message: "Copay assistance program (Kentucky pilot) · Pharmacy Ops · v1 · effective 2026-03-01",
        text: "Members in Kentucky can enroll in the Rx copay assistance pilot through an advocate. Eligibility is confirmed in the pharmacy system before enrollment.",
        citations: [cite("U-PH-010", 1, "Copay assistance program (Kentucky pilot)", "Pharmacy Ops", "2026-03-01", false)],
        intent: "copay_assistance",
      };
    }
    return {
      outcome: "insufficient_evidence",
      message: "Approved content exists but does not apply here. Logged as a gap.",
      text: null,
      intent: "copay_assistance",
    };
  }
  if (has("shipping fee")) {
    return {
      outcome: "stale",
      message: "Past its review date (2026-06-30). Do not present as current; owner notified.",
      text: "Standard shipping for mail order is at no extra cost.",
      citations: [cite("U-PH-008", 1, "Mail order shipping cost", "Pharmacy Ops", "2025-06-30", false)],
      intent: "shipping_cost",
    };
  }
  if (has("how long") && has("mail")) {
    return {
      outcome: "answer",
      message: "Mail order delivery time · Pharmacy Ops · v1 · effective 2026-01-15",
      text: "Mail order prescriptions typically arrive within 7 to 10 business days after the prescription is received from the doctor.",
      citations: [cite("U-PH-006", 1, "Mail order delivery time", "Pharmacy Ops", "2026-01-15", false)],
      intent: "mail_delivery_time",
    };
  }
  return GAP;
}

function buildTrace(req: SearchRequest, f: Fixture, requestId: string): string[] {
  const ent = ENTITLEMENTS[req.role] ?? "none";
  const safety = f.outcome === "safety_escalation";
  const trace = [
    `1. Resolve role and entitlements [D]: ${req.role}: ${ent}`,
    "2. Redact PHI/PII [D]: nothing to redact",
    `3. Safety pre-check [D+P]: ${safety ? "urgent language detected, human handoff" : "clear"}`,
  ];
  if (safety) return trace;
  const n = f.citations?.length ?? 0;
  return [
    ...trace,
    `4. Query understanding [P]: intent=${f.intent}`,
    `5. Hard partitions [D]: lob=${req.lob ?? "unknown"}, state=${req.state ?? "unknown"}, channel=${req.channel}`,
    `6. Search [D]: ${n} candidate unit(s)`,
    `7. Eligibility [D]: ${f.outcome === "not_authorized" ? "blocked by entitlements" : "eligible"}`,
    `8. Applicability [D]: ${f.outcome === "needs_clarification" ? "missing state" : "checked"}`,
    `9. Authority and recency [D]: ${f.outcome === "stale" ? "past review date" : f.outcome === "conflict" ? "sources disagree" : "ok"}`,
    `10. Compose [D]: ${f.text ? (f.citations?.[0]?.verbatim ? "verbatim" : "grounded") : "no text"}`,
    "11. Verify [D+P]: passed",
    `12. Return outcome per part [D]: ${f.outcome}`,
    `13. Persist record [D]: ${requestId}`,
  ];
}

export function mockSearch(req: SearchRequest): SearchResponse {
  const f = match(req);
  const request_id = `req-${Date.now()}`;
  return {
    request_id,
    outcome: f.outcome,
    parts: [
      {
        part: f.intent,
        outcome: f.outcome,
        message: f.message,
        text: f.text,
        owner_team: f.owner_team ?? null,
        citations: f.citations ?? [],
      },
    ],
    trace: buildTrace(req, f, request_id),
    engine: "mock-0.1",
  };
}
