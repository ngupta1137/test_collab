// Model gateway: the ONLY place Verity talks to a model provider.
// Provider-agnostic interface, per-task model routing, and a response cache
// that doubles as the offline demo fallback (CLAUDE.md).
//
// Modes (VERITY_MODEL_MODE):
//   off         default. No model calls; the deterministic baseline runs.
//   live        call the provider; write every reply to cache/.
//   cache-only  replay cache/ only; a miss behaves like "off" for that call.
//
// Key: VERITY_ANTHROPIC_KEY, server-side only. Deliberately NOT
// ANTHROPIC_API_KEY, so the terminal used for Claude Code stays on the Pro plan.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type Task = 'query' | 'compose' | 'judge';
export type Mode = 'off' | 'live' | 'cache-only';

export interface ModelRequest {
  task: Task;
  system: string;
  user: string;
  maxTokens: number;
}

export interface ModelReply {
  text: string;
  model: string;
  source: 'live' | 'cache' | 'mock';
  inputTokens?: number;
  outputTokens?: number;
}

export interface Provider {
  name: string;
  complete(model: string, req: ModelRequest): Promise<Omit<ModelReply, 'source' | 'model'>>;
}

// Defaults per CLAUDE.md: Haiku for query understanding and the judge, Sonnet for answers.
const DEFAULT_MODELS: Record<Task, string> = {
  query: process.env.VERITY_MODEL_QUERY ?? 'claude-haiku-4-5',
  judge: process.env.VERITY_MODEL_JUDGE ?? 'claude-haiku-4-5',
  compose: process.env.VERITY_MODEL_COMPOSE ?? 'claude-sonnet-5-5',
};

export class AnthropicProvider implements Provider {
  name = 'anthropic';
  private key: string;
  constructor(key: string) {
    this.key = key;
  }
  async complete(model: string, req: ModelRequest) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        // Only needed for keys that are not scoped to a workspace.
        ...(process.env.VERITY_ANTHROPIC_WORKSPACE ? { 'anthropic-workspace-id': process.env.VERITY_ANTHROPIC_WORKSPACE } : {}),
      },
      body: JSON.stringify({ model, max_tokens: req.maxTokens, temperature: 0, system: req.system, messages: [{ role: 'user', content: req.user }] }),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const j: any = await res.json();
    const text = (j.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
    return { text, inputTokens: j.usage?.input_tokens, outputTokens: j.usage?.output_tokens };
  }
}

export class Gateway {
  readonly mode: Mode;
  private provider: Provider | null;
  private cacheDir: string;
  private models: Record<Task, string>;
  calls = { live: 0, cache: 0, miss: 0, errors: 0, inputTokens: 0, outputTokens: 0 };

  constructor(opts: { root: string; mode?: Mode; provider?: Provider | null; models?: Partial<Record<Task, string>> }) {
    this.mode = opts.mode ?? ((process.env.VERITY_MODEL_MODE as Mode) || 'off');
    this.cacheDir = join(opts.root, 'cache');
    this.models = { ...DEFAULT_MODELS, ...(opts.models ?? {}) };
    const key = process.env.VERITY_ANTHROPIC_KEY;
    this.provider = opts.provider !== undefined ? opts.provider : key ? new AnthropicProvider(key) : null;
    if (this.mode === 'live' && !this.provider) throw new Error('VERITY_MODEL_MODE=live needs VERITY_ANTHROPIC_KEY');
  }

  get enabled(): boolean {
    return this.mode !== 'off';
  }

  modelFor(task: Task): string {
    return this.models[task];
  }

  private key(model: string, req: ModelRequest): string {
    return createHash('sha256').update(JSON.stringify([model, req.system, req.user, req.maxTokens])).digest('hex').slice(0, 24);
  }

  /** One tiny live call before a run, so a bad key or model name stops the run instead of silently falling back. */
  async preflight(): Promise<void> {
    if (this.mode !== 'live' || !this.provider) return;
    try {
      await this.provider.complete(this.modelFor('query'), { task: 'query', system: 'Reply with OK.', user: 'ping', maxTokens: 5 });
    } catch (e) {
      throw new Error(`model preflight failed, nothing was run: ${(e as Error).message}`);
    }
  }

  /** Returns null when the model is off, the cache misses in cache-only mode, or the call fails. Callers fall back to the baseline. */
  async complete(req: ModelRequest): Promise<ModelReply | null> {
    if (this.mode === 'off') return null;
    const model = this.modelFor(req.task);
    const k = this.key(model, req);
    const file = join(this.cacheDir, `${req.task}-${k}.json`);
    if (existsSync(file)) {
      this.calls.cache++;
      const c = JSON.parse(readFileSync(file, 'utf8'));
      return { text: c.text, model: c.model, source: 'cache' };
    }
    if (this.mode === 'cache-only' || !this.provider) {
      this.calls.miss++;
      return null;
    }
    try {
      const r = await this.provider.complete(model, req);
      this.calls.live++;
      this.calls.inputTokens += r.inputTokens ?? 0;
      this.calls.outputTokens += r.outputTokens ?? 0;
      mkdirSync(this.cacheDir, { recursive: true });
      writeFileSync(file, JSON.stringify({ model, task: req.task, text: r.text, at: new Date().toISOString() }, null, 2));
      return { text: r.text, model, source: this.provider.name === 'mock' ? 'mock' : 'live', inputTokens: r.inputTokens, outputTokens: r.outputTokens };
    } catch (e) {
      this.calls.errors++;
      console.error(`gateway: ${(e as Error).message}`);
      return null;
    }
  }
}
