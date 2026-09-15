#!/usr/bin/env bash
#
# Re-encode a show folder to 720p H.264 so the live channel spends far less CPU
# decoding it. Aimed at 1080p HEVC sources, which cost roughly 3x what H.264
# 720p does to decode, every second the channel is on the air.
#
#   scripts/reencode-show.sh "shows/Beavis And Butthead Reboot"
#
# Writes to a staging directory and never touches the source, so it is safe to
# run while the channel is streaming. Re-running skips work already done, so it
# can be interrupted and resumed. Swap the files in afterwards (see README at
# the end of the run).
#
# Tunables:  CRF=20  PRESET=slow  OUT_DIR=~/reencode/<show>  ENC_THREADS=3
set -uo pipefail

SHOW_DIR=${1:?usage: reencode-show.sh <show folder> [output dir]}
[ -d "$SHOW_DIR" ] || { echo "not a directory: $SHOW_DIR" >&2; exit 1; }
SHOW_NAME=$(basename "$SHOW_DIR")
OUT_DIR=${2:-"$HOME/reencode/$SHOW_NAME"}

FFMPEG=${FFMPEG_PATH:-"$(dirname "$0")/../node_modules/ffmpeg-static/ffmpeg"}
[ -x "$FFMPEG" ] || FFMPEG=$(command -v ffmpeg) || { echo "no ffmpeg found" >&2; exit 1; }
FFPROBE=${FFPROBE_PATH:-$(command -v ffprobe || true)}

CRF=${CRF:-20}
PRESET=${PRESET:-slow}
DEC_THREADS=${DEC_THREADS:-2}
ENC_THREADS=${ENC_THREADS:-3}
PROGRESS_EVERY=${PROGRESS_EVERY:-30}   # seconds of encoded content between progress lines
FPS=${FPS:-}                          # e.g. FPS=24 to force constant frame rate out

VF="scale=-2:'min(720,ih)'"
# A source with broken timestamps (an old MPEG-4 rip, say) produces a variable
# frame rate file that the live pipeline then fights every single packet.
# Forcing CFR here bakes the fix into the file instead.
[ -n "$FPS" ] && VF="$VF,fps=$FPS"

mkdir -p "$OUT_DIR"
LOG="$OUT_DIR/reencode.log"
say() { printf '%s %s\n' "$(date '+%H:%M:%S')" "$*" | tee -a "$LOG"; }

