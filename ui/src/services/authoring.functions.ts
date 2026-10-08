// Server functions for the Author page. The engine runs on the server; the
// browser only sends text and decisions, and gets views back.
import { createServerFn } from "@tanstack/react-start";
import type { AccessRequest, ActionResult, AuthoringState, DecideRequest, IngestView } from "./authoring";

export const getAuthoring = createServerFn({ method: "GET" }).handler(async (): Promise<AuthoringState> => {
  const { authoringState } = await import("../verity-engine/authoring.ts");
  return authoringState();
});

export const ingestSourceFn = createServerFn({ method: "POST" })
  .validator((d: { text: string }) => d)
  .handler(async ({ data }): Promise<IngestView> => {
    const { ingestSource } = await import("../verity-engine/authoring.ts");
    return ingestSource(data.text);
  });

export const proposeFn = createServerFn({ method: "POST" })
  .validator((d: { text: string; cids: string[] }) => d)
  .handler(async ({ data }): Promise<ActionResult> => {
    const { proposeCandidates } = await import("../verity-engine/authoring.ts");
    return proposeCandidates(data.text, Array.isArray(data.cids) ? data.cids.map(String) : []);
  });

export const decideFn = createServerFn({ method: "POST" })
  .validator((d: DecideRequest) => d)
  .handler(async ({ data }): Promise<ActionResult> => {
    const { decide } = await import("../verity-engine/authoring.ts");
    return decide(data);
  });

export const proposeGapFn = createServerFn({ method: "POST" })
  .validator((d: { cluster_id: string; title: string; body: string }) => d)
  .handler(async ({ data }): Promise<ActionResult> => {
    const { proposeGap } = await import("../verity-engine/authoring.ts");
    return proposeGap(data);
  });

export const claimGapFn = createServerFn({ method: "POST" })
  .validator((d: { cluster_id: string; by: string }) => d)
  .handler(async ({ data }): Promise<ActionResult> => {
    const { claimGap } = await import("../verity-engine/authoring.ts");
    return claimGap(data.cluster_id, data.by);
  });

export const claimReviewFn = createServerFn({ method: "POST" })
  .validator((d: { item_id: string; by: string }) => d)
  .handler(async ({ data }): Promise<ActionResult> => {
    const { claimReview } = await import("../verity-engine/authoring.ts");
    return claimReview(data.item_id, data.by);
  });

export const resetDemoFn = createServerFn({ method: "POST" }).handler(async (): Promise<ActionResult> => {
  const { resetDemo } = await import("../verity-engine/authoring.ts");
  return resetDemo();
});

export const accessFn = createServerFn({ method: "POST" })
  .validator((d: AccessRequest) => d)
  .handler(async ({ data }): Promise<ActionResult> => {
    const { changeAccess } = await import("../verity-engine/authoring.ts");
    return changeAccess(data);
  });
