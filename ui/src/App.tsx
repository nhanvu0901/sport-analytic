import { useEffect, useMemo, useState } from 'react';
import { api, subscribeJob } from './api';
import type { Candidate, Coverage, GateVerdict, Gates, LedgerRecord, Session } from './types';

type Screen = 'discover' | 'ledger';
type HealthKeys = { youcom: boolean; gemini: boolean; tavily: boolean };
type Angles = { evergreen: string[]; newsy: string[]; next: { evergreen: string; newsy: string } };

const GATE_LABEL: Record<keyof Gates, string> = {
  g0_burned: 'not a re-skin of something already done',
  g1_real_question: 'real fans are asking this, with cited evidence',
  g3_data_available: 'the stat is available in the box score',
  g4_chart_fit: 'fits an existing chart type',
};

const gateClass = (v: GateVerdict) => (v === 'pass' ? 'gate gate-pass' : v === 'fail' ? 'gate gate-fail' : 'gate gate-pending');

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function HealthDot({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span className="health-dot" title={`${label}: ${ok ? 'key present' : 'no key'}`}>
      <span className={`dot ${ok ? 'dot-ok' : 'dot-off'}`} />
      {label}
    </span>
  );
}

/** A gate's own note (when present) makes a better tooltip than the generic
 *  label — it explains WHY this specific candidate failed, not just what the
 *  gate checks. */
function GateRow({ gates, notes }: { gates: Gates; notes?: Partial<Record<keyof Gates, string>> }) {
  return (
    <div className="gate-row">
      {(Object.keys(gates) as (keyof Gates)[]).map((k) => (
        <span key={k} className={gateClass(gates[k])} title={notes?.[k] ?? `${k}: ${GATE_LABEL[k]} — ${gates[k]}`}>
          {k.slice(0, 2)}
        </span>
      ))}
    </div>
  );
}

const hasFailedGate = (c: Candidate) => (Object.keys(c.gates) as (keyof Gates)[]).some((k) => c.gates[k] === 'fail');

/** Coverage is a note, never a verdict — its own small mono line, never the
 *  gate-fail styling, and it never dims the card or disables Accept. Only
 *  the matched title is a link; the rest of the note is plain text. */
function CoverageLine({ coverage }: { coverage?: Coverage }) {
  if (!coverage) return null;
  if (coverage.topTitle) {
    const scoreStr = coverage.score !== undefined ? coverage.score.toFixed(2) : '?';
    return (
      <div className="coverage-line mono" title={coverage.note}>
        coverage · {coverage.checked} similar videos on YouTube; closest ({scoreStr}):{' '}
        {coverage.topUrl ? (
          <a href={coverage.topUrl} target="_blank" rel="noreferrer">
            {coverage.topTitle}
          </a>
        ) : (
          coverage.topTitle
        )}
      </div>
    );
  }
  return (
    <div className="coverage-line mono" title={coverage.note}>
      coverage · {coverage.note}
    </div>
  );
}

