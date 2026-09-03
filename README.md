# sport-analytic

Automated NBA data-viz Shorts, reverse-engineered from
[NBA Recap Pod](https://youtube.com/@NBArecap). Eleven chart types render at
1080×1920 from live ESPN data.

## Run it

```bash
npm install
npm run fetch      # pull every dataset from ESPN into src/data/ (cached in .cache/)
npm test           # 11 assertions on the stat parsing and the scale maths
npm run studio     # interactive preview
npx tsx scripts/render-stills.ts               # one PNG per composition
npx tsx scripts/tts.ts C01                      # narrate with local Chatterbox
npx tsx scripts/render-videos.ts C01-cumulative-lines   # mp4 (with audio if tts ran)
npx tsx router/cases.ts                         # chart-type router, 22 real cases
```

### Voice

`scripts/tts.ts` drives **Chatterbox** (Resemble AI's open-source model) on this
machine — no API key, nothing leaves the laptop. It needs its own venv, because
`chatterbox-tts` pins transformers 5 and its own torch:

```bash
python3 -m venv ~/path/to/.venv-chatterbox
~/path/to/.venv-chatterbox/bin/pip install chatterbox-tts "setuptools<81"
export CHATTERBOX_VENV=~/path/to/.venv-chatterbox
```

`setuptools<81` is not optional: `resemble-perth`, which Chatterbox loads to
watermark its output, imports `pkg_resources`, and setuptools 81 removed it.
Without the pin the model loads and then dies on
`'NoneType' object is not callable`.

Chatterbox returns audio only, so timings are **measured, not estimated**: one
chunk per sentence, each chunk's real duration read off its WAV header, words
spread inside their own sentence. Every beat boundary — which is what drives the
chart animation — is therefore a measured number. Verified on the render: all
nine beat transitions land inside a detected silence in the final audio.

Set `CHATTERBOX_VOICE_WAV` to a reference recording to clone a fixed voice.
Leave it unset and the model uses its own, which will drift between runs.

Measured on an M-series MacBook: model loads in ~11s, then generates at **3.4x
realtime** — 89 seconds of narration costs about five minutes. If it drops to
10x or worse, check `sysctl vm.swapusage` and `df` before suspecting the model:
a full disk stops macOS growing its swap file, and the symptom looks exactly
like the model degrading.

`C01F-cumulative-lines-source-script` narrates the source video's own words, so
the AI voice can be judged against the human host on identical material — until
a written draft exists for brief `C01F`, at which point that composition follows
the draft instead (`npx tsx scripts/tts.ts C01F` with no draft path puts the
source script back).
`scripts/ab.ts` builds `out/ab/voice-ab.wav` — original, a beep, then ours.

Each sentence gets its own seed (`1000 + i` by default) and its WAV is cached
under a hash of the text, seed, voice file contents, and generation settings.
Editing one sentence and re-running `scripts/tts.ts` then only re-synthesizes
that sentence — the other, unchanged sentences replay byte-identical from
`.cache/tts`, so the approved take never drifts. Bumping `CACHE_VERSION` in
`src/tts/chatterbox.ts` invalidates the whole cache on purpose, for when the
model or venv changes underneath it.

### Writing a script with Gemini

```bash
npx tsx scripts/brief.ts C01F      # out/brief-C01F.json + .md — the facts and the allowed numbers
npx tsx scripts/write.ts C01F      # Gemini writes the script; ~100s
npx tsx scripts/tts.ts C01F out/draft-C01F.json
npx tsx scripts/render-videos.ts C01F-cumulative-lines-source-script
```

`scripts/write.ts` is the writer. It calls Gemini through the **Antigravity
CLI** (`agy`), not the `gemini` CLI: the two share `~/.gemini/` but not
credentials, and only `agy` is authenticated here (by
`~/.gemini/antigravity-cli/antigravity-oauth-token` — the `gemini` CLI has no
`settings.json` and exits in 3s with `{"code":41}`). The model is
`gemini-3.8-flash-high`, in one constant at the top of the file: on this prompt
it answers in ~100s, where `gemini-3.1-pro-high` took 230s and 303s and once
died on its own poll timeout. No JSON schema is passed — a schema makes the
model reply with a malformed *function call* instead of a script, and
`parseDraftText` already tolerates fences and prose. The prompt opens with an
explicit English override, because the machine-wide `~/.gemini/config/GEMINI.md`
says to answer in Vietnamese and wins over this repo's `GEMINI.md`.

It fails in exactly three ways, with three exit codes: **2 auth** (no token, or
`agy` not on `PATH`), **3 refused** (`agy` errored, or replied with no JSON in
it — its own error text is printed), **4 rules** (a draft parsed but
`verifyDraft` found violations, listed as `beat <n> · <rule> · <detail>`).
Nothing is written to `out/` unless every rule passes.

The reply is cached under a hash of the brief's content, the skill text, the
model name and the language override, so re-running on an unchanged brief
replays the approved script instead of re-rolling it — an LLM CLI has no seed.
`--force` re-rolls anyway; `DRAFT_CACHE_VERSION` invalidates every cached draft
at once.

A verified draft lands in `out/draft-<id>.json`, which `scripts/tts.ts`
narrates, and is mirrored to `src/data/draft-<id>.json`, which the renderer
reads — see `src/drafts.ts` for why the picture needs its own copy, and what
happens when the audio and the draft disagree.

The paste loop still works when the CLI is not available: paste
`prompts/WRITER_SKILL.md` then `out/brief-<id>.md` into any Gemini chat, save
the reply, and run `npm run draft <id> <path>` (or `- ` for stdin), which runs
the same `verifyDraft` and writes the same file.

## What is here

| Path | What it does |
| --- | --- |
| `src/espn.ts` | The only place that touches the network. Everything is disk-cached, so a render is reproducible and a dead endpoint cannot break it. |
| `src/scale.ts` | The only maths: linear scales, nice ticks, and the row-fitting rule that decides static vs scroll. Pure, and tested. |
| `src/themes.ts` | The visual identity. A theme owns ground, grid, stroke weight, marker shape, type treatment and annotation voice — everything that makes a channel recognisable. Switch with `npx tsx scripts/set-theme.ts <name>`. |
| `src/theme.ts` | Resolves the active theme into the tokens the charts read. Charts never see a theme name. |
| `src/chrome/` | Ground, title, logo, watermark, karaoke caption. Identical for every chart. |
| `src/motion/` | The six shared techniques: camera, scroll, reveal, annotation, spotlight, inset panel. They know about time; they know nothing about charts. |
| `src/charts/` | Nine components covering eleven chart types. They know how to draw; they know nothing about time. |
| `router/` | Picks the chart type from the *shape* of the data, not the topic. |

That split is the point. A ninth chart type is one file in `src/charts/`, and
changing how the camera eases is one edit for all of them.

## Compositions

| id | Chart type | Data |
| --- | --- | --- |
| `C01-cumulative-lines` | cumulative multi-line | 2019 draft class, career points by season |
| `C02-stacked-column-thresholds` | stacked column + cap lines | Houston Rockets contracts vs the 2025-26 cap |
| `C03-ranked-bar` | ranked horizontal bar | 26 highest cap hits |
| `C04-diverging-bar` | diverging bar | all 30 teams by point differential |
| `C05-proportion-bar` | 100% proportion bar | games played as a share of 82 |
| `C06-bar-delta` | baseline + change | points per game, last season → this |
| `C07-scatter-image` | scatter, logo markers | salary vs points per game |
| `C08-dot-strip` | dot density | 550 players by height and weight |
| `C09-slope-pair` | slope pair (re-draft) | 2011 NBA re-draft, round 1: actual pick vs. ranked by career points |
| `C10-image-cell-matrix` | image cell matrix | league leaders, 7 seasons x 6 categories, headshot per cell |
| `C11-unit-waffle` | unit waffle | LeBron James career points decomposed into 2PT / 3PT / FT |

## Identity

Three directions ship in `src/themes.ts`; **court** is active.

| | ground | grid | stroke | marker | title |
| --- | --- | --- | --- | --- | --- |
| `court` | `#101319` | horizontal only | 8px round | circle, series ring | uppercase + red rule |
| `blueprint` | `#EDF0F3` | dotted, both axes | 6px butt | rounded square | sentence case + mono eyebrow |
| `headline` | `#FFFFFF` | none but a baseline | 13px round | large, ground ring | uppercase 112px |

Team colours are authored for white paper, so `ensureContrast()` lifts any that
would disappear against the active ground — Denver's navy measures 1.3:1 on
`#101319` and is unreadable until it is mixed toward white. There is a test that
walks all 30 teams and fails if any lands under 2.55:1.

Subtitles are **not** rendered. `scripts/tts.ts` writes `out/voice-<id>.srt`
with word-level cues for whatever burns them in.

## Known gaps

- **No pinned voice.** Nothing sets `CHATTERBOX_VOICE_WAV`, so C01 narrates in
  Chatterbox's built-in voice. A channel needs a reference recording, or the
  narrator changes between videos.
- **Word timing inside a sentence is spread, not aligned.** Sentence boundaries
  are measured; the words between them are apportioned by syllable weight. Good
  enough for the chart (which cuts on beats) and slightly loose for karaoke
  captions. ElevenLabs `with-timestamps` would fix the captions at a cost.
- **No music bed** yet. Narration is loudnorm'd toward −14 LUFS but lands at
  −15.0: the read has an LRA of 1.9, so linear mode cannot push further without
  clipping.
- `src/script.ts` still holds the syllable estimator — it is the fallback used
  when a composition has no measured timeline.
- **Cap thresholds are hardcoded** in `scripts/fetch-data.ts` from the published
  2025-26 CBA levels. Re-verify them each season before publishing anything.
- ESPN's API is undocumented. Everything is cached to `.cache/` for that reason;
  swapping in a licensed provider means rewriting `src/espn.ts` only.
