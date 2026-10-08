// Verity REST API for channels (advocate desktop, chat, telephony).
// Same VerityService as the MCP adapter. No framework, no dependencies.
//
//   node rest/server.ts            # http://localhost:8787
//
// Identity: X-Verity-Role and X-Verity-Principal headers stand in for an
// OAuth/JWT token validated at the gateway. Prototype only.

import { createServer, type IncomingMessage } from 'node:http';
import { pathToFileURL } from 'node:url';
import { VerityService, type Identity } from '../src/service/service.ts';
import { findRoot } from '../src/service/root.ts';

const root = findRoot(import.meta.url);
const service = new VerityService(root, process.env.VERITY_RUNTIME_DIR || undefined);
const PORT = Number(process.env.PORT ?? 8787);

async function body(req: IncomingMessage): Promise<any> {
  let s = '';
  for await (const chunk of req) s += chunk;
  return s ? JSON.parse(s) : {};
}

export const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Verity-Role, X-Verity-Principal');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();

  const send = (code: number, x: unknown) => res.writeHead(code, { 'Content-Type': 'application/json' }).end(JSON.stringify(x));
  const url = new URL(req.url ?? '/', 'http://localhost');
  const role = req.headers['x-verity-role'];
  if (!role || Array.isArray(role)) return send(401, { error: 'missing identity (X-Verity-Role)' });
  const id: Identity = { role, principal: String(req.headers['x-verity-principal'] ?? `user:${role}`) };

  try {
    if (req.method === 'POST' && url.pathname === '/v1/search') {
      const b = await body(req);
      if (!b.query || !b.channel) return send(400, { error: 'query and channel are required' });
      return send(200, await service.searchAsync(id, 'rest', b));
    }
    const unitMatch = url.pathname.match(/^\/v1\/units\/([\w-]+)$/);
    if (req.method === 'GET' && unitMatch) {
      const v = url.searchParams.get('version');
      return send(200, service.getUnit(id, 'rest', unitMatch[1], v ? Number(v) : undefined));
    }
    if (req.method === 'POST' && url.pathname === '/v1/gaps') {
      const b = await body(req);
      return send(201, service.reportGap(id, 'rest', String(b.query ?? ''), b.context ?? {}));
    }
    if (req.method === 'GET' && url.pathname === '/v1/changes') {
      return send(200, service.listChanges(id, 'rest', url.searchParams.get('since') ?? '1970-01-01'));
    }
    if (req.method === 'GET' && url.pathname === '/v1/calls') {
      return send(200, service.callLog(Number(url.searchParams.get('limit') ?? 50)));
    }
    return send(404, { error: 'not found' });
  } catch (e) {
    return send(400, { error: (e as Error).message });
  }
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  server.listen(PORT, () => console.log(`Verity REST on http://localhost:${PORT}`));
}
