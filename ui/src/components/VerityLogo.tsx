export function VerityLogo({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" className={className} aria-hidden="true">
      <g className="stroke-brand-green-dark" strokeWidth={9} strokeLinecap="round">
        <line x1="60" y1="100" x2="22" y2="22" />
        <line x1="60" y1="100" x2="60" y2="16" />
        <line x1="60" y1="100" x2="98" y2="22" />
      </g>
      <g className="fill-brand-green-dark">
        <circle cx="22" cy="22" r="8" />
        <circle cx="60" cy="16" r="8" />
        <circle cx="98" cy="22" r="8" />
      </g>
      <circle cx="60" cy="100" r="13" className="fill-brand-green" />
    </svg>
  );
}
