# TODO

Ordered. Items 1 and 2 are done; **Now** is what comes next.

## Done

- [x] **1. Subtitles removed from the render.** `CaptionBar` deleted, `Frame` no
      longer takes captions. Word timings stay in `src/data/timeline-*.json` and
      `scripts/tts.ts` now also writes `out/voice-<id>.srt` (word-level cues) so
      the downstream subtitle tool gets exact timings instead of re-transcribing.
- [x] **2. Own visual identity — "Court".** Three directions were rendered and
      `court` was chosen: near-black `#101319`, horizontal rules only, 8px
      strokes, mono ticks, uppercase title over a red rule, precise (not
      hand-drawn) annotations. Lives in `src/themes.ts`; switch with
      `npx tsx scripts/set-theme.ts <court|blueprint|headline>`.
      Every hardcoded light-ground colour is now a theme token, and
      `ensureContrast()` lifts team colours that would vanish on dark
      (Nuggets navy measured at 1.3:1 against the ground).

## Now — content

- [x] **A. Visual event density.** Beats carry accents[] in DATA space (Anchor = entityId + step) so nothing points at pixels; pathAt() draws lines continuously; camera is a push-and-release; render refuses <0.22/s and warns >0.45/s. C01F went 0.135 → 0.393 events/s.
- [x] **Writer brief (stage-1 output → Gemini).** src/brief.ts emits out/brief-<id>.json: facts + machine-detected story markers + allowed_numbers + the 7 measured style rules + output schema. src/verify.ts rejects any draft with a fabricated number, unknown entity, bad accent, or broken rule.
- [x] **Per-sentence seed + TTS cache.** Worker seeds torch (and MPS) per chunk with 1000+i; driver caches each chunk's WAV under sha1(text, seed, voice-file contents, exaggeration, cfg, temperature, CACHE_VERSION). Editing one sentence now regenerates one sentence; an unchanged script costs 0 s and produces a byte-identical wav.
- [ ] **Casting.** Seeds are positional (1000+i) so inserting a sentence shifts every later seed. Add an explicit per-chunk seed override in the script (`seeds?: number[]` on ScriptLine or per-beat) so a chosen take survives edits, plus a tiny CLI to render one sentence with seeds 1..N for audition.
- [ ] **Filter award markers to the NBA era.** 20 of 29 markers are awards and most are college (AP All-American, Wooden, Naismith, Bob Cousy…) — noise for a career-points story. Keep only awards whose season ≥ the entity's first NBA season, or a whitelist (MIP, ROY, All-NBA, All-Rookie, 6MOY, DPOY, MVP, All-Star).
- [x] **g2 demoted to a coverage note.** In basketball, a competitor covering a topic is evidence it lands, not a reason to skip — the source channel made the same salary-cap video forty times. Only overlap with our OWN catalogue is worth blocking, and that is g0. The YouTube probe stays as an informational line (how many similar videos, closest match) and never blocks Accept.
- [ ] **Gate g4 (chart-fit).** The router is pure, but getting from a free-text `measurable_as` to a DataShape needs one cheap LLM call — do it in the same pass that wires Gemini.
- [ ] **Wire Gemini.** Send the brief, parse the draft, run verifyDraft, re-prompt with the violations on failure. Key is GEMINI_API_KEY in ~/Documents/code/comic-book-pipeline/.env; prefer gemini-3.1-pro-preview.
- [ ] **Entity resolver for hand-written SRT.** Match names in each cue to facts.entities; a cue with no name inherits the previous cue's entity.
- [ ] **Portrait / accent collision.** The big portrait can sit on top of a spotlight or line head (seen on RJ Barrett). Nudge the portrait away from the active accent anchor.
- [ ] **3. Topic generator.** The matrix that decides what to make:
      `{draft class} × {stat}`, `{30 teams} × {season}`, `{stat} × {milestone}`.
      Must record what has already shipped so it never repeats itself.
- [ ] **4. Fact table builder.** Not just the numbers — the *angle*. Detect
      missed seasons, jumps, plateaus, rank changes, award years. This is what
      decides whether a video has a story or is a table read aloud.
- [ ] **5. Script writer.** Claude API, constrained to `facts.json` and to the
      router's `alternates[]`. Must not invent a number or a chart type.
- [ ] **6. Title, description, hashtags** generated in the same pass as the script.
- [ ] **7. Close the loop.** Wire steps 3–6 to the existing render + a YouTube
      `videos.insert` upload. Dry-run to unlisted first.

## Then — quality

- [ ] **8. Pin the channel voice.** A reference wav for `CHATTERBOX_VOICE_WAV`.
      Without it the narrator changes between videos.
- [ ] **9. Music bed** with speech-driven ducking, and finish the loudness pass
      (currently lands at −15.0 LUFS against a −14 target).
- [ ] **10. Cap thresholds** are hardcoded from the 2025-26 CBA. Verify per season
      or derive them.
- [x] **Three more chart types: 11 of 18.** slope-pair (re-draft, 10 source videos), image-cell-matrix (4 videos), unit-waffle. All three reuse the shared motion layer unchanged, which was the architecture test.
- [ ] **Reveal vs. draw-whole is a per-chart decision.** Reveal entities one at a time only when each new one ADDS information (cumulative lines, a race). Draw the whole thing and let the beat drive emphasis only when the information lives in the RELATIONS between entities — a ranked list, a budget column, a re-draft board. Got this wrong twice now (StackedColumn, then SlopePair) by copying the CumulativeLines pattern; write the rule into any new chart's spec.
- [x] **Re-draft id bridge.** ESPN's search index drops players who left the league, and neither seasons/{y}/athletes nor the league-wide athlete index helps — both return the same 627 current players regardless of the year asked for. hoopR's per-season player_box parquet is built on ESPN, so its athlete_id IS the ESPN id: 22 seasons (2002-2023, 14.8 MB, cached) resolve the rest. Resolution is layered espn → hoopr → unresolved and the source is recorded per row, with a † footnote in the chart because hoopR stops at 2023.
- [ ] **Re-drafts before 2002** cannot be built: hoopR's box scores start at 2002 and ESPN's search will not resolve that era's retired players. The channel's oldest re-draft is 2005, so this is a ceiling, not a blocker.
- [ ] **Remaining 7 chart types.** ridgeline, heatmap-matrix, stacked-column-groups, geo-pins, quadrant, timeline-rows, token-rows. timeline-rows is blocked: champions per season are not in any source we have — `seasons/{y}` has no champion field, postseason standings come back empty, and player bios list "Finals MVP" but never "NBA Champion".

## Known gaps

- Award-vote data and draft-picks-owned have no free structured source (2 of the
  18 chart types).
- ESPN's API is undocumented; everything is cached to `.cache/` so a dead
  endpoint cannot break a render. `src/espn.ts` is the only file to rewrite if we
  move to a licensed provider.
