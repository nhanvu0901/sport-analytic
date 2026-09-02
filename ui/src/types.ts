/**
 * Slim mirror of src/content/types.ts. Duplicated rather than imported: the
 * Vite dev server's fs.allow boundary is the project root (ui/), and reaching
 * across into ../../src would mean either widening that boundary or letting
 * the UI's build depend on the server's TS project. A handful of type
 * aliases is cheaper than either.
 */
export type Lane = 'evergreen' | 'newsy';
export type Angle = 'verdict-revisited' | 'chase' | 'cohort-fate' | 'rank-inversion' | 'hidden-cost' | 'newsy';
export type LedgerStatus = 'candidate' | 'rejected' | 'blocked' | 'accepted' | 'produced' | 'stale';
export type GateVerdict = 'pass' | 'fail' | 'pending';

export type Gates = {
  g0_burned: GateVerdict;
  g1_real_question: GateVerdict;
  g3_data_available: GateVerdict;
  g4_chart_fit: GateVerdict;
};

/** g2 demoted to a note (2026-09) — see src/content/types.ts for the reasoning.
 *  Informational only: never blocks Accept, never dims a card. */
export type Coverage = { checked: number; topTitle?: string; topUrl?: string; score?: number; note: string };

export type Candidate = {
  id: string;
  question: string;
  angle: Angle;
  lane: Lane;
  why_fans_argue: string;
  measurable_as: string;
  entities: string[];
  evidence_urls: string[];
  freshness: 'evergreen' | 'this-week';
  gates: Gates;
  burned_by?: string | null;
  flags: string[];
  /** Human-readable reason for each non-trivial gate verdict, for the UI's tooltip/fail line. */
  gate_notes?: Partial<Record<keyof Gates, string>>;
  /** A gate's matched URL, when it has one — kept separate from gate_notes
   *  (plain strings) so the UI can still link to it. */
  gate_links?: Partial<Record<keyof Gates, string>>;
  /** Informational-only YouTube coverage probe. Never a verdict, never blocks. */
  coverage?: Coverage;
};

export type SessionState = 'draft' | 'review' | 'accepted' | 'archived';
export type FeedbackNote = { state: SessionState; text: string; at: string };

export type Session = {
  id: string;
  created: string;
  state: SessionState;
  lanes: Lane[];
  intent: string;
  revision: number;
  angle_used: { evergreen?: string; newsy?: string };
  feedback_log: FeedbackNote[];
  accepted_candidate_id?: string | null;
};

export type LedgerRecord = {
  id: string;
  question: string;
  status: LedgerStatus;
  lane: Lane;
  angle: Angle;
  entities: string[];
  evidence: string[];
  gates: Gates;
  session: string;
  at: string;
  note: string;
  recheck_after: string | null;
  video?: string | null;
  views_7d?: number | null;
};
