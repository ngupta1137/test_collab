"""Architecture diagram for Verity (1920x1080, 16:9).

    python3 docs/diagrams/build.py      -> architecture.svg
    node docs/diagrams/render.mjs       -> PNGs at 2x (needs playwright-core)

Colors come from src/theme/tokens.css. Font: Source Sans 3.
Concept prototype by Nitin Gupta. Synthetic data.
"""
from pathlib import Path
from xml.sax.saxutils import escape

OUT = Path(__file__).parent

GREEN = "#5EA908"
GREEN_DK = "#4E8416"
INK = "#1F2A24"
MUTED = "#5F6B64"
SURF = "#FFFFFF"
ALT = "#F5F7F4"
BORDER = "#DDE3DA"
PURPLE = "#6B4FA3"
AMBER = "#B26B00"
FONT = "'Source Sans 3', 'Segoe UI', Arial, sans-serif"

W, H = 1920, 1080


def text(x, y, s, size=20, weight=400, fill=INK, anchor="start", italic=False):
    st = ' font-style="italic"' if italic else ""
    return (f'<text x="{x}" y="{y}" font-size="{size}" font-weight="{weight}" fill="{fill}" '
            f'text-anchor="{anchor}"{st}>{escape(s)}</text>')


def rect(x, y, w, h, fill=SURF, stroke=BORDER, sw=1.5, rx=14, dash=None):
    d = f' stroke-dasharray="{dash}"' if dash else ""
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"{d}/>'


def pill(x, y, label, fill, color="#FFFFFF", size=15, pad=12):
    w = int(len(label) * size * 0.58) + 2 * pad
    return (f'<rect x="{x}" y="{y}" width="{w}" height="{size + 14}" rx="{(size + 14) / 2}" fill="{fill}"/>'
            + text(x + w / 2, y + size + 3, label, size, 700, color, "middle")), w


def logo(cx, cy, s=1.0):
    # The Lineage V mark, scaled around its center (source viewBox 0 0 120 120).
    t = f'translate({cx - 60 * s},{cy - 60 * s}) scale({s})'
    return (f'<g transform="{t}"><g stroke-linecap="round" fill="none" stroke-width="9">'
            f'<line x1="60" y1="100" x2="22" y2="22" stroke="{GREEN_DK}"/>'
            f'<line x1="60" y1="100" x2="60" y2="16" stroke="{GREEN_DK}"/>'
            f'<line x1="60" y1="100" x2="98" y2="22" stroke="{GREEN_DK}"/></g>'
            f'<circle cx="22" cy="22" r="8" fill="{GREEN_DK}"/><circle cx="60" cy="16" r="8" fill="{GREEN_DK}"/>'
            f'<circle cx="98" cy="22" r="8" fill="{GREEN_DK}"/><circle cx="60" cy="100" r="13" fill="{GREEN}"/></g>')


def svg(body, title):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" '
            f'font-family="{FONT}" role="img" aria-label="{escape(title)}">'
            f'<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
            f'<path d="M0 0L10 5L0 10z" fill="{MUTED}"/></marker>'
            f'<marker id="arrg" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">'
            f'<path d="M0 0L10 5L0 10z" fill="{GREEN_DK}"/></marker></defs>'
            f'<rect width="{W}" height="{H}" fill="{SURF}"/>{body}</svg>')


CONCEPT = "Verity concept prototype · Synthetic data"



