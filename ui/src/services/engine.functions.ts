// Server functions: the browser calls these; the engine runs on the server.
import { createServerFn } from '@tanstack/react-start';
import type { SearchRequest, SearchResponse } from './verity';

export const runSearch = createServerFn({ method: 'POST' })
  .validator((d: SearchRequest) => d)
  .handler(async ({ data }): Promise<SearchResponse> => {
    const { serveEngine } = await import('../verity-engine/server.ts');
    return serveEngine(data);
  });

export interface DriftResult {
  flag: boolean;
  kind: string;
  impact: string;
  diff: string[];
  route_to: string;
  similarity: number;
}

export const runDrift = createServerFn({ method: 'POST' })
  .validator((d: { before: string; after: string; verbatim: boolean }) => d)
  .handler(async ({ data }): Promise<DriftResult> => {
    const { checkChange } = await import('../verity-engine/drift.ts');
    const r = checkChange(data.before, data.after, data.verbatim);
    return { flag: r.flag, kind: r.kind, impact: r.impact, diff: r.diff, route_to: r.route_to, similarity: r.similarity };
  });
