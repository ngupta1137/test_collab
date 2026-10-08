import { describe, expect, it } from "vitest";
import { mockSearch } from "@/services/mockData";

const base = { role: "pharmacy_advocate", channel: "advocate_view" };

describe("mock search fixtures", () => {
  it("pricing disclaimer is not authorized for insurance advocates", () => {
    const r = mockSearch({ ...base, role: "insurance_advocate", query: "Pricing Disclaimer" });
    expect(r.outcome).toBe("not_authorized");
    expect(r.parts[0]?.owner_team).toBe("Compliance");
  });
  it("copay needs a state, answers for KY, gap for others", () => {
    expect(mockSearch({ ...base, query: "copay" }).outcome).toBe("needs_clarification");
    expect(mockSearch({ ...base, query: "copay", state: "KY" }).outcome).toBe("answer");
    expect(mockSearch({ ...base, query: "copay", state: "FL" }).outcome).toBe("insufficient_evidence");
  });
  it("safety escalation stops trace after step 3", () => {
    const r = mockSearch({ ...base, query: "I have chest pain" });
    expect(r.outcome).toBe("safety_escalation");
    expect(r.trace).toHaveLength(3);
  });
  it("normal answers have a 13-step trace", () => {
    expect(mockSearch({ ...base, query: "how long does mail take" }).trace).toHaveLength(13);
  });
  it("unknown query is a gap", () => {
    expect(mockSearch({ ...base, query: "weather" }).outcome).toBe("insufficient_evidence");
  });
});
