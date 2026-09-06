import { useEffect, useMemo, useRef, useState } from 'react';
import { api, subscribeJob } from './api';
import type { BriefJobResult, BriefStored, Candidate, Coverage, GateVerdict, Gates, LedgerRecord, RenderJobResult, Session, Violation, WriteJobResult } from './types';

type Screen = 'discover' | 'ledger' | 'brief';
type HealthKeys = { youcom: boolean; gemini: boolean; tavily: boolean };
type Angles = {
  evergreen: string[];
  newsy: string[];
  next: { evergreen: string; newsy: string };
  sessionCount: { evergreen: number; newsy: number };
  nextIndex: { evergreen: number; newsy: number };
};

// Operator-facing Vietnamese glosses, keyed by the evergreen slug and by the
// newsy index — content/angles.json itself stays plain string arrays
// (nextAngle, the ledger, and every stored session consume those strings
// as-is). A slug or index missing here — e.g. an angle hand-added to the
// JSON — just means no gloss is shown; the English text still renders.
const EVERGREEN_GLOSS: Record<string, string> = {
  'verdict-revisited': 'phán xét lại một draft / trade / hợp đồng sau vài mùa có số liệu thật',
  chase: 'một cầu thủ đang chơi có đuổi kịp kỷ lục hay một huyền thoại không',
  'cohort-fate': 'cả một nhóm (draft class, đội all-rookie, roster vô địch) sau này ra sao',
  'rank-inversion': 'ai thật sự dẫn đầu khi xếp theo một thước đo không ai nhắc tới',
  'hidden-cost': 'một con số đẹp che đi một con số xấu',
};