# ---------------------------------------------------------------- architecture
def architecture():
    b = []
    title = "Deterministic where it must be, models only where they help"
    b.append(text(80, 84, title, 44, 700))
    b.append(text(80, 124, "One enforcement layer for people and agents. Models sit at four steps; everything that decides what counts as evidence is deterministic.", 22, 400, MUTED))

    L, R = 80, 1440  # main column
    MW = R - L
    tag_col = {"D": INK, "P": GREEN_DK, "H": PURPLE, "D+P": "#3E5A4A"}

    def tag(x, y, t):
        p, w = pill(x, y, t, tag_col[t], size=14, pad=9)
        return p

    # Band A: consumers
    b.append(text(L, 178, "CHANNELS AND AGENTS", 16, 700, MUTED))
    names = [("Advocate desktop", "typed or spoken query"), ("Member chat", "self-service"), ("Voice (IVR)", "verbatim read exactly"), ("AI agents", "any MCP client")]
    bw = (MW - 3 * 20) / 4
    for i, (n, s) in enumerate(names):
        x = L + i * (bw + 20)
        b.append(rect(x, 192, bw, 78, ALT, BORDER))
        b.append(text(x + bw / 2, 226, n, 21, 700, INK, "middle"))
        b.append(text(x + bw / 2, 254, s, 17, 400, MUTED, "middle"))

    # Band B: interfaces
    half = (MW - 20) / 2
    b.append(rect(L, 300, half, 60, SURF, INK, 1.5))
    b.append(text(L + half / 2, 338, "REST API  ·  channels", 21, 700, INK, "middle"))
    b.append(rect(L + half + 20, 300, half, 60, SURF, INK, 1.5))
    b.append(text(L + half + 20 + half / 2, 338, "MCP adapter  ·  agents (role bound to the connection)", 21, 700, INK, "middle"))
    for i in range(4):
        x = L + i * (bw + 20) + bw / 2
        b.append(f'<line x1="{x}" y1="270" x2="{x}" y2="296" stroke="{MUTED}" stroke-width="1.5" marker-end="url(#arr)"/>')

    # Band C: policy enforcement
    b.append(rect(L, 390, MW, 74, "#EEF5E6", GREEN_DK, 2))
    b.append(text(L + 24, 422, "Policy enforcement", 22, 700, INK))
    b.append(text(L + 24, 450, "same rules for people and agents", 17, 400, MUTED))
    items = ["Identity + entitlements", "PHI redaction", "Safety pre-check", "Reproducibility record"]
    span_x0, span_x1, gap = L + 320, L + MW - 16, 12
    cwid = (span_x1 - span_x0 - 3 * gap) / 4
    for k, it in enumerate(items):
        ix = span_x0 + k * (cwid + gap)
        b.append(rect(ix, 405, cwid, 44, SURF, BORDER, 1.2, 22))
        b.append(text(ix + 16, 434, it, 18, 600, INK))
        b.append(tag(ix + cwid - 38, 414, "D"))
    for x in (L + half / 2, L + half + 20 + half / 2):
        b.append(f'<line x1="{x}" y1="360" x2="{x}" y2="386" stroke="{MUTED}" stroke-width="1.5" marker-end="url(#arr)"/>')

    # Band D: serving pipeline
    b.append(text(L, 508, "SERVING PIPELINE  (13-step trace, steps 7 to 9 run before any generation)", 16, 700, MUTED))
    steps = [("Understand query", "lexicon, speech errors, split parts", "P"),
             ("Search two indexes", "body: entitlement filter in query; routing: title + owner", "D"),
             ("Eligible + applicable", "dates, LOB, state, plan year, channel", "D"),
             ("Authority or conflict", "legal > policy > article; model never picks", "D"),
             ("Compose", "grounded in cited units; verbatim by ID", "P"),
             ("Verify", "exact verbatim, claim support, scope", "D+P")]
    sw_ = (MW - 5 * 14) / 6
    for i, (n, s, t) in enumerate(steps):
        x = L + i * (sw_ + 14)
        y = 522
        b.append(rect(x, y, sw_, 132, SURF, GREEN_DK if t != "D" else BORDER, 2 if t != "D" else 1.5))
        b.append(tag(x + 14, y + 14, t))
        b.append(text(x + 14, y + 72, n, 20, 700))
        words = s.split(" ")
        lines, cur = [], ""
        for wd in words:
            if len(cur) + len(wd) + 1 > 25:
                lines.append(cur)
                cur = wd
            else:
                cur = (cur + " " + wd).strip()
        lines.append(cur)
        for j, ln in enumerate(lines[:2]):
            b.append(text(x + 14, y + 98 + j * 21, ln, 16, 400, MUTED))
        if i < 5:
            b.append(f'<line x1="{x + sw_ + 1}" y1="{y + 66}" x2="{x + sw_ + 13}" y2="{y + 66}" stroke="{MUTED}" stroke-width="1.5" marker-end="url(#arr)"/>')
    b.append(f'<line x1="{L + 3 * (sw_ + 14) - 7}" y1="464" x2="{L + 3 * (sw_ + 14) - 7}" y2="518" stroke="{MUTED}" stroke-width="1.5" marker-end="url(#arr)"/>')
    b.append(text(L + MW / 2 + 12, 494, "", 15))
    # outcomes strip
    outs = [("answer", GREEN_DK), ("needs clarification", "#1F6FB2"), ("insufficient evidence", AMBER), ("conflict", PURPLE), ("stale", "#6F6F6F"), ("not authorized", "#B3261E"), ("safety escalation", "#B3261E")]
    ox = L + 370
    b.append(text(ox, 706, "Outcomes:", 16, 700, MUTED))
    ox += 92
    for o, c in outs:
        p, w = pill(ox, 688, o, c, size=13, pad=8)
        b.append(p)
        ox += w + 6

    # Band E: knowledge supply chain
    b.append(text(L, 752, "KNOWLEDGE SUPPLY CHAIN  (offline)", 16, 700, MUTED))
    chain = [("Source documents", "owners keep the truth", "H"),
             ("Extraction agent", "proposes units, tags, applies_to", "P"),
             ("Dedup + drift check", "any verbatim change is flagged", "D"),
             ("Author + Legal approve", "humans keep publication rights", "H"),
             ("Governed unit store", "versioned, owned, retire-able", "D")]
    cw2 = (MW - 4 * 20) / 5
    for i, (n, s, t) in enumerate(chain):
        x = L + i * (cw2 + 20)
        y = 766
        last = i == 4
        b.append(rect(x, y, cw2, 112, "#EEF5E6" if last else SURF, GREEN_DK if last else BORDER, 2 if last else 1.5))
        if t:
            b.append(tag(x + 16, y + 12, t))
        b.append(text(x + 16, y + 66, n, 20, 700))
        b.append(text(x + 16, y + 92, s, 16, 400, MUTED))
        if i < 4:
            b.append(f'<line x1="{x + cw2 + 2}" y1="{y + 52}" x2="{x + cw2 + 18}" y2="{y + 52}" stroke="{MUTED}" stroke-width="1.5" marker-end="url(#arr)"/>')
    # store feeds search
    sx = L + 4 * (cw2 + 20) + cw2 / 2
    tx = L + 1 * (sw_ + 14) + sw_ / 2
    b.append(f'<path d="M{sx} 766 V738 H{tx} V658" fill="none" stroke="{GREEN_DK}" stroke-width="2.5" marker-end="url(#arrg)"/>')
    b.append(text(sx - 12, 758, "approved units only", 15, 600, GREEN_DK, "end"))

    # Right column
    RX, RW = 1480, 360
    side = [
        (192, 200, "Model gateway", ["Serves every P step", "Provider-agnostic: Sonnet, Haiku today", "Swap a model only if it passes evals", "Cached replies: demo works offline"], "P"),
        (412, 200, "Eval harness + release gates", ["Runs the whole pipeline end to end", "Metrics per slice, not averages", "0 critical failures to release", "Every failure written up"], "D"),
        (632, 246, "Gap analyst", ["Reads search logs + gap queue", "Offline: the one agentic part", "Proposes units + lexicon entries", "Publishes nothing"], "P"),
    ]
    for (y, h, n, lines, t) in side:
        b.append(rect(RX, y, RW, h, ALT, BORDER))
        b.append(tag(RX + RW - 52, y + 14, t))
        b.append(text(RX + 20, y + 40, n, 22, 700))
        for j, ln in enumerate(lines):
            b.append(text(RX + 20, y + 72 + j * 24, ln, 17, 400, MUTED))
    # Legend + footer
    b.append(f'<line x1="80" y1="912" x2="{W - 80}" y2="912" stroke="{BORDER}" stroke-width="1.5"/>')
    lx = 80
    for t, label in [("D", "deterministic"), ("P", "model call"), ("H", "human"), ("D+P", "rule + model check")]:
        p, w = pill(lx, 934, t, tag_col[t], size=14, pad=9)
        b.append(p)
        b.append(text(lx + w + 10, 953, label, 18, 600, MUTED))
        lx += w + 40 + len(label) * 9
    b.append(text(80, 1010, "No supervisor agent at runtime: the workflow is fixed and auditable. Verbatim is never generated.", 24, 700, INK))
    b.append(text(W - 80, 1043, CONCEPT, 16, 400, MUTED, "end"))
    return svg("".join(b), title)


if __name__ == "__main__":
    (OUT / "architecture.svg").write_text(architecture())
    print("wrote architecture.svg")