function CandidateCard({
  candidate,
  accepted,
  onDecide,
}: {
  candidate: Candidate;
  accepted: boolean;
  onDecide: (candidateId: string, decision: 'accept' | 'reject', note?: string) => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const gated = hasFailedGate(candidate); // dimming/Accept-disable is driven only by 'fail' — 'pending' still needs a look, not a block
  const noteworthyGates = (Object.keys(candidate.gates) as (keyof Gates)[]).filter(
    (k) => candidate.gates[k] !== 'pass' && candidate.gate_notes?.[k]
  );

  return (
    <div className={`card ${accepted ? 'card-accepted' : ''} ${gated ? 'card-gated' : ''}`}>
      {accepted && <div className="ribbon">ACCEPTED</div>}
      {candidate.burned_by && <div className="banner-warn">Collides with: {candidate.burned_by}</div>}
      <h3 className="card-question">{candidate.question}</h3>
      <div className="chip-row">
        <span className="chip chip-lane">{candidate.lane}</span>
        <span className="chip">{candidate.freshness}</span>
        <span className="chip">{candidate.angle}</span>
      </div>
      <p className="card-why">{candidate.why_fans_argue}</p>
      <p className="card-measure">settled by: {candidate.measurable_as}</p>
      {candidate.entities.length > 0 && (
        <div className="chip-row">
          {candidate.entities.map((e) => (
            <span key={e} className="chip chip-entity">
              {e}
            </span>
          ))}
        </div>
      )}
      {candidate.evidence_urls.length > 0 && (
        <div className="evidence-row">
          {candidate.evidence_urls.map((u) => (
            <a key={u} href={u} target="_blank" rel="noreferrer" className="evidence-link" title={u}>
              {hostOf(u)}
            </a>
          ))}
        </div>
      )}
      <GateRow gates={candidate.gates} notes={candidate.gate_notes} />
      <CoverageLine coverage={candidate.coverage} />
      {noteworthyGates.length > 0 && (
        <div className="gate-fail-lines">
          {noteworthyGates.map((k) => {
            const gateNote = candidate.gate_notes?.[k] ?? '';
            const link = candidate.gate_links?.[k];
            const isPending = candidate.gates[k] === 'pending';
            const full = `${k.slice(0, 2)} · ${gateNote}`;
            return (
              <div key={k} className={`gate-fail-line ${isPending ? 'gate-pending-line' : ''}`} title={full}>
                {k.slice(0, 2)} ·{' '}
                {link ? (
                  <a href={link} target="_blank" rel="noreferrer">
                    {gateNote}
                  </a>
                ) : (
                  gateNote
                )}
              </div>
            );
          })}
        </div>
      )}
      {!accepted && (
        <div className="card-actions">
          <button
            className="btn btn-good"
            disabled={gated}
            title={gated ? 'A gate failed — reject it, or refine the search.' : undefined}
            onClick={() => onDecide(candidate.id, 'accept')}
          >
            Accept
          </button>
          <button className="btn btn-danger" onClick={() => setRejecting((v) => !v)}>
            Reject
          </button>
        </div>
      )}
      {rejecting && (
        <div className="reject-box">
          <textarea
            placeholder="Why? (saved as LESSON)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
          />
          <button
            className="btn btn-danger"
            disabled={!note.trim()}
            onClick={() => {
              onDecide(candidate.id, 'reject', `LESSON: ${note.trim()}`);
              setRejecting(false);
              setNote('');
            }}
          >
            Confirm reject
          </button>
        </div>
      )}
    </div>
  );
}

function DiscoverScreen({ health, angles }: { health: { ok: boolean; keys: HealthKeys } | null; angles: Angles | null }) {
  const [lanes, setLanes] = useState({ evergreen: true, newsy: true });
  const [intent, setIntent] = useState('');
  const [session, setSession] = useState<Session | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [refineText, setRefineText] = useState('');
  const [jobError, setJobError] = useState<string | null>(null);

  const refreshSessions = () => api.sessions().then(setSessions).catch(() => {});
  useEffect(() => {
    refreshSessions();
  }, []);

  const loadSession = (id: string) => api.session(id).then(({ session, candidates }) => {
    setSession(session);
    setCandidates(candidates);
  });

  const runJob = (jobId: string, sessionId: string) => {
    setRunning(true);
    setLog([]);
    setJobError(null);
    subscribeJob(
      jobId,
      (line) => setLog((l) => [...l, line]),
      (done) => {
        setRunning(false);
        if (done.status === 'failed') setJobError(done.error || 'discovery failed');
        loadSession(sessionId);
        refreshSessions();
      }
    );
  };

  const findIdeas = () => {
    const selected = (['evergreen', 'newsy'] as const).filter((l) => lanes[l]);
    if (selected.length === 0 || running) return;
    api.createSession(selected, intent.trim() || undefined).then(({ session, jobId }) => {
      setSession(session);
      setCandidates([]);
      runJob(jobId, session.id);
    });
  };

  const refine = () => {
    if (!session || !refineText.trim() || running) return;
    api.rerun(session.id, refineText.trim()).then(({ jobId }) => {
      setRefineText('');
      runJob(jobId, session.id);
    });
  };

  const decide = (candidateId: string, decision: 'accept' | 'reject', note?: string) => {
    if (!session) return;
    api.decide(session.id, candidateId, decision, note).then(({ session: updated }) => {
      setSession(updated);
      refreshSessions();
    });
  };

  return (
    <div className="screen">
      <div className="topbar">
        <div className="lane-toggles">
          {(['evergreen', 'newsy'] as const).map((l) => (
            <label key={l} className={`lane-toggle ${lanes[l] ? 'on' : ''}`}>
              <input type="checkbox" checked={lanes[l]} onChange={(e) => setLanes((s) => ({ ...s, [l]: e.target.checked }))} />
              {l === 'evergreen' ? 'Evergreen' : 'Newsy'}
            </label>
          ))}
        </div>
        <input
          className="intent-input"
          placeholder="or type what you're after…"
          value={intent}
          onChange={(e) => setIntent(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && findIdeas()}
        />
        <button className="btn btn-accent" disabled={running} onClick={findIdeas}>
          {running ? 'Finding…' : 'Find ideas'}
        </button>
      </div>
      {angles && (
        <div className="next-angle mono">
          next — evergreen: {angles.next.evergreen} · newsy: {angles.next.newsy}
        </div>
      )}

      {(running || log.length > 0) && (
        <div className="log-panel">
          {running && <span className="pulse-dot" />}
          <div className="log-lines mono">
            {log.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>
        </div>
      )}
      {jobError && <div className="banner-warn">{jobError}</div>}

      {session && candidates.length > 0 && (
        <div className="refine-box">
          <input
            placeholder="Tell it what to change…"
            value={refineText}
            onChange={(e) => setRefineText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && refine()}
          />
          <button className="btn" disabled={running || !refineText.trim()} onClick={refine}>
            Refine
          </button>
        </div>
      )}

      {session && (
        <div className="session-header mono">
          session {session.id} · rev {session.revision} · state: {session.state}
        </div>
      )}

      {candidates.length > 0 && (
        <div className="results-summary mono">
          {candidates.length} candidates · {candidates.length - candidates.filter(hasFailedGate).length} clear ·{' '}
          {candidates.filter(hasFailedGate).length} gated
        </div>
      )}

      <div className="card-grid">
        {candidates.map((c) => (
          <CandidateCard key={c.id} candidate={c} accepted={session?.accepted_candidate_id === c.id} onDecide={decide} />
        ))}
      </div>

      {sessions.length > 0 && (
        <div className="history-strip">
          {sessions.map((s) => (
            <button key={s.id} className="history-row mono" onClick={() => loadSession(s.id)}>
              {s.id} · {new Date(s.created).toLocaleString()} · {s.state} · {s.lanes.join('+')}
            </button>
          ))}
        </div>
      )}

      {!health?.keys.youcom && (
        <div className="banner-warn">No YDC_API_KEY found — discovery calls will fail until one is set.</div>
      )}
    </div>
  );
}

function LedgerScreen() {
  const [status, setStatus] = useState('');
  const [lane, setLane] = useState('');
  const [q, setQ] = useState('');
  const [records, setRecords] = useState<LedgerRecord[]>([]);

  useEffect(() => {
    api.ledger({ status, lane, q }).then(setRecords).catch(() => setRecords([]));
  }, [status, lane, q]);

  return (
    <div className="screen">
      <div className="topbar">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">all statuses</option>
          {['candidate', 'rejected', 'blocked', 'accepted', 'produced', 'stale'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select value={lane} onChange={(e) => setLane(e.target.value)}>
          <option value="">all lanes</option>
          <option value="evergreen">evergreen</option>
          <option value="newsy">newsy</option>
        </select>
        <input placeholder="search question…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {records.length === 0 ? (
        <div className="empty-state">No ledger records match this filter.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>at</th>
                <th>status</th>
                <th>lane</th>
                <th>angle</th>
                <th>question</th>
                <th>gates</th>
                <th>note</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={`${r.id}-${r.at}`}>
                  <td className="mono">{new Date(r.at).toLocaleString()}</td>
                  <td>
                    <span className={`chip status-${r.status}`}>{r.status}</span>
                  </td>
                  <td>{r.lane}</td>
                  <td>{r.angle}</td>
                  <td className="q-cell">{r.question}</td>
                  <td>
                    <GateRow gates={r.gates} />
                  </td>
                  <td className="note-cell" title={r.note}>
                    {r.note}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('discover');
  const [health, setHealth] = useState<{ ok: boolean; keys: HealthKeys } | null>(null);
  const [angles, setAngles] = useState<Angles | null>(null);

  useEffect(() => {
    api.health().then(setHealth).catch(() => {});
    api.angles().then(setAngles).catch(() => {});
  }, []);

  const keys = useMemo(() => health?.keys, [health]);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">SPORT-ANALYTIC</div>
        <nav>
          <button className={screen === 'discover' ? 'active' : ''} onClick={() => setScreen('discover')}>
            Discover
          </button>
          <button className={screen === 'ledger' ? 'active' : ''} onClick={() => setScreen('ledger')}>
            Ledger
          </button>
        </nav>
        <div className="health">
          <HealthDot label="you.com" ok={!!keys?.youcom} />
          <HealthDot label="gemini" ok={!!keys?.gemini} />
          <HealthDot label="tavily" ok={!!keys?.tavily} />
        </div>
      </aside>
      <main>{screen === 'discover' ? <DiscoverScreen health={health} angles={angles} /> : <LedgerScreen />}</main>
    </div>
  );
}
