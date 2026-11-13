/**
 * The agents pane, on the right (it takes search's place; search takes its).
 * A section's agent group, opened large: every agent at work on the board, by
 * the section it's in, with what it's doing, the ask it's on, and whether it
 * works with anyone.
 *
 * Working together is shown, not just said: a lead and the helpers it called
 * in are one block, held by a rule in the lead's colour, lead first. Agents on
 * separate asks in one section stand apart, and the section's heading says
 * how many teams met there.
 *
 * The section the pane was opened from is listed first (and stays listed while
 * it's empty, so the pane you opened answers the question you asked). Press a
 * section's name to go to it; Follow rides your view along with an agent;
 * Open and Stop are for the ones you asked.
 */

import { useSyncExternalStore } from "react";
import { crewTeams, togetherWords, type CrewTeam } from "../lib/sectionCrew";
import { crewSection, useCrew } from "../lib/crewWatch";
import { CrewFaceView, type CrewFace } from "../components/SectionCrew";
import { getState, requestSnap, subscribe } from "../state/store";
import { crewAsk, stopSession, titleOf, useSession } from "../state/sessions";
import { WIDTHS, openSession, setUi, useUi } from "../state/ui";
import { followCrew, useFollowing, type CrewPeer } from "./Crew";
import { FloorEdge } from "./FloorEdge";
import { useActiveBoard } from "./Presence";

export interface AgentRowData extends CrewFace {
  task: string;
  mine: boolean;
}

export interface AgentsPlace {
  /** a section's id; null: agents that haven't aimed anywhere yet */
  id: string | null;
  name: string;
  /** the section the pane was opened from */
  at: boolean;
  teams: CrewTeam<AgentRowData>[];
}

const allSectionsOf = () => getState().allSections;

const rowOf = (p: CrewPeer, me: string | undefined): AgentRowData => ({
  id: p.crew.id,
  name: p.user.name,
  hue: p.crew.hue,
  status: p.crew.status,
  doing: p.crew.doing,
  askerName: p.crew.askerName,
  lead: p.crew.lead,
  leadName: p.crew.leadName,
  task: p.crew.task,
  mine: p.crew.asker === me,
});

/** the agents by where they are: the section asked about first, then sections in the order agents came to them */
export function agentPlaces(rows: Array<{ row: AgentRowData; section: string | null }>, names: (id: string) => string | undefined, at: string | null): AgentsPlace[] {
  const by = new Map<string | null, AgentRowData[]>();
  if (at && names(at) !== undefined) by.set(at, []);
  for (const r of rows) {
    const list = by.get(r.section) ?? [];
    list.push(r.row);
    by.set(r.section, list);
  }
  const places = [...by.entries()].map(([id, list]) => ({
    id,
    name: id ? (names(id) ?? "A section") : "Not in a section yet",
    at: id !== null && id === at,
    teams: crewTeams(list, (r) => ({ id: r.id, lead: r.lead, target: null })),
  }));
  // the ones still finding their place go last
  return [...places.filter((p) => p.id !== null), ...places.filter((p) => p.id === null)];
}

export function AgentsPane() {
  const ui = useUi();
  const board = useActiveBoard();
  const crew = useCrew();
  const sections = useSyncExternalStore(subscribe, allSectionsOf);
  if (!ui.agents || ui.presenting) return null;
  const me = board?.user.id;
  const places = agentPlaces(
    crew.map((p) => ({ row: rowOf(p, me), section: crewSection(p) })),
    (id) => sections[id]?.name,
    ui.agentsAt,
  );
  return (
    <aside className="agents-pane floor-pane" style={{ width: ui.agentsW }} aria-label="Agents">
      <FloorEdge side="left" value={ui.agentsW} {...WIDTHS.agents} onChange={(w) => setUi({ agentsW: w })} label="Agents" />
      <AgentsPaneBody places={places} count={crew.length} onClose={() => setUi({ agents: false })} onGo={(id) => requestSnap({ kind: "section", id })} live />
    </aside>
  );
}

