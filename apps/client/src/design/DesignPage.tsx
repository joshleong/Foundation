/**
 * The living design language (#/design) — DESIGN.md made visible. Every
 * token, type step, radius, motion curve and effect Foundation uses, rendered
 * from the real tokens so it can't drift. New UI behaviour lands here first.
 */

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { durations, easings, isNight, setNight, springs } from "@foundation/ui";
import { initAsciiWind2 } from "../login/asciiWind2";
import { Mark } from "../login/Login";
import { NightOrb } from "../shell/NightOrb";
import { pipeCrossings, polyline, route, routeSides, sideToward, type Side } from "../shell/wireGeometry";
import { tunnelGeometry } from "../shell/wireGeometry";

const SURFACES = ["void", "abyss", "panel", "raise"];
const INKS = ["frost", "mist", "dim"];
const ACCENTS = ["pulse", "volt", "moss", "agent", "ok", "warn", "bad"];
const TYPE = [
  { size: 32, weight: 600, label: "Display 32", font: "var(--font-display)", sample: "Foundation" },
  { size: 24, weight: 600, label: "Title 24", font: "var(--font-sans)", sample: "Airform Max program" },
  { size: 16, weight: 500, label: "Heading 16", font: "var(--font-sans)", sample: "Fan shroud, rev C" },
  { size: 13, weight: 400, label: "Body 13 (default)", font: "var(--font-sans)", sample: "Noa uploaded the STEP; Vision is simulating the inlet." },
  { size: 12, weight: 500, label: "Control 12", font: "var(--font-sans)", sample: "Open · Run · Connect" },
  { size: 11, weight: 600, label: "Eyebrow 11 · .22em caps", font: "var(--font-sans)", sample: "COMPANY", eyebrow: true },
];

