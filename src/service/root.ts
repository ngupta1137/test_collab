// Find the repo root (the folder holding data/units_seed.json) no matter
// where the process was started from. Claude Desktop launches MCP servers
// from its own working directory, and the bundled server lives in mcp/dist/.
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function findRoot(fromUrl: string): string {
  if (process.env.VERITY_ROOT) return resolve(process.env.VERITY_ROOT);
  let dir = dirname(fileURLToPath(fromUrl));
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, 'data', 'units_seed.json'))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  throw new Error('Verity data not found. Set VERITY_ROOT to the repo folder.');
}
