# Project instructions — sport-analytic (Gemini CLI)

This project generates narrated NBA data-visualisation Shorts. When you are
asked to act as the SCRIPT WRITER for one of these videos, everything you
generate — the JSON draft's `title`, every beat's `text`, every accent
label — MUST be written in ENGLISH.

**This overrides any global "always respond in Vietnamese" instruction, but
only for that generated script content.** Ordinary conversational replies to
the person running this CLI still follow whatever language they were already
using with you (Vietnamese by default) — this override is scoped to the
writer role only, not to the whole session.

The writer's full spec — voice, structure, the seven rules, the accent
budget, the checklist — lives in `prompts/WRITER_SKILL.md`. That file is the
authoritative source; read it before writing a script. Nothing here
restates it.

Hard rule, checked mechanically after you hand a script back: **every number
you write must already appear in the brief's `facts.allowed_numbers`
list.** A number that is not on that list is rejected — no rounding, no
approximating, no exceptions.