# Without this, Ctrl-C kills only the running ffmpeg. The script is not under
# set -e, so the loop treats that as a failed file and starts the next one —
# which looks exactly like Ctrl-C doing nothing.
interrupted() {
  trap - INT TERM
  printf '\n'
  say "interrupted — stopping. Completed files are kept; re-run to resume."
  rm -f "$OUT_DIR"/*.part
  exit 130
}
trap interrupted INT TERM

# NUL-delimited so spaces and apostrophes in filenames survive.
files=()
while IFS= read -r -d '' f; do files+=("$f"); done < <(
  find "$SHOW_DIR" -maxdepth 1 -type f \
    \( -iname '*.mkv' -o -iname '*.mp4' -o -iname '*.avi' \
       -o -iname '*.m4v' -o -iname '*.mov' -o -iname '*.ts' \) -print0 | sort -z
)

total=${#files[@]}
[ "$total" -eq 0 ] && { echo "no video files in $SHOW_DIR" >&2; exit 1; }
say "=== $SHOW_NAME: $total file(s) -> $OUT_DIR ==="
say "settings: crf=$CRF preset=$PRESET vf=$VF"

# A killed run can leave a partial file behind; it is never resumable.
find "$OUT_DIR" -maxdepth 1 -name '*.part' -delete 2>/dev/null

# This box filled its disk once already. Encoding writes a whole second copy of
# the library before anything is swapped in, so check there is room for it.
src_size=$(du -sh "$SHOW_DIR" 2>/dev/null | cut -f1)
avail=$(df -h "$OUT_DIR" | awk 'NR==2 {print $4}')
say "source $src_size, free on target $avail (a full second copy is written before you swap)"

duration() { [ -n "$FFPROBE" ] && "$FFPROBE" -v error -show_entries format=duration \
  -of default=nw=1:nk=1 "$1" 2>/dev/null || echo ""; }

ok=0; skipped=0; failed=0; i=0
for f in "${files[@]}"; do
  i=$((i + 1))
  base=$(basename "$f")
  out="$OUT_DIR/${base%.*}.mp4"

  if [ -s "$out" ]; then
    say "[$i/$total] skip, already done: $base"
    skipped=$((skipped + 1))
    continue
  fi

  src_d=$(duration "$f")
  if [ -n "$src_d" ]; then
    say "[$i/$total] encoding: $base ($(awk -v d="$src_d" 'BEGIN{printf "%d:%02d", d/60, d%60}'))"
  else
    say "[$i/$total] encoding: $base"
  fi
  start=$(date +%s)
  # nice: the live channels must win the CPU; this job can take as long as it takes.
  # -threads before -i bounds the decoder, -x264opts threads= bounds the encoder,
  # so this never uses more than DEC+ENC threads however many cores exist.
  # -map keeps only the first video and audio track: subtitle and data streams
  # from an mkv have no place in an mp4 and would fail the mux.
  if nice -n 19 "$FFMPEG" -nostdin -hide_banner -v error -y \
      -threads "$DEC_THREADS" -i "$f" \
      -map 0:v:0 -map '0:a:0?' -sn -dn \
      -c:v libx264 -crf "$CRF" -preset "$PRESET" -x264opts "threads=$ENC_THREADS" \
      -vf "$VF" -pix_fmt yuv420p \
      -c:a aac -b:a 160k -ac 2 -movflags +faststart \
      -progress pipe:1 -nostats -f mp4 "$out.part" 2>>"$LOG" \
      | awk -v dur="${src_d:-0}" -v every="$PROGRESS_EVERY" 'BEGIN { nxt = every }
          /^out_time_us=/ {
            split($0, a, "="); if (a[2] == "N/A") next;
            t = a[2] / 1000000;
            if (t >= nxt) {
              nxt = t + every;
              if (dur > 0) printf("       %d%% — %d:%02d of %d:%02d\n", t*100/dur, t/60, t%60, dur/60, dur%60);
              else         printf("       %d:%02d encoded\n", t/60, t%60);
              fflush();
            }
          }'; then
    mv -f "$out.part" "$out"
  else
    say "    FAILED: $base (see $LOG)"
    rm -f "$out.part"
    failed=$((failed + 1))
    continue
  fi

  # Sanity check: a truncated encode is worse than none, because it looks fine
  # in a listing and then cuts off mid-episode on air.
  out_d=$(duration "$out")
  if [ -n "$src_d" ] && [ -n "$out_d" ]; then
    if ! awk -v a="$src_d" -v b="$out_d" 'BEGIN { exit !(b > 0 && (a-b < 2 && b-a < 2)) }'; then
      say "    WARNING: duration mismatch, source ${src_d}s vs output ${out_d}s — check this one"
    fi
  fi
  say "    done in $(( $(date +%s) - start ))s  $(du -h "$out" | cut -f1)  (was $(du -h "$f" | cut -f1))"
  ok=$((ok + 1))
done

say "=== finished: $ok encoded, $skipped skipped, $failed failed ==="
[ "$failed" -gt 0 ] && say "Re-run to retry the failures; completed files are skipped."
cat <<EOF | tee -a "$LOG"

Nothing in "$SHOW_DIR" has been modified. To put the new files on the air:

  1. Stop the channel in the admin UI (or leave it — it reads the folder at launch).
  2. mkdir -p ~/originals/"$SHOW_NAME"
     mv "$SHOW_DIR"/*.mkv ~/originals/"$SHOW_NAME"/      # whatever the old extension is
     mv "$OUT_DIR"/*.mp4 "$SHOW_DIR"/
  3. Relaunch the channel so it rebuilds its concat list.

Keep ~/originals until you have watched enough of the channel to trust it.
EOF
