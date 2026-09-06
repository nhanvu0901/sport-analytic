/**
 * `npx tsx scripts/write.ts <briefId> [--force]`
 *
 * Thin CLI over `writeDraft` in `src/writer.ts` — that module builds the
 * prompt, spawns `agy`, parses, verifies, caches, and writes `out/draft-<id>.json`
 * plus the `src/data/` mirror. This file only parses argv, prints the
 * resulting log lines, and maps the three failure classes to exit codes:
 *
 *   auth    (2) — no oauth token, agy missing from PATH, or agy reports an
 *                 auth failure. Nothing was written; there is a one-line remedy.
 *   refused (3) — agy ran and came back with `status: ERROR`, or with a
 *                 `.response` that has no JSON object in it. agy's own `error`
 *                 field is printed, because it is descriptive.
 *   rules   (4) — a draft parsed, but `verifyDraft` returned violations.
 *
 * There is no `--engine` flag and no codex path. `agy` is the only engine —
 * see `src/writer.ts` for why, and for the four load-bearing details of the
 * invocation itself.
 */
import { writeDraft } from '../src/writer';

function parseArgs(argv: string[]): { id?: string; force: boolean } {
  const id = argv[0];
  let force = false;
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--force') { force = true; continue; }
    // A stale `--engine codex` invocation should say why it stopped working,
    // not silently write a draft from the wrong writer.
    if (argv[i] === '--engine') {
      console.error('the --engine flag is gone: agy (Gemini) is the only writer, and codex was removed.');
      process.exit(1);
    }
    console.error(`unknown argument "${argv[i]}" — usage: tsx scripts/write.ts <briefId> [--force]`);
    process.exit(1);
  }
  return { id, force };
}

const { id, force } = parseArgs(process.argv.slice(2));
if (!id || id.startsWith('-')) {
  console.error('usage: tsx scripts/write.ts <briefId> [--force]');
  process.exit(1);
}

try {
  const result = await writeDraft(id, { force, onLog: (line) => console.log(line) });
  if (!result.ok) {
    if (result.kind === 'auth') process.exit(2);
    if (result.kind === 'refused') process.exit(3);
    if (result.kind === 'rules') process.exit(4);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
