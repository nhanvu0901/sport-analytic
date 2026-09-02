#!/bin/sh
# Two-pass loudnorm to -14 LUFS. Pass 1 measures, pass 2 feeds the measurements
# back — single-pass has to guess and lands several LU short on compressed material.
set -e
IN="$1"; OUT="$2"
J=$(ffmpeg -hide_banner -nostdin -i "$IN" -af "loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json" -f null - 2>&1 \
    | awk '/^\{/,/^\}/' )
get() { printf '%s' "$J" | sed -n "s/.*\"$1\"[ ]*:[ ]*\"\{0,1\}\([-0-9.]*\)\"\{0,1\}.*/\1/p" | head -1; }
I=$(get input_i); TP=$(get input_tp); LRA=$(get input_lra); TH=$(get input_thresh); OFF=$(get target_offset)
if [ -n "$I" ]; then
  echo "  pass 1: measured $I LUFS"
  ffmpeg -hide_banner -loglevel error -i "$IN" \
    -af "loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=$I:measured_TP=$TP:measured_LRA=$LRA:measured_thresh=$TH:offset=$OFF:linear=true" \
    -ac 1 -ar 48000 -y "$OUT"
else
  echo "  pass 1 gave no measurements — single pass"
  ffmpeg -hide_banner -loglevel error -i "$IN" -af "loudnorm=I=-14:TP=-1.5:LRA=11" -ac 1 -ar 48000 -y "$OUT"
fi
