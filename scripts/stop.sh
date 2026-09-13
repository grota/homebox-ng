#!/usr/bin/env bash
# Stop what `scripts/dev.sh` started: the API and the Vite dev server, and the
# `pnpm` wrappers around them.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_FILE="$ROOT/.dev/state"

if [[ ! -f "$STATE_FILE" ]]; then
  echo "Nothing to stop — $STATE_FILE does not exist (was 'pnpm dev' ever run?)."
  exit 0
fi

names=(); pids=(); ports=()
while read -r name pid port; do
  [[ -n "${name:-}" && -n "${pid:-}" ]] || continue
  names+=("$name"); pids+=("$pid"); ports+=("${port:-?}")
done < "$STATE_FILE"

if [[ ${#pids[@]} -eq 0 ]]; then
  echo "Nothing to stop — $STATE_FILE is empty."
  rm -f "$STATE_FILE"
  exit 0
fi

# dev.sh started each server with `setsid`, so the recorded pid leads its own
# process group; signalling the group takes `pnpm` and the `node`/`vite` with it.
signal_group() { # <signal>
  local pid
  for pid in "${pids[@]}"; do
    kill "-$1" -- "-$pid" 2>/dev/null || kill "-$1" "$pid" 2>/dev/null || true
  done
}

signal_group TERM

# Give them a moment to shut down cleanly, then insist.
deadline=$((SECONDS + 5))
while (( SECONDS < deadline )); do
  any_alive=0
  for pid in "${pids[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then any_alive=1; fi
  done
  if (( any_alive == 0 )); then break; fi
  sleep 0.25
done

if (( any_alive == 1 )); then
  echo "==> Still alive after 5s, killing"
  signal_group KILL
  sleep 0.5
fi

rm -f "$STATE_FILE"

for i in "${!pids[@]}"; do
  if kill -0 "${pids[$i]}" 2>/dev/null; then
    echo "  ${names[$i]}    STILL RUNNING (pid ${pids[$i]})" >&2
  else
    echo "  ${names[$i]}    stopped"
  fi
done

# A port still held means something else owns it — say so, with the owner named,
# rather than leaving a silent lie behind. Only what this script started gets
# signalled; a stranger's server is reported, never killed.
for i in "${!ports[@]}"; do
  port="${ports[$i]}"
  [[ "$port" == "?" ]] && continue
  holder="$(ss -ltnpH "sport = :$port" 2>/dev/null | sed -n 's/.*pid=\([0-9]\+\).*/\1/p' | head -1)"
  if [[ -n "$holder" ]]; then
    echo "  warning: :$port is still held by pid $holder: $(ps -o args= -p "$holder" 2>/dev/null | cut -c1-70)" >&2
    echo "           (not started by this script — left alone)" >&2
  fi
done
