import React from 'react';
import { Audio, Composition, staticFile } from 'remotion';
import './fonts';
import { V } from './theme';
import { fmt } from './scale';
import { buildTimeline, framesFor } from './script';
import { SCRIPTS } from './scripts';
import { stageFor } from './drafts';
import type { Beat } from './motion';
import { VIDEOS, draftFor, timelineFor } from './videos';
import { compositionIdFor, type WiredChart } from './videoData';
import { Frame } from './chrome/Frame';
import { CumulativeLines } from './charts/CumulativeLines';
import { RankedBar } from './charts/RankedBar';
import { StackedColumn } from './charts/StackedColumn';
import { BarDelta } from './charts/BarDelta';
import { Scatter } from './charts/Scatter';
import { DotStrip } from './charts/DotStrip';
import { SlopePair } from './charts/SlopePair';
import { ImageCellMatrix } from './charts/ImageCellMatrix';
import { UnitWaffle } from './charts/UnitWaffle';
import { T, series as PALETTE, PLOT } from './theme';

import cumulative from './data/cumulative.json';
import rankedBar from './data/rankedBar.json';
import divergingBar from './data/divergingBar.json';
import proportionBar from './data/proportionBar.json';
import barDelta from './data/barDelta.json';
import scatter from './data/scatter.json';
import dotStrip from './data/dotStrip.json';
import salaryCap from './data/salaryCap.json';
import teams from './data/teams.json';
import redraft from './data/redraft.json';
import leaderMatrix from './data/leaderMatrix.json';
import waffle from './data/waffle.json';

const byAbbr = new Map((teams as any[]).map((t) => [t.abbr, t]));
const NBA_LOGO = 'https://a.espncdn.com/i/teamlogos/leagues/500/nba.png';

/* ------------------------------------------------------------------ 01 lines
   `stageFor` is the whole wiring of a WRITTEN script into the picture: it
   prefers src/data/draft-<id>.json (mirrored there by scripts/write.ts) for
   the title, the beat order and the accents, takes the timings from the
   measured audio when there is any, and falls back to the hardcoded
   SCRIPTS[id] when there is no draft — which is what every other composition
   below still runs on. See src/drafts.ts for the precedence and why it is in
   that order. The line it logs says which case fired, and Remotion forwards
   browser console output, so a render states what actually drove the picture
   instead of leaving an ignored draft looking exactly like a used one.

   `srcFor` is where the two files come from now: src/videos.ts globs
   src/data/ at bundle time, so neither has to exist and neither is named in
   an import. */
const srcFor = (id: string) => ({ draft: draftFor(id), timeline: timelineFor(id) });

const cum = stageFor('C01', srcFor('C01'), SCRIPTS.C01, cumulative.title);

// C01F is the same chart on the SOURCE VIDEO's own narration when no draft
// exists — that is the A/B against the human host (scripts/finish-ab.sh) — and
// on the generated draft for brief C01F once one has been written and narrated.
const full = stageFor('C01F', srcFor('C01F'), SCRIPTS.C01F, cumulative.title);

console.log(`C01: ${cum.source} · C01F: ${full.source}`);

/* --------------------------------------------------------- generated videos
   One composition per src/data/video-<id>.json, discovered — never named.
   A session that has a brief has a video file; give it a narration and it has
   a draft and a timeline too. No edit in here, ever.

   ONLY the charts on this map get a composition. A chart whose component does
   not read `beats` would draw a picture that ignores its own narration, which
   is worse than no video at all, so an unsupported chart gets nothing here and
   the render route refuses by name. The map's key type is WiredChart, so
   src/videoData.ts's list and this map cannot drift apart without tsc saying
   so. `cumulative-record-chase` is the same component as
   `cumulative-multiline` plus one horizontal line — the record is a prop on
   the data, not a second series, because ESPN returns 5 of Wilt Chamberlain's
   14 seasons and zero rebounds and a chase never needed the holder's series.
   `stacked-column-thresholds` is the same component C02 below draws, and takes
   the same `{ rows, thresholds }` prop: `videoDataFrom` builds that pair out of
   `brief.facts.budget`, so the generated video and the hand-built demo are one
   shape and the component cannot tell which it is looking at. */
const CHARTS: Record<WiredChart, React.FC<{ data: any; beats: Beat[] }>> = {
  'cumulative-multiline': CumulativeLines,
  'cumulative-record-chase': CumulativeLines,
  'stacked-column-thresholds': StackedColumn,
};