export function DesignPage() {
  const wind = useRef<HTMLDivElement>(null);
  const [replay, setReplay] = useState(0);
  useEffect(() => initAsciiWind2(wind.current!, "wind"), []);

  return (
    <div className="design-page">
      <header className="design-head">
        <Mark size={28} />
        <div>
          <div className="f-eyebrow">Form Industries · one design language</div>
          <h1>Foundation design language</h1>
        </div>
        <div className="capsule-spacer" />
        <NightOrb onToggle={() => setNight(!isNight())} />
        <a className="f-pill" href="#/">
          ← Back to the grid
        </a>
      </header>

      <p className="design-lede">
        Warm printed paper, ink, one federal blue — shared with Vision, the Data Room, FactoryForm and Creation. The work brings the colour; colour means state.
        Agents wear violet. Everything floats on glass over a living grid. This page renders the real tokens; <code>DESIGN.md</code> is the contract.
      </p>

      <Section title="Surfaces" note="Paper by day, navy by night. The orb mixes every token — try it.">
        <div className="swatches">
          {SURFACES.map((s) => (
            <Swatch key={s} name={s} />
          ))}
        </div>
      </Section>

      <Section title="Ink & accents" note="Ink flips hard at the midpoint so contrast holds. One accent; violet only for agents.">
        <div className="swatches">
          {[...INKS, ...ACCENTS].map((s) => (
            <Swatch key={s} name={s} />
          ))}
        </div>
        <div className="swatches viz">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div key={i} className="swatch-chip" style={{ background: `var(--viz-${i})` }} title={`--viz-${i}`} />
          ))}
          <span className="design-note">Data uses --viz-1…8 in order.</span>
        </div>
      </Section>

      <Section title="Type" note="Hanken Grotesk (OFL, bundled). Display prefers Lufga where licensed. Scale 11/12/13/14/16/20/24/32 — no half sizes.">
        <div className="type-ramp">
          {TYPE.map((t) => (
            <div key={t.label} className="type-row">
              <span className="type-label">{t.label}</span>
              <span className={t.eyebrow ? "f-eyebrow" : ""} style={t.eyebrow ? undefined : { font: `${t.weight} ${t.size}px/1.25 ${t.font}`, letterSpacing: t.size >= 24 ? "-0.02em" : undefined }}>
                {t.sample}
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Shape" note="Paper 3 · card 5 · pane 8 · pill 999 — nothing in between; corners stay quiet. Space 2/4/8/12/16/24/32.">
        <div className="shapes">
          {[
            ["paper", "3"],
            ["card", "5"],
            ["pane", "8"],
            ["pill", "999"],
          ].map(([n, v]) => (
            <div key={n} className="shape" style={{ borderRadius: `var(--radius-${n})` }}>
              <b>{n}</b>
              <span>{v}px</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Controls" note="One primary (ink) per bar. Accent blue is for a single forward action; violet means an agent will act.">
        <div className="controls-row">
          <button className="f-pill">Secondary</button>
          <button className="f-pill is-primary">Primary</button>
          <button className="f-pill is-accent">Accent</button>
          <button className="f-pill is-agent">✦ Agent</button>
          <button className="f-pill" disabled>
            Disabled
          </button>
          <span className="f-kbd">⌘K</span>
          <span className="f-dot is-ok is-live" />
          <span className="f-dot is-warn" />
          <span className="f-dot is-bad" />
          <span className="f-dot is-agent" />
        </div>
        <div className="glass-demo">
          <div className="glass-demo-bg" />
          <div className="f-glass glass-demo-pane">
            <div className="f-eyebrow">Glass</div>
            <p>One backdrop-filter per region: blur 18 · saturate 1.4 · fill 72% · edge 14%.</p>
          </div>
        </div>
      </Section>

      <Section title="Motion" note="Springs move things; curves fade things. Overshoot only on arrivals (pop). Delight under 600 ms, only after a real completion.">
        <div className="motion-grid">
          {Object.entries(springs).map(([name, s]) => (
            <div key={name} className="motion-card">
              <motion.div
                key={replay}
                className="motion-ball"
                initial={{ x: 0 }}
                animate={{ x: 180 }}
                transition={{ type: "spring", stiffness: s.stiffness, damping: s.damping, mass: s.mass }}
              />
              <div className="motion-label">
                <b>{name}</b> k{s.stiffness} c{s.damping}
              </div>
            </div>
          ))}
          {Object.entries(easings).map(([name, e]) => (
            <div key={name} className="motion-card">
              <motion.div key={replay} className="motion-ball is-curve" initial={{ x: 0 }} animate={{ x: 180 }} transition={{ duration: durations.rise / 1000, ease: e as unknown as [number, number, number, number] }} />
              <div className="motion-label">
                <b>{name}</b> ({e.join(", ")})
              </div>
            </div>
          ))}
        </div>
        <button className="f-pill" onClick={() => setReplay((r) => r + 1)}>
          Replay
        </button>
      </Section>

      <Section title="Effects" note="ASCII wind (sign-in), the paper shader (grid), agent rings, live wires. Each has a frame budget and a reduced-motion still.">
        <div className="effects">
          <div className="effect-card">
            <div ref={wind} className="effect-wind ascii-wind" data-ascii-wind />
            <a className="effect-label" href="#/design/sign-in">
              ASCII wind · move the cursor, press to ripple · full size ↗
            </a>
          </div>
          <div className="effect-card effect-ring">
            <div className="ring-card">
              <span className="f-dot is-agent is-live" /> Agent working
            </div>
            <div className="effect-label">Agent ring · violet, breathing 2.4 s</div>
          </div>
          <div className="effect-card effect-wire">
            <WireDemo />
            <div className="effect-label">Wires · 45° roads, lanes, and a tunnel where one passes under</div>
          </div>
          <div className="effect-card effect-wire">
            <AppSectionsDemo />
            <div className="effect-label">App sections · neighbours join straight across the gap; apps apart, by one long diagonal from facing edges</div>
          </div>
        </div>
      </Section>

      <Section title="The floor" note="The top bar, the side pane, an open session and search are drawn on the grid's own paper — no glass, no card. The dots run underneath; the cards fade out at the floor's edge, and the view slides over to stay in the middle of what's left. Every pane's inner edge drags to resize.">
        <div className="floor-demo">
          <header className="top-bar">
            <span className="top-btn is-on">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
                <rect x="1.5" y="2.5" width="13" height="11" rx="2.5" />
                <path d="M6 2.5v11" />
              </svg>
            </span>
            <nav className="tabs">
              <span className="tab is-board">
                <span className="tab-main">
                  <span className="tab-glyph">▦</span>
                  <span className="tab-title">Form Industries</span>
                  <span className="f-dot is-ok" />
                </span>
              </span>
              <span className="tab is-agent is-current">
                <span className="tab-main">
                  <span className="tab-glyph is-running">✦</span>
                  <span className="tab-title">Organize the fan work</span>
                </span>
                <span className="tab-close">✕</span>
              </span>
              <span className="tab is-t3">
                <span className="tab-main">
                  <span className="tab-glyph">⌥</span>
                  <span className="tab-title">Heat exchanger viewer</span>
                </span>
              </span>
              <span className="top-btn tab-new">＋</span>
            </nav>
            <div className="top-tools">
              <span className="top-btn is-on">⌕</span>
              <span className="top-btn">⌘</span>
              <span className="top-btn">◇</span>
              <span className="top-btn">▶</span>
            </div>
          </header>
          <aside className="side-pane floor-pane" style={{ width: 200 }}>
            <div className="pane-scroll">
              <section className="pane-group">
                <div className="pane-eyebrow is-agent">Sessions</div>
                <span className="pane-row is-session is-current">
                  <span className="f-dot is-agent is-pulse" />
                  <span className="pane-label">Organize the fan work</span>
                </span>
              </section>
              <section className="pane-group">
                <div className="pane-eyebrow">Vision Code</div>
                <span className="pane-row is-session">
                  <span className="f-dot is-warn" />
                  <span className="pane-label">Heat exchanger viewer</span>
                  <span className="pane-when">1 ask</span>
                </span>
                <span className="pane-row is-session">
                  <span className="f-dot" />
                  <span className="pane-label">Valve gear redesign</span>
                  <span className="pane-when">3d</span>
                </span>
              </section>
            </div>
          </aside>
          <section className="session floor-pane" style={{ left: 200, width: 260 }}>
            <div className="plan">
              <div className="plan-head">
                <span className="pane-eyebrow is-agent">Goal</span>
                <span className="plan-count">1/3</span>
              </div>
              <div className="plan-goal">The fan work in one section, with the open questions on a note.</div>
              <ol className="plan-steps">
                <li className="plan-step is-done"><span className="plan-box">✓</span><span>Make the section</span></li>
                <li className="plan-step is-active is-running"><span className="plan-box" /><span>Move the fan cards in</span></li>
                <li className="plan-step is-pending"><span className="plan-box" /><span>Write the questions</span></li>
              </ol>
            </div>
            <div className="session-list">
              <div className="s-steps">
                <span className="s-step is-ok is-link"><span className="step-dot" /><span className="s-step-name">Added a section</span><span className="s-step-detail">Fan</span><span className="s-step-go">↗</span></span>
                <span className="s-step is-run"><span className="step-dot" /><span className="s-step-name">Updated a card</span></span>
              </div>
            </div>
          </section>
          <div className="floor-demo-grid">
            <div className="floor-demo-card is-touched">Fan · touched by the session</div>
            <div className="floor-demo-card">Rim drive</div>
          </div>
          <aside className="search-pane floor-pane" style={{ width: 210 }}>
            <header className="search-head">
              <span className="search-glyph">⌕</span>
              <span className="search-field">fan</span>
            </header>
            <div className="search-results">
              <span className="search-row">
                <span className="search-row-glyph">▤</span>
                <span className="search-row-main">
                  <span className="search-row-title">fan-v3-shroud.step</span>
                  <span className="search-row-snip">Rim-drive <mark>fan</mark> shroud</span>
                </span>
              </span>
              <span className="search-row">
                <span className="search-row-glyph">◳</span>
                <span className="search-row-main">
                  <span className="search-row-title">FactoryForm</span>
                  <span className="search-row-snip">stations, work orders</span>
                </span>
              </span>
            </div>
          </aside>
        </div>
        <div className="floor-demo-caption">Side pane · a session (goal, steps; its cards ringed on the grid) · search, dragged from onto the grid</div>
      </Section>

      <Section title="Chrome on call" note="The grid runs edge to edge. Everything else waits to be called: search is a small pill at the bottom, a card's bar drops in on hover, and an image's icons slide out from behind it.">
        <div className="oncall-row">
          <div className="oncall-cell">
            <div className="oncall-hud">
              <button className="hud-search f-glass">
                <span className="hud-glyph">⌕</span>
                <span className="hud-label">Search</span>
                <span className="f-kbd">⌘F</span>
              </button>
              <button className="hud-talk f-glass">
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
                  <rect x="5.5" y="1.5" width="5" height="9" rx="2.5" />
                  <path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2" strokeLinecap="round" />
                </svg>
                <span className="f-kbd">V</span>
              </button>
              <button className="hud-zoom f-glass">64%</button>
            </div>
            <div className="effect-label">The search pill, talk (V: what you say goes to the agent) and the zoom</div>
          </div>
          <div className="oncall-cell">
            <div className="oncall-talking">
              <div className="hud-heard f-glass">
                <span className="hud-heard-dot" />
                <span className="hud-heard-text">lay out all the images from Slack about the Airform PTHP</span>
              </div>
              <button className="hud-talk f-glass is-on">
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
                  <rect x="5.5" y="1.5" width="5" height="9" rx="2.5" />
                  <path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div className="effect-label">Talking: the words as they're heard; the pill sends them when you stop (Esc drops them)</div>
          </div>
          <div className="oncall-cell">
            <div className="frame-anchor chrome-bar oncall-static is-hover" style={{ width: 240 }}>
              <div className="frame-card">
                <div className="frame-header" style={{ height: 30 }}>
                  <span className="frame-title">▤ Launch notes</span>
                  <div className="header-actions">
                    <span className="icon-btn">✥</span>
                    <span className="icon-btn">✕</span>
                  </div>
                </div>
                <div className="frame-body oncall-body">Card at rest: no bar. Hover: the bar drops in over the top edge.</div>
              </div>
            </div>
            <div className="effect-label">A card, hovered</div>
          </div>
          <div className="oncall-cell">
            <div className="frame-anchor chrome-icons oncall-static is-hover" style={{ width: 200 }}>
              <div className="frame-icons">
                <span className="frame-icon is-on">♪</span>
                <span className="frame-icon is-remove">✕</span>
              </div>
              <div className="frame-card">
                <div className="frame-body oncall-media" />
              </div>
            </div>
            <div className="effect-label">Video, hovered: a ghost rail carries the pointer out to mute and remove</div>
          </div>
          <div className="oncall-cell">
            <div className="section-card oncall-static oncall-section is-hover" style={{ width: 420, height: 120 }}>
              <div className="section-header" style={{ height: 42 }}>
                <span className="section-name">Design</span>
                <span className="section-coords">B1</span>
                <span className="section-count">3</span>
                <div className="section-tools">
                  <div className="sec-group">
                    <span className="sec-tool">◳</span>
                    <span className="sec-tool">⊞</span>
                    <span className="sec-tool">◍</span>
                    <span className="sec-tool">▤</span>
                    <span className="sec-tool">⇪</span>
                  </div>
                  <div className="sec-group">
                    <span className="sec-tool">◫</span>
                    <span className="sec-tool">⬓</span>
                    <span className="sec-tool">⤢</span>
                  </div>
                  <div className="sec-group">
                    <span className="sec-tool sec-agent">✦</span>
                    <span className="sec-tool">✕</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="f-tip is-on oncall-tip">
              Ask the agent about this section <span className="f-kbd">⌘J</span>
            </div>
            <div className="effect-label">Section, hovered: no bar — tools wait top-right (add · arrange · agent · remove), each names itself on roll-over</div>
          </div>
        </div>
      </Section>

      <Section title="Huddles and Slack" note="A huddle is a video portal at a place on the board: Live (green) while people are in it, REC (red, the one convention read without a legend) while it records, tabs and controls along the bottom because the hover bar covers the top. A Slack card is a channel: posts carry the person's name, ours get a blue rule. Shown at 400 and 560 px; offline says why.">
        <div className="adapt-row">
          {[560, 400].map((w) => (
            <div key={w} className="frame-card live-specimen" style={{ width: w, height: 300 }}>
              <div className="huddle-body">
                <div className="huddle-head">
                  <span className="huddle-status is-live">
                    <span className="f-dot is-ok is-live" />
                    Live · 3
                  </span>
                  <span className="huddle-rec">
                    <span className="huddle-rec-dot" />
                    REC
                  </span>
                  <span className="huddle-channel">Slack</span>
                </div>
                <div className="huddle-stage n-3">
                  {["Josh", "Kai", "Mara"].map((n, i) => (
                    <div key={n} className={`huddle-tile${i === 0 ? " is-self" : ""}`}>
                      <span className="huddle-face is-big">{n[0]}</span>
                      <span className="huddle-name">{i === 0 ? `${n} (you)` : n}</span>
                    </div>
                  ))}
                  <div className="huddle-captions">
                    <b>Kai</b> the clearance is four millimetres
                  </div>
                </div>
                <div className="huddle-controls">
                  <span className="huddle-ctl">●</span>
                  <span className="huddle-ctl is-off">×</span>
                  <span className="huddle-ctl is-rec">
                    <span className="huddle-rec-glyph" />
                  </span>
                  <span className="huddle-ctl-note" />
                  <span className="f-pill huddle-leave">Leave</span>
                  <div className="huddle-tabs">
                    <span className="huddle-tab is-on">Room</span>
                    <span className="huddle-tab">Notes 4</span>
                    <span className="huddle-tab">Archive</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
          <div className="frame-card live-specimen" style={{ width: 400, height: 300 }}>
            <div className="huddle-body">
              <div className="huddle-stage is-empty">
                <div className="huddle-portal">
                  <div className="huddle-empty-title">Nobody's here yet</div>
                  <div className="huddle-empty-note">Join and everyone who looks this way sees you; what's said is transcribed into the archive.</div>
                </div>
              </div>
              <div className="huddle-controls">
                <span className="f-pill is-accent">Start the huddle</span>
                <span className="huddle-ctl-note">Camera and mic stay off until you join</span>
              </div>
            </div>
          </div>
          <div className="frame-card live-specimen" style={{ width: 400, height: 300 }}>
            <div className="huddle-body">
              <div className="huddle-lines">
                <div className="huddle-line is-system">Josh started recording · 4:19 PM</div>
                <div className="huddle-line">
                  <div className="huddle-line-head">
                    <b>Josh</b>
                    <time>4:19 PM</time>
                  </div>
                  <p>Rev C clears the fan by 4 mm — good enough to simulate.</p>
                </div>
                <div className="huddle-line">
                  <div className="huddle-line-head">
                    <b>Kai</b>
                    <time>4:20 PM</time>
                    <i>note</i>
                  </div>
                  <p>Action: I'll send the STEP to Vision for CFD today.</p>
                </div>
              </div>
              <div className="huddle-session-foot">
                <span className="f-pill is-agent">✦ Summarize</span>
                <span className="f-pill">Post notes to Slack</span>
              </div>
            </div>
          </div>
          <div className="frame-card live-specimen" style={{ width: 400, height: 300 }}>
            <div className="slack-body">
              <div className="slack-channel">
                <div className="slack-head">
                  <span className="connector-status is-live">
                    <span className="f-dot is-ok is-live" />
                    Slack
                  </span>
                  <span className="slack-topic">Shrouds, fans and rev C</span>
                </div>
                <div className="slack-messages">
                  <div className="slack-msg">
                    <div className="slack-msg-head">
                      <b>Mara</b>
                      <time>3:18 PM</time>
                    </div>
                    <p>@Kai clearance to the fan looks tight, can we look together?</p>
                  </div>
                  <div className="slack-msg is-ours">
                    <div className="slack-msg-head">
                      <b>Josh via Foundation</b>
                      <time>4:21 PM</time>
                    </div>
                    <p>🎥 Josh invited this channel to a huddle on Foundation.</p>
                  </div>
                </div>
                <div className="slack-actions">
                  <span className="f-pill">↗ Link a place</span>
                  <span className="f-pill">◐ Invite to a huddle</span>
                  <span className="f-pill is-accent slack-send">Send</span>
                </div>
              </div>
            </div>
          </div>
          <div className="frame-card live-specimen" style={{ width: 260, height: 300 }}>
            <div className="slack-body">
              <div className="slack-off">
                <div className="connector-offline">
                  <div className="connector-offline-title">Slack isn't connected</div>
                  <div className="connector-offline-reason">Set SLACK_BOT_TOKEN — create the app from docs/slack-app-manifest.yml</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Writing together" note="Each person keeps their own colour. In a note you're writing in, someone else's caret is a 2 px bar in their colour, named while it moves and quiet once it rests; their selection is a 22 % tint. A note at rest names whoever is writing in it with a breathing chip at the bottom right, clear of the bar that drops in at the top. ⌘Z takes back only your own words.">
        <div className="adapt-row">
          <div className="frame-card" style={{ width: 400 }}>
            <div className="note-inner" style={{ height: 220 }}>
              <div className="note-editor note-caret-mirror" aria-hidden style={{ color: "var(--ink)" }}>
                {"Goals:\n- ship the fan\n"}
                <span className="note-caret" style={{ ["--peer" as string]: "var(--viz-3)" }}>
                  <span className="note-caret-name" style={{ animation: "none" }}>Kai</span>
                </span>
                {"\nRisks:\n- "}
                <mark className="note-peer-sel" style={{ ["--peer" as string]: "var(--viz-5)", color: "var(--ink)" }}>
                  supplier slip
                </mark>
                {"\n"}
              </div>
              <div className="note-editor" style={{ background: "var(--color-abyss)" }} />
            </div>
          </div>
          <div className="frame-card" style={{ width: 260 }}>
            <div className="note-inner" style={{ height: 220 }}>
              <div className="note-writers">
                <span className="note-writer" style={{ ["--peer" as string]: "var(--viz-3)" }}>
                  Kai
                </span>
              </div>
              <div className="note-rendered">
                <p>Goals:</p>
                <ul>
                  <li>ship the fan</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Panels that adapt" note="Design for the narrowest width first; container queries, never the window. Check 260, 400 and 560 px.">
        <div className="adapt-row">
          {[260, 400, 560].map((w) => (
            <div key={w} className="adapt-panel" style={{ width: w }}>
              <div className="adapt-head">
                <span className="f-dot is-ok" /> FactoryForm <span className="adapt-deco">· live</span>
              </div>
              <div className="adapt-metrics">
                <div>
                  <b>$412k</b>
                  <span>on hand</span>
                </div>
                <div>
                  <b>3</b>
                  <span>below reorder</span>
                </div>
                <div className="adapt-secondary">
                  <b>12</b>
                  <span>open POs</span>
                </div>
              </div>
              <div className="adapt-w">{w}px</div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

function Section({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <section className="design-section">
      <div className="design-section-head">
        <h2>{title}</h2>
        <p>{note}</p>
      </div>
      {children}
    </section>
  );
}

function Swatch({ name }: { name: string }) {
  return (
    <div className="swatch">
      <div className="swatch-chip" style={{ background: `var(--color-${name})` }} />
      <code>--color-{name}</code>
    </div>
  );
}

/** The wire rules, drawn by the real router: a forward road, a road heading back round two cards, and the crossing between them. */
function WireDemo() {
  const cardA = { x: 20, y: 30, w: 70, h: 50 };
  const cardB = { x: 250, y: 120, w: 70, h: 50 };
  const cardC = { x: 150, y: 20, w: 70, h: 40 };
  const forward = route({ x: 90, y: 50 }, { x: 250, y: 140 }, { src: cardA, dst: cardB });
  const back = route({ x: 220, y: 40 }, { x: 20, y: 60 }, { src: cardC, dst: cardA, lane: 0 });
  const crossings = pipeCrossings([
    { id: "a-forward", points: forward },
    { id: "b-back", points: back },
  ]);
  const t = tunnelGeometry(forward, crossings.get("a-forward") ?? [], 13);
  return (
    <svg viewBox="0 0 340 200" width="100%" height="200" className="wire-demo">
      {[cardA, cardB, cardC].map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} rx={6} className="wire-demo-card" />
      ))}
      <defs>
        <mask id="demo-tun" maskUnits="userSpaceOnUse" x={0} y={0} width={340} height={200}>
          <rect x={0} y={0} width={340} height={200} fill="white" />
          <path d={t.cut} fill="black" />
        </mask>
      </defs>
      <g className="pipe is-live is-under" style={{ ["--wire-tone" as string]: "var(--viz-2)", ["--pipe-opacity" as string]: 1 }}>
        <path className="pipe-trace" d={polyline(forward)} />
        <g mask="url(#demo-tun)">
          <path className="pipe-lane" d={polyline(forward)} />
          <path className="pipe-wire" d={polyline(forward)} />
          <path className="pipe-pulse" d={polyline(forward)} />
        </g>
        <path className="pipe-terminal" d={t.terminals} />
      </g>
      <g className="pipe is-live" style={{ ["--wire-tone" as string]: "var(--color-pulse)", ["--pipe-opacity" as string]: 1 }}>
        <path className="pipe-lane" d={polyline(back)} />
        <path className="pipe-wire" d={polyline(back)} />
        <path className="pipe-pulse" d={polyline(back)} />
      </g>
    </svg>
  );
}

/** Three app sections and the roads between them, by the real side choice and router. */
function AppSectionsDemo() {
  const A = { x: 10, y: 14, w: 110, h: 70 };
  const B = { x: 130, y: 14, w: 110, h: 70 };
  const C = { x: 200, y: 120, w: 130, h: 70 };
  const land = (r: typeof A, s: Side, at: number) =>
    s === "right" ? { x: r.x + r.w, y: at } : s === "left" ? { x: r.x, y: at } : s === "bottom" ? { x: at, y: r.y + r.h } : { x: at, y: r.y };
  const sab = sideToward(A, B, "right");
  const sba = sideToward(B, A, "left");
  const sac = sideToward(A, C, "right");
  const sca = sideToward(C, A, "left");
  const ab = routeSides(land(A, sab, 50), sab, land(B, sba, 50), sba, { src: A, dst: B });
  const acFrom = land(A, sac, sac === "bottom" ? 60 : 64);
  const acTo = land(C, sca, sca === "top" ? 290 : 160);
  const ac = routeSides(acFrom, sac, acTo, sca, { src: A, dst: C, obstacles: [B] });
  return (
    <svg viewBox="0 0 340 200" width="100%" height="200" className="wire-demo">
      {[A, B, C].map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} rx={8} className="wire-demo-card" />
      ))}
      {[ab, ac].map((pts, i) => (
        <g key={i} className="pipe is-live" style={{ ["--wire-tone" as string]: i ? "var(--viz-3)" : "var(--color-pulse)", ["--pipe-opacity" as string]: 1 }}>
          <path className="pipe-lane" d={polyline(pts)} />
          <path className="pipe-wire" d={polyline(pts)} />
          <path className="pipe-pulse" d={polyline(pts)} />
        </g>
      ))}
    </svg>
  );
}
