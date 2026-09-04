import { route, DataShape, ChartId } from './shape';

// Each case = the data shape of a real NBA Recap Pod Short, plus the chart
// type I identified by looking at that video's frames.
const CASES: { video: string; expect: ChartId; shape: DataShape }[] = [
  { video: '2019 NBA Draft - Total Points Scored', expect: 'cumulative-multiline',
    shape: { entities: 10, entityKind: 'player', measures: [{name:'points',type:'count'}],
      dims: [{name:'season',type:'time',steps:8}], cumulative: true, imageKey: 'headshot' } },

  { video: 'Can Wemby catch Hakeem in blocks?', expect: 'cumulative-multiline',
    shape: { entities: 5, entityKind: 'player', measures: [{name:'blocks',type:'count'}],
      dims: [{name:'careerYear',type:'time',steps:18}], cumulative: true, imageKey: 'headshot' } },

  // A record chase is one cumulative series plus one absolute mark, and it is
  // the shape the pipeline could not previously build: ESPN returns 5 of Wilt
  // Chamberlain's 14 seasons and zero rebounds, so the holder can never be a
  // second series — but a chase never needed one. `thresholds: 1` is the only
  // difference from the case above, and it is what must change the answer.
  { video: 'Can LeBron catch Wilt\'s career rebounds record?', expect: 'cumulative-record-chase',
    shape: { entities: 1, entityKind: 'player', measures: [{name:'rebounds',type:'count'}],
      dims: [{name:'season',type:'time',steps:23}], cumulative: true, thresholds: 1, imageKey: 'headshot' } },

  { video: 'Salary Cap Breakdown - Houston Rockets', expect: 'stacked-column-thresholds',
    shape: { entities: 15, entityKind: 'player', measures: [{name:'capHit',type:'money'}],
      dims: [], partOfWhole: true, thresholds: 5, imageKey: 'headshot' } },

  { video: 'The NBA in 2026 by plus/minus', expect: 'diverging-bar',
    shape: { entities: 450, entityKind: 'player', measures: [{name:'plusMinus',type:'signed'}],
      dims: [], imageKey: 'headshot' } },

  { video: 'The NBA\'s 20 Highest Salaries', expect: 'ranked-bar',
    shape: { entities: 20, entityKind: 'player', measures: [{name:'salary',type:'money'}],
      dims: [], imageKey: 'headshot' } },

  { video: 'Proportion of Games Played (Bridges->Zion)', expect: 'proportion-bar',
    shape: { entities: 50, entityKind: 'player', measures: [{name:'gamesPlayedPct',type:'ratio'}],
      dims: [], imageKey: 'headshot' } },

  { video: '1st Place Votes on the MVP Ballot', expect: 'proportion-bar',
    shape: { entities: 46, entityKind: 'season', measures: [{name:'voteShare',type:'ratio'}],
      dims: [], imageKey: 'headshot' } },

  { video: 'Biggest Risers and Fallers in the Playoffs', expect: 'bar-delta',
    shape: { entities: 120, entityKind: 'player', measures: [{name:'ppgRegular',type:'count'},{name:'ppgPlayoffs',type:'count'}],
      dims: [], paired: true, imageKey: 'headshot' } },

  { video: 'Salary and Points per Game in the NBA', expect: 'scatter-image',
    shape: { entities: 120, entityKind: 'player', measures: [{name:'salary',type:'money'},{name:'ppg',type:'count'}],
      dims: [], imageKey: 'logo' } },

  { video: 'Head Coaches by Length of Tenure (2nd view)', expect: 'scatter-image',
    shape: { entities: 30, entityKind: 'coach', measures: [{name:'winPct',type:'rate'},{name:'gamesCoached',type:'count'}],
      dims: [], imageKey: 'headshot' } },

  { video: 'How many teams have you played for?', expect: 'scatter-image',
    shape: { entities: 40, entityKind: 'player', measures: [{name:'teams',type:'count'},{name:'seasons',type:'count'}],
      dims: [], imageKey: 'headshot' } },

  { video: 'NBA Player Height & Weight', expect: 'dot-strip',
    shape: { entities: 480, entityKind: 'player', measures: [{name:'height',type:'count'},{name:'weight',type:'count'}],
      dims: [], imageKey: 'none' } },

  { video: 'Proportion of Shot Attempts from Different Distances', expect: 'ridgeline',
    shape: { entities: 45, entityKind: 'player', measures: [{name:'shotDistance',type:'count'}],
      dims: [], perEntityObservations: 900, imageKey: 'headshot' } },

  { video: 'An NBA Fan Survey - Most and Least Liked Teams', expect: 'heatmap-matrix',
    shape: { entities: 30, entityKind: 'team', measures: [{name:'likability',type:'signed'}],
      dims: [{name:'fanbase',type:'entity',steps:30},{name:'target',type:'entity',steps:30}], imageKey: 'logo' } },

  { video: 'Year by Year Stat Leaders', expect: 'image-cell-matrix',
    shape: { entities: 130, entityKind: 'player', measures: [],
      dims: [{name:'season',type:'time',steps:13},{name:'statCategory',type:'categorical',steps:10}],
      cellIsEntity: true, imageKey: 'headshot' } },

  { video: 'Every NBA Draft Pick Since 2000', expect: 'image-cell-matrix',
    shape: { entities: 1620, entityKind: 'pick', measures: [],
      dims: [{name:'year',type:'time',steps:27},{name:'pick',type:'ordinal',steps:60}],
      cellIsEntity: true, imageKey: 'college' } },

  { video: '2011 NBA RE-Draft', expect: 'slope-pair',
    shape: { entities: 30, entityKind: 'player', measures: [{name:'originalPick',type:'rank'},{name:'redraftPick',type:'rank'}],
      dims: [], rankPair: true, imageKey: 'headshot' } },

  { video: 'Every country and state in the NBA this season', expect: 'stacked-column-groups',
    shape: { entities: 14, entityKind: 'place', measures: [{name:'playerCount',type:'count'}],
      dims: [], partOfWhole: true, imageKey: 'flag' } },

  { video: 'Visualizing all of LeBron\'s 38,000+ Career Points', expect: 'unit-waffle',
    shape: { entities: 1, entityKind: 'player', measures: [{name:'points',type:'count'}],
      dims: [], partOfWhole: true, imageKey: 'headshot' } },

  { video: 'NBA Expansion - New Divisions and Conferences', expect: 'geo-pins',
    shape: { entities: 32, entityKind: 'team', measures: [],
      dims: [{name:'location',type:'geo'}], imageKey: 'logo' } },

  { video: 'The players who have multiple rings in the last 8 years', expect: 'timeline-rows',
    shape: { entities: 8, entityKind: 'season', measures: [],
      dims: [{name:'season',type:'time',steps:8}], imageKey: 'headshot' } },

  { video: 'Grading NBA Trades', expect: 'token-rows',
    shape: { entities: 12, entityKind: 'player', measures: [],
      dims: [], imageKey: 'headshot' } },
];

let pass = 0;
const rows: string[] = [];
for (const c of CASES) {
  const r = route(c.shape);
  const ok = r.chart === c.expect;
  if (ok) pass++;
  rows.push(
    `${ok ? 'PASS' : 'FAIL'}  ${c.video.slice(0, 46).padEnd(46)}  ` +
    `${r.chart.padEnd(26)}${ok ? '' : '  expected ' + c.expect}\n` +
    `        camera=${r.camera.padEnd(13)} marker=${r.marker.padEnd(13)} ${r.why}` +
    (r.warnings.length ? `\n        ! ${r.warnings.join(' | ')}` : '')
  );
}
console.log(rows.join('\n'));
console.log(`\n${pass}/${CASES.length} chart types chosen correctly from data shape alone.`);
