#!/bin/sh
# Render the source-script composition and build the listening A/B.
set -e
cd "$(dirname "$0")/.."
echo "== render =="
npx tsx scripts/render-videos.ts C01F-cumulative-lines-source-script 2>&1 | grep -E '\->|bundled'
echo "== sync check: do beat changes land in real silences? =="
node -e '
const t=require("./src/data/timeline-C01F.json");
console.log("  beats:", t.beats.map(b=>(b.startMs/1000).toFixed(2)).join("  "));
'
ffmpeg -hide_banner -i out/C01F-cumulative-lines-source-script.mp4 -af "silencedetect=n=-40dB:d=0.15" -f null - 2>&1 \
  | grep -oE "silence_(start|end): [0-9.]+" | paste - - | sed 's/^/  /'
echo "== A/B =="
npx tsx scripts/ab.ts