const GENERATED = VIDEOS
  .filter((v) => v.chart in CHARTS)
  .map((video) => {
    // Only used before a draft is written: one line per part, so the
    // composition still has a duration and something to show. A budget column
    // carries `rows` and no `series` — its x axis is people, not time — so the
    // placeholder is built from whichever of the two this video has.
    const fallback = video.rows?.length
      ? video.rows.map((r) => ({
          entityId: r.id,
          text: `${r.name} carries ${fmt.moneyShort(r.value)} against the cap.`,
        }))
      : video.series.map((s) => ({
          entityId: s.id,
          text: `${s.name} has ${fmt.int(s.total)} career ${video.unit}.`,
        }));
    return {
      video,
      Chart: CHARTS[video.chart as WiredChart],
      stage: stageFor(video.id, srcFor(video.id), fallback, video.title),
    };
  });

for (const g of GENERATED) console.log(`${compositionIdFor(g.video)}: ${g.stage.source}`);

/* ---------------------------------------------------------- generic scripts */
const listScript = (rows: { id: string; name: string }[], say: (r: any) => string, pick: number[]) =>
  pick.filter((i) => rows[i]).map((i) => ({ entityId: rows[i].id, text: say(rows[i]) }));

const ranked = buildTimeline(listScript(rankedBar.rows as any, (r) =>
  `${r.name} tops the league at ${fmt.moneyShort(r.value)} this season.`, [0, 1, 2, 5, 9]));

const diverging = buildTimeline(listScript(divergingBar.rows as any, (r) =>
  `${r.name} are ${fmt.signed(r.value)} per game, ${r.wins} and ${r.losses}.`, [0, 1, 14, 28, 29]));

const proportion = buildTimeline(listScript(proportionBar.rows as any, (r) =>
  `${r.name} played ${r.games} games, ${fmt.pct(r.value)} of the season.`, [0, 1, 20, 40, 55]));

const delta = buildTimeline(listScript(barDelta.rows as any, (r) =>
  `${r.name} went from ${r.base} to ${r.now} points per game.`, [0, 1, 2, 30, 55, 58]));

const scat = buildTimeline(listScript(scatter.rows as any, (r) =>
  `${r.name} earns ${fmt.moneyShort(r.x)} and scores ${r.y} a game.`, [0, 3, 8, 20, 40]));

const strip = buildTimeline(listScript(dotStrip.rows as any, (r) =>
  `${r.name} stands ${fmt.height(r.y)} and weighs ${r.x} pounds.`, [0, 40, 200, 400, 520]));

const cap = buildTimeline((salaryCap.rows as any[]).slice(0, 6).map((r) => ({
  entityId: r.id, text: `${r.name} carries ${fmt.moneyShort(r.value)} against the cap.`,
})));

const tallest = [...dotStrip.rows].sort((a, b) => b.y - a.y).slice(0, 4).map((r) => r.id);
const heaviest = [...dotStrip.rows].sort((a, b) => b.x - a.x).slice(0, 3).map((r) => r.id);

