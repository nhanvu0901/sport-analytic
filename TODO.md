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
- [ ] **11. The other ten chart types** from the taxonomy — ridgeline, map,
      matrix, slope, waffle, venn, timeline, token rows. Only after 1–7 ship.

## Known gaps

- Award-vote data and draft-picks-owned have no free structured source (2 of the
  18 chart types).
- ESPN's API is undocumented; everything is cached to `.cache/` so a dead
  endpoint cannot break a render. `src/espn.ts` is the only file to rewrite if we
  move to a licensed provider.
