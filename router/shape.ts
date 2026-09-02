/**
 * Chart-type router — chooses the visualisation from the SHAPE of the data,
 * not from the topic. Reverse-engineered from 364 NBA Recap Pod Shorts.
 *
 * Frame budget assumed: 1080x1920, chart area ~1080x1250.
 */

export type MeasureType = 'count' | 'money' | 'ratio' | 'signed' | 'rank' | 'duration' | 'rate';
export type DimType = 'time' | 'ordinal' | 'categorical' | 'geo' | 'entity';
export type ImageKey = 'headshot' | 'logo' | 'flag' | 'college' | 'none';

export interface DataShape {
  entities: number;                 // distinct rows
  entityKind: 'player' | 'team' | 'coach' | 'season' | 'pick' | 'place';
  measures: { name: string; type: MeasureType }[];
  dims: { name: string; type: DimType; steps?: number }[];
  cumulative?: boolean;             // measure accumulates over the time dim
  partOfWhole?: boolean;            // measures sum to a meaningful total
  thresholds?: number;              // count of reference lines (cap, apron, tax…)
  rankPair?: boolean;               // two orderings of the same entities
  perEntityObservations?: number;   // >1 => a distribution per entity
  paired?: boolean;                 // before/after of the SAME measure
  imageKey: ImageKey;
  cellIsEntity?: boolean;           // dim x dim -> an entity, not a number
}

export type ChartId =
  | 'cumulative-multiline' | 'stacked-column-thresholds' | 'ranked-bar'
  | 'diverging-bar' | 'proportion-bar' | 'bar-delta' | 'scatter-image'
  | 'dot-strip' | 'ridgeline' | 'heatmap-matrix' | 'image-cell-matrix'
  | 'slope-pair' | 'stacked-column-groups' | 'unit-waffle'
  | 'geo-pins' | 'quadrant' | 'timeline-rows' | 'token-rows';

export interface Choice {
  chart: ChartId;
  camera: 'static' | 'scroll' | 'zoom-to-beat' | 'pan';
  marker: 'headshot-56' | 'headshot-40' | 'logo-32' | 'dot-10' | 'none';
  why: string;
  alternates: ChartId[];
  warnings: string[];
}

const ROW_H = 44;                  // px per row in a ranked list
const VISIBLE_ROWS = Math.floor(1250 / ROW_H);   // 28