const NEWSY_GLOSS: string[] = [
  'tranh luận fan đang diễn ra TUẦN NÀY mà một biểu đồ số liệu thật giải quyết được',
  'phát biểu của bình luận viên / HLV / cầu thủ tuần này mà số liệu xác nhận hoặc bác bỏ',
  'một chuỗi thắng-thua, phong độ, trade hay cột mốc trong 7 ngày qua',
];

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
  onOpenBrief,
}: {
  candidate: Candidate;
  accepted: boolean;
  onDecide: (candidateId: string, decision: 'accept' | 'reject', note?: string) => void;
  onOpenBrief: () => void;
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
      {accepted && (
        <div className="card-actions">
          <button className="btn btn-good" onClick={onOpenBrief}>
            Open brief →
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

function DiscoverScreen({
  health,
  angles,
  onAccepted,
  onOpenBrief,
}: {
  health: { ok: boolean; keys: HealthKeys } | null;
  angles: Angles | null;
  onAccepted: (sessionId: string) => void;
  onOpenBrief: () => void;
}) {
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
      if (updated.state === 'accepted') onAccepted(updated.id);
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
        <div className="angles-panel mono">
          <div className="angles-note">typing above overrides this — the rotation only fires when the box is empty</div>
          {(['evergreen', 'newsy'] as const).map((lane) => (
            <div key={lane} className="angles-lane">
              <div className="angles-lane-head">
                {lane} · {angles.sessionCount[lane]} sessions run · next is index {angles.nextIndex[lane]}
              </div>
              {angles[lane].map((raw, i) => {
                const isNext = i === angles.nextIndex[lane];
                const colon = lane === 'evergreen' ? raw.indexOf(':') : -1;
                const slug = colon > -1 ? raw.slice(0, colon).trim() : null;
                const text = colon > -1 ? raw.slice(colon + 1).trim() : raw;
                const gloss = lane === 'evergreen' ? (slug ? EVERGREEN_GLOSS[slug] : undefined) : NEWSY_GLOSS[i];
                return (
                  <div key={i} className={`angle-item${isNext ? ' angle-next' : ''}`}>
                    <span className="chip">
                      {i}
                      {isNext ? ' · next' : ''}
                    </span>
                    {gloss && <span className="angle-gloss">{gloss}</span>}
                    <span className="angle-en">{text}</span>
                  </div>
                );
              })}
            </div>
          ))}
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
          <CandidateCard
            key={c.id}
            candidate={c}
            accepted={session?.accepted_candidate_id === c.id}
            onDecide={decide}
            onOpenBrief={onOpenBrief}
          />
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

// A topic stops here until the user either writes its narration or renders
// its video — this is the set the Ledger screen offers a way back into.
const RESUMABLE_STATUSES = new Set(['accepted', 'narrated']);

function LedgerScreen({ onOpenSession }: { onOpenSession: (sessionId: string) => void }) {
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
          {['candidate', 'rejected', 'blocked', 'accepted', 'narrated', 'produced', 'stale'].map((s) => (
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
                <th></th>
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
                  <td>
                    {RESUMABLE_STATUSES.has(r.status) && (
                      <button className="btn" onClick={() => onOpenSession(r.session)}>
                        Resume →
                      </button>
                    )}
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

/** Copies `text` to the clipboard, flipping `label`'s state to "Copied" for
 *  ~1.5s. Returns whether it worked, so a caller with a visible <pre> (the
 *  brief) can fall back to selecting that text when the clipboard API throws
 *  — which it can, over plain http on some browsers. */
async function copyWithFlip(text: string, setCopied: (v: boolean) => void): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    return true;
  } catch {
    return false;
  }
}

function BriefScreen({ sessionId, onBack }: { sessionId: string; onBack: () => void }) {
  const [session, setSession] = useState<Session | null>(null);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [briefResult, setBriefResult] = useState<BriefJobResult | BriefStored | null>(null);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [copiedSkill, setCopiedSkill] = useState(false);
  const [copiedBrief, setCopiedBrief] = useState(false);
  const [skillError, setSkillError] = useState(false);
  const [selectHint, setSelectHint] = useState(false);
  const [writing, setWriting] = useState(false);
  const [writeLog, setWriteLog] = useState<string[]>([]);
  const [writeResult, setWriteResult] = useState<WriteJobResult | null>(null);
  const [rendering, setRendering] = useState(false);
  const [renderLog, setRenderLog] = useState<string[]>([]);
  const [renderResult, setRenderResult] = useState<RenderJobResult | null>(null);
  const preRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    setSession(null);
    setCandidate(null);
    setBriefResult(null);
    setLog([]);
    api
      .session(sessionId)
      .then(({ session, candidates }) => {
        setSession(session);
        setCandidate(candidates.find((c) => c.id === session.accepted_candidate_id) ?? null);
      })
      .catch(() => {});
    api.getBrief(sessionId).then((r) => { if (r) setBriefResult(r); }).catch(() => {});
  }, [sessionId]);

  const buildBrief = () => {
    setRunning(true);
    setLog([]);
    setBriefResult(null);
    api.buildBrief(sessionId).then(({ jobId }) => {
      subscribeJob(
        jobId,
        (line) => setLog((l) => [...l, line]),
        (done) => {
          setRunning(false);
          setBriefResult(
            done.status === 'done' ? (done.result as BriefJobResult) : { ok: false, reason: done.error || 'brief job failed', resolved: [] }
          );
        }
      );
    });
  };

  const copySkill = async () => {
    setSkillError(false);
    const text = await api.skill().catch(() => null);
    if (text === null || !(await copyWithFlip(text, setCopiedSkill))) setSkillError(true);
  };

  const copyBrief = async () => {
    if (!briefResult?.ok) return;
    setSelectHint(false);
    const worked = await copyWithFlip(briefResult.md, setCopiedBrief);
    if (!worked) {
      // Clipboard API threw — select the text in the <pre> instead so the
      // user can still grab it with the keyboard.
      const el = preRef.current;
      if (el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
      setSelectHint(true);
    }
  };

  // A run that ended in `rules` still cached agy's reply (the whole point of
  // the cache is an unchanged brief replaying the same reply), so a second
  // click with `force: false` would just replay the same rejected draft.
  // `force` on any click after the first is how "try again" actually tries
  // again.
  const generateNarration = () => {
    if (writing) return;
    const force = writeResult !== null;
    setWriting(true);
    setWriteLog([]);
    setWriteResult(null);
    api.write(sessionId, force).then(({ jobId }) => {
      subscribeJob(
        jobId,
        (line) => setWriteLog((l) => [...l, line]),
        (done) => {
          setWriting(false);
          setWriteResult(
            done.status === 'done'
              ? (done.result as WriteJobResult)
              : { ok: false, kind: 'refused', message: done.error || 'write job failed' }
          );
        }
      );
    });
  };

  const generateVideo = () => {
    if (rendering) return;
    setRendering(true);
    setRenderLog([]);
    setRenderResult(null);
    api
      .render(sessionId)
      .then(({ jobId }) => {
        subscribeJob(
          jobId,
          (line) => setRenderLog((l) => [...l, line]),
          (done) => {
            setRendering(false);
            setRenderResult(
              done.status === 'done'
                ? (done.result as RenderJobResult)
                : { ok: false, compositionId: sessionId, message: done.error || 'render job failed' }
            );
          }
        );
      })
      // The route refuses BEFORE it starts a job — no brief, or a chart with
      // no composition behind it — and that refusal arrives as a rejected
      // promise with the reason in it. Without this the button would spin
      // forever on exactly the case it was added to explain.
      .catch((err: unknown) => {
        setRendering(false);
        setRenderResult({
          ok: false,
          compositionId: sessionId,
          message: err instanceof Error ? err.message : String(err),
        });
      });
  };

  return (
    <div className="screen">
      <div className="brief-header">
        <h2 className="card-question">{candidate?.question ?? 'Loading…'}</h2>
        {candidate && (
          <div className="chip-row">
            <span className="chip">{candidate.angle}</span>
            <span className="chip chip-lane">{candidate.lane}</span>
          </div>
        )}
        <div className="session-header mono">session {sessionId}</div>
      </div>

      {!briefResult && (
        <button className="btn btn-accent" disabled={running} onClick={buildBrief}>
          {running ? 'Building…' : 'Build brief'}
        </button>
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

      {briefResult && !briefResult.ok && (
        <>
          {/* A candidate our data cannot answer is a normal outcome, not an
              error state — worded plainly, not alarm-red boilerplate. */}
          <div className="banner-fail">{briefResult.reason}</div>
          <button className="btn" onClick={onBack}>
            Back to discover
          </button>
        </>
      )}

      {briefResult && briefResult.ok && (
        <>
          {'warnings' in briefResult && briefResult.warnings.length > 0 && (
            <div className="banner-warn">
              {briefResult.warnings.map((w, i) => (
                <div key={i}>{w}</div>
              ))}
            </div>
          )}

          <div className="copy-row">
            <button className="btn" onClick={copySkill}>
              {copiedSkill ? 'Copied' : 'Copy skill (paste once)'}
            </button>
            <button className="btn" onClick={copyBrief}>
              {copiedBrief ? 'Copied' : 'Copy brief'}
            </button>
          </div>
          {skillError && <div className="mono hint-line">Clipboard blocked — open prompts/WRITER_SKILL.md manually.</div>}
          {selectHint && <div className="mono hint-line">Select all + ⌘C</div>}

          <pre ref={preRef} className="brief-pre">
            {briefResult.md}
          </pre>

          <button className="btn btn-accent" disabled={writing} onClick={generateNarration}>
            {writing ? 'Writing…' : writeResult ? 'Regenerate narration' : 'Generate narration'}
          </button>

          {(writing || writeLog.length > 0) && (
            <div className="log-panel">
              {writing && <span className="pulse-dot" />}
              <div className="log-lines mono">
                {writeLog.map((l, i) => (
                  <div key={i}>{l}</div>
                ))}
              </div>
            </div>
          )}

          {writeResult && !writeResult.ok && writeResult.kind === 'auth' && (
            <div className="banner-fail">AUTH — agy cannot authenticate. {writeResult.message}</div>
          )}
          {writeResult && !writeResult.ok && writeResult.kind === 'refused' && (
            <div className="banner-fail">REFUSED — agy returned no usable draft. {writeResult.message}</div>
          )}
          {writeResult && !writeResult.ok && writeResult.kind === 'rules' && (
            <div className="violations">
              {[...writeResult.violations]
                .sort((a: Violation, b: Violation) => (a.beat ?? -1) - (b.beat ?? -1))
                .map((v, i) => (
                  <div key={i} className="violation-line mono">
                    beat {v.beat ?? '-'} · {v.rule} · {v.detail}
                  </div>
                ))}
            </div>
          )}

          {writeResult && writeResult.ok && (
            <>
              <h3 className="card-question">{writeResult.title}</h3>
              <div className="summary-line mono">
                {writeResult.beats} beats · {writeResult.totalWords}/{writeResult.targetWords} words ·{' '}
                {writeResult.totalAccents} accents (budget {writeResult.accentBudget.min}-{writeResult.accentBudget.max})
                {writeResult.cacheHit ? ' · cached' : ''}
              </div>
              <div className="beats-list mono">
                {writeResult.draft.beats.map((b, i) => (
                  <div key={i} className="beat-line">
                    {i + 1}. {b.text}
                  </div>
                ))}
              </div>
              <div className="mono hint-line">
                next: npx tsx scripts/tts.ts {sessionId} out/draft-{sessionId}.json
              </div>

              <button className="btn btn-accent" disabled={rendering} onClick={generateVideo}>
                {rendering ? 'Rendering…' : renderResult ? 'Render again' : 'Generate video (mp4)'}
              </button>

              {(rendering || renderLog.length > 0) && (
                <div className="log-panel">
                  {rendering && <span className="pulse-dot" />}
                  <div className="log-lines mono">
                    {renderLog.map((l, i) => (
                      <div key={i}>{l}</div>
                    ))}
                  </div>
                </div>
              )}

              {renderResult && !renderResult.ok && <div className="banner-fail">{renderResult.message}</div>}
              {renderResult && renderResult.ok && (
                <div className="mono hint-line">done: {renderResult.outPath}</div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('discover');
  const [health, setHealth] = useState<{ ok: boolean; keys: HealthKeys } | null>(null);
  const [angles, setAngles] = useState<Angles | null>(null);
  // The session most recently accepted — gates the Brief nav item and is
  // what "Open brief →" jumps to. Lifted up here (out of DiscoverScreen) so
  // both screens can see it without a router or a state library.
  const [briefSessionId, setBriefSessionId] = useState<string | null>(null);

  useEffect(() => {
    api.health().then(setHealth).catch(() => {});
    api.angles().then(setAngles).catch(() => {});
  }, []);

  const keys = useMemo(() => health?.keys, [health]);

  // Ledger "Resume →" jumps into the Brief screen for a topic that is
  // `accepted` or `narrated` but not yet produced — same nav path an accept
  // in Discover already takes, just entered from the ledger row instead.
  const openSession = (sessionId: string) => {
    setBriefSessionId(sessionId);
    setScreen('brief');
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">SPORT-ANALYTIC</div>
        <nav>
          <button className={screen === 'discover' ? 'active' : ''} onClick={() => setScreen('discover')}>
            Discover
          </button>
          <button
            className={screen === 'brief' ? 'active' : ''}
            disabled={!briefSessionId}
            title={briefSessionId ? undefined : 'Accept a candidate first'}
            onClick={() => setScreen('brief')}
          >
            Brief
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
      <main>
        {screen === 'discover' && (
          <DiscoverScreen
            health={health}
            angles={angles}
            onAccepted={setBriefSessionId}
            onOpenBrief={() => setScreen('brief')}
          />
        )}
        {screen === 'brief' && briefSessionId && <BriefScreen sessionId={briefSessionId} onBack={() => setScreen('discover')} />}
        {screen === 'ledger' && <LedgerScreen onOpenSession={openSession} />}
      </main>
    </div>
  );
}
