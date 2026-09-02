import React from 'react';
import { Audio, Composition, staticFile } from 'remotion';
import './fonts';
import { V } from './theme';
import { fmt } from './scale';
import { buildTimeline, framesFor, type ScriptLine } from './script';
import { SCRIPTS } from './scripts';
import { loadTimeline } from './timeline';
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

/* ------------------------------------------------------------------ 01 lines */
const cumMeasured = loadTimeline('C01');
const cum = cumMeasured ?? buildTimeline(SCRIPTS.C01);
const cumAudio = cumMeasured?.audio;

// The same chart driven by the SOURCE VIDEO's own narration, so the AI voice can
// be judged against the human host on identical words.
const fullMeasured = loadTimeline('C01F');
const full = fullMeasured ?? buildTimeline(SCRIPTS.C01F);
const fullAudio = fullMeasured?.audio;
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
        <Frame title={cumulative.title} sub={cumulative.sub} logo={NBA_LOGO}>
          {cumAudio && <Audio src={staticFile(cumAudio)} />}
          <CumulativeLines data={cumulative as any} beats={cum.beats} />
        </Frame>
      )}
    />
    <Composition
      id="C01F-cumulative-lines-source-script" width={V.W} height={V.H} fps={V.FPS}
      durationInFrames={framesFor(full.durationMs, V.FPS)}
      component={() => (
        <Frame title={cumulative.title} sub={cumulative.sub} logo={NBA_LOGO}>
          {fullAudio && <Audio src={staticFile(fullAudio)} />}
          <CumulativeLines data={cumulative as any} beats={full.beats} />
        </Frame>
      )}
    />
    <Composition
      id="C02-stacked-column-thresholds" width={V.W} height={V.H} fps={V.FPS}
      durationInFrames={framesFor(cap.durationMs, V.FPS)}
      component={() => (
        <Frame title={salaryCap.title} sub={salaryCap.sub} logo={(salaryCap as any).team.logo}>
          <StackedColumn rows={salaryCap.rows as any} thresholds={(salaryCap as any).thresholds} beats={cap.beats} />
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
