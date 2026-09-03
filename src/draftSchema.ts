/**
 * The JSON Schema handed to an LLM CLI so it returns a `Draft` (verify.ts)
 * directly, instead of free text we then have to fence-strip and hope parses.
 *
 * Built from `Draft` by hand, in its own exported function — not inlined in
 * scripts/write.ts — specifically so a test can assert its shape without
 * spawning a CLI.
 *
 * Measured against `codex exec --output-schema`: OpenAI's strict
 * structured-output mode requires EVERY key that appears in an object's
 * `properties` to also appear in that object's `required` array. A field
 * that is optional in the TypeScript type (`Accent.at`, `Accent.text`,
 * `Draft['beats'][number]['accents']`, `...['ending']`) is expressed here by
 * unioning its `type` with `"null"` and still listing it in `required` — NOT
 * by omitting it from `required`, which fails fast (~4s,
 * `"code":"invalid_json_schema"`) rather than ever reaching the model.
 */
import { ACCENT_KINDS } from './accent';

export function buildDraftSchema() {
  const anchorSchema = {
    type: ['object', 'null'],
    additionalProperties: false,
    required: ['entityId', 'step'],
    properties: {
      entityId: { type: 'string' },
      // Anchor.step is `string | number` in accent.ts; the writer is always
      // instructed to use a season-label string, but the schema mirrors the
      // TS type faithfully rather than narrowing it on the schema's own
      // authority — verifyDraft is what actually enforces the anchor_steps
      // allowlist.
      step: { type: ['string', 'number', 'null'] },
    },
  };

  const accentSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['t', 'kind', 'at', 'text'],
    properties: {
      t: { type: 'number', minimum: 0, maximum: 1 },
      kind: { type: 'string', enum: [...ACCENT_KINDS] },
      at: anchorSchema,
      text: { type: ['string', 'null'] },
    },
  };

  const beatSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['text', 'entityId', 'accents', 'ending'],
    properties: {
      text: { type: 'string' },
      entityId: { type: 'string' },
      // Optional in Draft — nullable, still required, per the strict-mode
      // rule above.
      accents: { type: ['array', 'null'], items: accentSchema },
      ending: { type: ['string', 'null'], enum: ['thesis', 'hard-cut', 'open-question', null] },
    },
  };

  return {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'beats'],
    properties: {
      title: { type: 'string' },
      beats: { type: 'array', items: beatSchema },
    },
  };
}