/** the pane's contents, for the pane and the design page */
export function AgentsPaneBody({ places, count, onClose, onGo, live = false }: { places: AgentsPlace[]; count: number; onClose?: () => void; onGo?: (sectionId: string) => void; live?: boolean }) {
  return (
    <>
      <header className="agents-head">
        Agents
        <span className="agents-head-n">{count === 0 ? "none at work" : `${count} on the board`}</span>
        <button className="top-btn" onClick={onClose} aria-label="Close the agents pane" data-tip="Close">
          ✕
        </button>
      </header>
      <div className="agents-scroll">
        {count === 0 && places.length === 0 && (
          <p className="agents-empty">
            No agents are at work on this board. Hold <span className="f-kbd">Space</span> and say what you need: the agent that takes it shows here, in the section it works in.
          </p>
        )}
        {places.map((place) => {
          const n = place.teams.reduce((a, t) => a + t.members.length, 0);
          const words = togetherWords(place.teams);
          return (
            <section key={place.id ?? "nowhere"} className={`agents-place${place.at ? " is-at" : ""}`} data-agents-place={place.name}>
              <div className="agents-place-head">
                <button className="agents-place-name" disabled={!place.id || !onGo} onClick={() => place.id && onGo?.(place.id)} data-tip={place.id ? "Go to this section" : undefined}>
                  {place.name}
                </button>
                <span className="agents-place-words">{n === 0 ? "" : words || "1 agent"}</span>
              </div>
              {n === 0 && <div className="agents-place-none">No agents here. One that comes in joins this group.</div>}
              {place.teams.map((t) => (
                <ul key={t.id} className={`agents-team${t.together ? " is-together" : ""}`} style={{ ["--crew" as string]: `var(--color-crew-${t.members[0].hue % 6})` }}>
                  {t.together && (
                    <li className="agents-team-label">
                      Working together <span>· one ask{t.members[0].askerName ? `, for ${t.members[0].askerName.split(" ")[0]}` : ""}</span>
                    </li>
                  )}
                  {t.members.map((m) => (live ? <LiveAgentRow key={m.id} row={m} team={t} /> : <AgentRow key={m.id} row={m} team={t} />))}
                </ul>
              ))}
            </section>
          );
        })}
      </div>
    </>
  );
}

/** what an agent is to its team, in a word or two */
function roleOf(row: AgentRowData, team: CrewTeam<AgentRowData>): string {
  if (row.lead) return team.members.some((m) => m.id === row.lead) ? "helper" : `helper of ${row.leadName ?? "another agent"}`;
  return team.together ? "lead" : row.mine ? "yours" : row.askerName ? `for ${row.askerName.split(" ")[0]}` : "";
}

export function AgentRow({ row, team, acts }: { row: AgentRowData; team: CrewTeam<AgentRowData>; acts?: React.ReactNode }) {
  const role = roleOf(row, team);
  return (
    <li className={`agent-row is-${row.status}`} style={{ ["--crew" as string]: `var(--color-crew-${row.hue % 6})` }} data-agent-row={row.name}>
      <CrewFaceView face={row} size="large" />
      <div className="agent-row-main">
        <div>
          <span className="agent-row-name">{row.name}</span>
          {role && <span className="agent-row-role">{role}</span>}
        </div>
        <div className="agent-row-doing">{row.status === "working" ? row.doing || "working" : row.status === "done" ? "done" : row.status === "stopped" ? "stopped" : "hit a problem"}</div>
      </div>
      {row.task && !row.lead && <div className="agent-row-task">Asked: {titleOf(row.task)}</div>}
      {row.task && row.lead && <div className="agent-row-task">Its part: {titleOf(row.task)}</div>}
      <div className="agent-row-acts">{acts}</div>
    </li>
  );
}

function LiveAgentRow({ row, team }: { row: AgentRowData; team: CrewTeam<AgentRowData> }) {
  const ask = crewAsk(row.id);
  const run = useSession(ask?.session ?? null);
  const busy = run.busy && row.status === "working";
  const following = useFollowing() === row.id;
  return (
    <AgentRow
      row={row}
      team={team}
      acts={
        <>
          {row.status === "working" && (
            <button className={`crew-row-btn${following ? " is-on" : ""}`} onClick={() => followCrew(following ? null : row.id)} data-tip={following ? "Stop following" : `Follow ${row.name}: your view rides along until you move`}>
              {following ? "Following" : "Follow"}
            </button>
          )}
          {row.mine && ask && (
            <button className="crew-row-btn" onClick={() => openSession({ id: ask.session, kind: "agent", title: titleOf(ask.prompt) })} data-tip="Open its session: what it did, step by step">
              Open
            </button>
          )}
          {row.mine && ask && busy && (
            <button className="crew-row-btn is-stop" onClick={() => stopSession(ask.session)} data-tip={`Stop ${row.name}`}>
              Stop
            </button>
          )}
        </>
      }
    />
  );
}
