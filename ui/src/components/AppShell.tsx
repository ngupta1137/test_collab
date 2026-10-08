import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { VerityLogo } from "./VerityLogo";
import { PERSONAS, useSession } from "@/lib/session";

const NAV = [
  { to: "/", label: "Ask" },
  { to: "/author", label: "Author" },
  { to: "/evals", label: "Evals" },
  { to: "/agents", label: "Agents" },
] as const;

function Switchers() {
  const { persona, channel, setPersona, setChannel, allowedChannels } = useSession();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor="persona">Persona</label>
      <select id="persona" className="field-select" value={persona.id} onChange={(e) => setPersona(e.target.value)}>
        {PERSONAS.map((p) => (
          <option key={p.id} value={p.id}>{p.name}, {p.label}</option>
        ))}
      </select>
      <label className="sr-only" htmlFor="channel">Channel</label>
      <select id="channel" className="field-select" value={channel} onChange={(e) => setChannel(e.target.value)}>
        {allowedChannels.map((c) => (
          <option key={c.id} value={c.id}>{c.label}</option>
        ))}
      </select>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-surface text-ink">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-3">
          <Link to="/" className="flex items-center gap-2">
            <VerityLogo />
            <span className="text-xl font-semibold tracking-tight">Verity</span>
          </Link>
          <Switchers />
        </div>
        <nav className="mx-auto flex max-w-6xl gap-6 px-6">
          {NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              activeOptions={{ exact: true }}
              className="border-b-2 border-transparent py-2 text-sm text-ink-muted hover:text-ink"
              activeProps={{ className: "!border-brand-green-dark !text-brand-green-dark font-semibold" }}
            >
              {n.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">{children}</main>
      <footer className="border-t border-border bg-surface-alt">
        <p className="mx-auto max-w-6xl px-6 py-4 text-sm text-ink-muted">
          Concept prototype by Nitin Gupta · Synthetic data
        </p>
      </footer>
    </div>
  );
}

export function PagePlaceholder({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <section>
      <h1 className="text-2xl font-semibold">{title}</h1>
      <div className="mt-6">{children}</div>
    </section>
  );
}