export function route(s: DataShape): Choice {
  const m = s.measures;
  const timeDim = s.dims.find((d) => d.type === 'time');
  const geoDim = s.dims.find((d) => d.type === 'geo');
  const entityDims = s.dims.filter((d) => d.type === 'entity');
  const warnings: string[] = [];
  const alt: ChartId[] = [];

  const marker = (): Choice['marker'] =>
    s.imageKey === 'none' ? 'dot-10'
    : s.entities <= 14 ? 'headshot-56'
    : s.entities <= 40 ? 'headshot-40'
    : s.imageKey === 'logo' ? 'logo-32' : 'dot-10';

  // R1 — cumulative race
  if (s.cumulative && timeDim) {
    if (s.entities > 12) warnings.push(`${s.entities} series: cap at 12, fold the rest into a faded cohort`);
    return { chart: 'cumulative-multiline', camera: s.entities > 8 ? 'zoom-to-beat' : 'static',
      marker: 'headshot-56', why: 'a measure that accumulates over time, few enough entities to read as lines',
      alternates: ['slope-pair'], warnings };
  }

  // R2 — one group decomposed against reference lines
  if (s.partOfWhole && (s.thresholds ?? 0) > 0 && !timeDim) {
    return { chart: 'stacked-column-thresholds', camera: 'static', marker: 'headshot-40',
      why: 'parts of one budget, judged against fixed thresholds', alternates: ['ranked-bar'], warnings };
  }

  // R11 — matrix whose cells are entities
  if (s.cellIsEntity && s.dims.length >= 2) {
    const cells = (s.dims[0].steps ?? 1) * (s.dims[1].steps ?? 1);
    if (cells > 900) warnings.push(`${cells} cells: needs a zoom-out establishing shot then zoom-to-beat`);
    return { chart: 'image-cell-matrix', camera: cells > 200 ? 'zoom-to-beat' : 'static',
      marker: s.imageKey === 'headshot' ? 'headshot-40' : 'logo-32',
      why: 'two dimensions crossing to name an entity, not to measure one', alternates: ['heatmap-matrix'], warnings };
  }

  // R10 — entity x entity -> number
  if (entityDims.length >= 2 && m.length === 1) {
    return { chart: 'heatmap-matrix', camera: 'pan', marker: 'logo-32',
      why: 'every entity scored against every other entity', alternates: ['image-cell-matrix'], warnings };
  }

  // R12 — two rank orderings
  if (s.rankPair) {
    return { chart: 'slope-pair', camera: 'zoom-to-beat', marker: 'headshot-56',
      why: 'the story is movement between two orderings, so the connector is the data',
      alternates: ['bar-delta'], warnings };
  }

  // R9 — a distribution per entity
  if ((s.perEntityObservations ?? 1) > 1) {
    if (s.entities > 60) warnings.push('over 60 ridges stops being readable; sample or bucket');
    return { chart: 'ridgeline', camera: 'scroll', marker: 'none',
      why: 'each entity carries a shape, not a single value', alternates: ['dot-strip', 'heatmap-matrix'], warnings };
  }

  // R15 — geography
  if (geoDim) {
    return { chart: 'geo-pins', camera: 'zoom-to-beat', marker: s.imageKey === 'flag' ? 'logo-32' : 'logo-32',
      why: 'position on earth is the point', alternates: ['stacked-column-groups', 'ranked-bar'], warnings };
  }

  // R14 — one big total decomposed into units
  if (s.entities === 1 && s.partOfWhole && m.length >= 1) {
    return { chart: 'unit-waffle', camera: 'static', marker: 'none',
      why: 'one headline total whose scale is the story; units make it felt', alternates: ['stacked-column-thresholds'], warnings };
  }

  // R6 — before / after of the same measure
  if (s.paired) {
    return { chart: 'bar-delta', camera: 'scroll', marker: 'headshot-40',
      why: 'same measure twice: the gap is the data', alternates: ['slope-pair', 'scatter-image'], warnings };
  }

  // R7 / R8 — two measures
  if (m.length >= 2 && !timeDim) {
    if (s.entities > 150) {
      return { chart: 'dot-strip', camera: 'pan', marker: 'dot-10',
        why: 'too many points for image markers; density is the message',
        alternates: ['scatter-image'], warnings };
    }
    if (s.entities === 30 && m.every((x) => x.type === 'rate')) alt.push('quadrant');
    return { chart: 'scatter-image', camera: s.entities > 20 ? 'zoom-to-beat' : 'static', marker: marker(),
      why: 'two independent measures; position in the plane is the comparison',
      alternates: [...alt, 'ranked-bar'], warnings };
  }

  // R17 — one entity (or a few) per time step
  if (timeDim && !m.length) {
    return { chart: 'timeline-rows', camera: 'scroll', marker: 'headshot-40',
      why: 'time indexes a roster, there is nothing to measure', alternates: ['image-cell-matrix'], warnings };
  }

  // R18 — entity carries a bag of assets
  if (!m.length) {
    return { chart: 'token-rows', camera: 'scroll', marker: 'headshot-40',
      why: 'the payload is a set of assets per row, not a magnitude', alternates: ['ranked-bar'], warnings };
  }

  // R13 — groups sized by member count, members individually visible
  if (s.partOfWhole && s.entities >= 5 && s.entities <= 20) {
    return { chart: 'stacked-column-groups', camera: 'pan', marker: 'logo-32',
      why: 'group totals compared, individual members still countable',
      alternates: ['ranked-bar'], warnings };
  }

  // R4 / R5 / R3 — single measure over many entities
  const one = m[0];
  if (one.type === 'signed') {
    if (s.entities > VISIBLE_ROWS) warnings.push(`${s.entities} rows > ${VISIBLE_ROWS} visible: scroll, and spotlight only narrated rows`);
    return { chart: 'diverging-bar', camera: s.entities > VISIBLE_ROWS ? 'scroll' : 'static', marker: 'none',
      why: 'the sign carries meaning, so the baseline must sit in the middle',
      alternates: ['ranked-bar'], warnings };
  }
  if (one.type === 'ratio') {
    return { chart: 'proportion-bar', camera: s.entities > VISIBLE_ROWS ? 'scroll' : 'static', marker: 'none',
      why: 'a share of a whole reads best as a filled track against a common 100%',
      alternates: ['ranked-bar', 'dot-strip'], warnings };
  }
  if (s.entities > VISIBLE_ROWS) warnings.push(`${s.entities} rows > ${VISIBLE_ROWS} visible: scroll`);
  return { chart: 'ranked-bar', camera: s.entities > VISIBLE_ROWS ? 'scroll' : 'static', marker: 'none',
    why: 'one measure, many entities, order is the message',
    alternates: ['dot-strip', 'scatter-image'], warnings };
}