/* ---------------------------------------------------------------- 09-11 */
const redraftTl = buildTimeline(SCRIPTS.C09);
const leaderMatrixTl = buildTimeline(SCRIPTS.C10);
const waffleTl = buildTimeline(SCRIPTS.C11);

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="C01-cumulative-lines" width={V.W} height={V.H} fps={V.FPS}
      durationInFrames={framesFor(cum.durationMs, V.FPS)}
      component={() => (
        <Frame title={cum.title} sub={cumulative.sub} logo={NBA_LOGO}>
          {cum.audio && <Audio src={staticFile(cum.audio)} />}
          <CumulativeLines data={cumulative as any} beats={cum.beats} />
        </Frame>
      )}
    />
    <Composition
      id="C01F-cumulative-lines-source-script" width={V.W} height={V.H} fps={V.FPS}
      durationInFrames={framesFor(full.durationMs, V.FPS)}
      component={() => (
        <Frame title={full.title} sub={cumulative.sub} logo={NBA_LOGO}>
          {full.audio && <Audio src={staticFile(full.audio)} />}
          <CumulativeLines data={cumulative as any} beats={full.beats} />
        </Frame>
      )}
    />
    {GENERATED.map(({ video, stage, Chart }) => (
      <Composition
        key={compositionIdFor(video)}
        id={compositionIdFor(video)} width={V.W} height={V.H} fps={V.FPS}
        durationInFrames={framesFor(stage.durationMs, V.FPS)}
        component={() => (
          <Frame title={stage.title} sub={video.sub} logo={NBA_LOGO}>
            {stage.audio && <Audio src={staticFile(stage.audio)} />}
            <Chart data={video} beats={stage.beats} />
          </Frame>
        )}
      />
    ))}
    <Composition
      id="C02-stacked-column-thresholds" width={V.W} height={V.H} fps={V.FPS}
      durationInFrames={framesFor(cap.durationMs, V.FPS)}
      component={() => (
        <Frame title={salaryCap.title} sub={salaryCap.sub} logo={(salaryCap as any).team.logo}>
          {/* `salaryCap.json` already IS `{ rows, thresholds }` at the top
              level, which is why the generated path could adopt this
              component's prop shape without a second one. */}
          <StackedColumn data={salaryCap as any} beats={cap.beats} />
        </Frame>
      )}
    />
    <Composition
      id="C03-ranked-bar" width={V.W} height={V.H} fps={V.FPS}
      durationInFrames={framesFor(ranked.durationMs, V.FPS)}
      component={() => (
        <Frame title={rankedBar.title} sub={rankedBar.sub} logo={NBA_LOGO}>
          <RankedBar rows={rankedBar.rows as any} beats={ranked.beats} format={fmt.moneyShort}
            color={(r: any) => byAbbr.get(r.abbr)?.color ?? PALETTE[0]}
            logoOf={(r: any) => byAbbr.get(r.abbr)?.logo} />
        </Frame>
      )}
    />
    <Composition
      id="C04-diverging-bar" width={V.W} height={V.H} fps={V.FPS}
      durationInFrames={framesFor(diverging.durationMs, V.FPS)}
      component={() => (
        <Frame title={divergingBar.title} sub={divergingBar.sub} logo={NBA_LOGO}>
          <RankedBar rows={divergingBar.rows as any} beats={diverging.beats} variant="diverging"
            format={(v) => fmt.signed(v)} color={(r) => (r.value >= 0 ? T.good : T.bad)}
            logoOf={(r: any) => r.logo} />
        </Frame>
      )}
    />
    <Composition
      id="C05-proportion-bar" width={V.W} height={V.H} fps={V.FPS}
      durationInFrames={framesFor(proportion.durationMs, V.FPS)}
      component={() => (
        <Frame title={proportionBar.title} sub={proportionBar.sub} logo={NBA_LOGO}>
          <RankedBar rows={proportionBar.rows as any} beats={proportion.beats} variant="proportion"
            format={fmt.pct} color={() => T.good} note={(r: any) => `${r.games} GP`} />
        </Frame>
      )}
    />
    <Composition
      id="C06-bar-delta" width={V.W} height={V.H} fps={V.FPS}
      durationInFrames={framesFor(delta.durationMs, V.FPS)}
      component={() => (
        <Frame title={barDelta.title} sub={barDelta.sub} logo={NBA_LOGO}>
          <BarDelta rows={barDelta.rows as any} beats={delta.beats} />
        </Frame>
      )}
    />
    <Composition
      id="C07-scatter-image" width={V.W} height={V.H} fps={V.FPS}
      durationInFrames={framesFor(scat.durationMs, V.FPS)}
      component={() => (
        <Frame title={scatter.title} sub={scatter.sub} logo={NBA_LOGO}>
          <Scatter data={scatter as any} beats={scat.beats} marker="logo-32"
            formatX={fmt.moneyShort} formatY={(v) => String(v)} />
        </Frame>
      )}
    />
    <Composition
      id="C08-dot-strip" width={V.W} height={V.H} fps={V.FPS}
      durationInFrames={framesFor(strip.durationMs, V.FPS)}
      component={() => (
        <Frame title={dotStrip.title} sub={dotStrip.sub} logo={NBA_LOGO}>
          <DotStrip data={dotStrip as any} beats={strip.beats} labelIds={[...tallest, ...heaviest]} />
        </Frame>
      )}
    />
    <Composition
      id="C09-slope-pair" width={V.W} height={V.H} fps={V.FPS}
      durationInFrames={framesFor(redraftTl.durationMs, V.FPS)}
      component={() => (
        <Frame title={redraft.title} sub={redraft.sub} logo={NBA_LOGO}>
          <SlopePair data={redraft as any} beats={redraftTl.beats} />
        </Frame>
      )}
    />
    <Composition
      id="C10-image-cell-matrix" width={V.W} height={V.H} fps={V.FPS}
      durationInFrames={framesFor(leaderMatrixTl.durationMs, V.FPS)}
      component={() => (
        <Frame title={leaderMatrix.title} sub={leaderMatrix.sub} logo={NBA_LOGO}>
          <ImageCellMatrix data={leaderMatrix as any} beats={leaderMatrixTl.beats} />
        </Frame>
      )}
    />
    <Composition
      id="C11-unit-waffle" width={V.W} height={V.H} fps={V.FPS}
      durationInFrames={framesFor(waffleTl.durationMs, V.FPS)}
      component={() => (
        <Frame title={waffle.title} sub={waffle.sub} logo={NBA_LOGO}>
          <UnitWaffle data={waffle as any} beats={waffleTl.beats} />
        </Frame>
      )}
    />
  </>
);
