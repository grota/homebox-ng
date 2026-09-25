#!/usr/bin/env bash
# Bring up the whole local dev stack in the background:
#
#   build (shared -> db -> api)  ->  seed  ->  API :3000  +  Vite :5173
#
# Shut it down again with `pnpm stop`.
#
# `pnpm dev --no-seed` leaves the seed step out, for a database that is already
# where you want it — or one you would rather not touch.
#
# The build is not optional: the API runs `node dist/index.js` and the web dev
# server resolves `@homebox/shared` through its built `dist/`. A stale dist does
# not fail to build — it fails at import time in the browser, naming a file that
# is perfectly correct on disk.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Every argument is a flag, so an unknown one is a typo — and a typo that silently
# seeded would be found only by noticing the fixtures changed. Refuse it instead.
NO_SEED=false
for arg in "$@"; do
  case "$arg" in
    --no-seed) NO_SEED=true ;;
    *) echo "Unknown argument: $arg (dev.sh takes --no-seed)" >&2; exit 1 ;;
  esac
done

RUN_DIR="$ROOT/.dev"
STATE_FILE="$RUN_DIR/state"
API_LOG="$RUN_DIR/api.log"
WEB_LOG="$RUN_DIR/web.log"
WEB_PORT="${WEB_PORT:-5173}"

# The API's port, resolved the way the server resolves it (`apps/api/src/env.ts`):
# the shell wins, then the repo-root `.env`, then the default. dev.sh exports the
# result, so dev.sh's own port checks, the API and Vite's proxy
# (`apps/web/vite.config.ts`) cannot disagree about where the API lives — a
# disagreement that shows up as probing the wrong port and tearing down a stack
# that came up perfectly.
env_port() {
  [[ -f "$ROOT/.env" ]] || return 0
  sed -n 's/^PORT=\([^#]*\).*/\1/p' "$ROOT/.env" | head -1 | tr -d '[:space:]'
}
API_PORT="${PORT:-$(env_port)}"
API_PORT="${API_PORT:-3000}"
export PORT="$API_PORT"

listener_pid() { # <port> — pid listening on it, if any
  ss -ltnpH "sport = :$1" 2>/dev/null | sed -n 's/.*pid=\([0-9]\+\).*/\1/p' | head -1
}

mkdir -p "$RUN_DIR"

# Don't stack a second stack on top of a running one.
if [[ -f "$STATE_FILE" ]]; then
  while read -r name pid _port; do
    if [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null; then
      echo "Already running ($name, pid $pid) — run 'pnpm stop' first." >&2
      exit 1
    fi
  done < "$STATE_FILE"
fi

# Refuse to start on top of someone else's server — before the slow build, not
# after. Without this the stack comes up half-dead and lies about it: the API
# dies with EADDRINUSE while Vite quietly takes the next free port, so the URLs
# printed at the end point at whatever was already running.
for port in "$API_PORT" "$WEB_PORT"; do
  if pid="$(listener_pid "$port")" && [[ -n "$pid" ]]; then
    echo "Port $port is already in use by pid $pid: $(ps -o args= -p "$pid" 2>/dev/null | cut -c1-70)" >&2
    echo "Stop that process — or 'pnpm stop' if this stack started it — then try again." >&2
    exit 1
  fi
done

# `.env` is gitignored, so a fresh clone or worktree has none — and the API
# refuses to boot without SESSION_SECRET. Generate one rather than failing with a
# message about a file the user has never seen. An existing `.env` is never touched.
if [[ ! -f "$ROOT/.env" ]]; then
  secret="$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"
  sed "s|^SESSION_SECRET=.*|SESSION_SECRET=$secret|" "$ROOT/.env.example" > "$ROOT/.env"
  echo "==> Created .env from .env.example (random SESSION_SECRET)"
fi

echo "==> Building shared, db, api"
pnpm exec turbo run build --filter=@homebox/api...

if "$NO_SEED"; then
  echo "==> Skipping seed (--no-seed)"
else
  echo "==> Seeding database"
  pnpm --filter @homebox/api seed
fi

# `setsid` puts each server in its own process group, so `pnpm stop` can signal
# the whole tree — `pnpm`, and the `node`/`vite` it spawns — at once. Without it
# the child survives the `pnpm` and keeps hold of the port.
#
# `--strictPort` keeps Vite honest: if the port is taken it must fail, not move
# to 5174 and leave the URL below pointing somewhere else. Invoked via `exec`
# because `pnpm ... dev -- --port N` hands Vite the literal `--` as an argument,
# which it ignores — along with the flags after it.
setsid pnpm --filter @homebox/api start >"$API_LOG" 2>&1 &
API_PID=$!
setsid pnpm --filter @homebox/web exec vite --port "$WEB_PORT" --strictPort >"$WEB_LOG" 2>&1 &
WEB_PID=$!

printf 'api %s %s\nweb %s %s\n' "$API_PID" "$API_PORT" "$WEB_PID" "$WEB_PORT" > "$STATE_FILE"

# Readiness means *this* server is up: the port answering is not enough, because
# a server that failed to bind leaves the very same port answering for whoever
# held it first.
wait_for() { # <label> <port> <pid> <log>
  for _ in $(seq 1 80); do
    if ! kill -0 "$3" 2>/dev/null; then
      echo "==> $1 exited before it listened on :$2 — last lines of $4:" >&2
      tail -20 "$4" >&2 || true
      return 1
    fi
    if (exec 3<>"/dev/tcp/127.0.0.1/$2") 2>/dev/null; then
      exec 3>&- 3<&- 2>/dev/null || true
      return 0
    fi
    sleep 0.5
  done
  echo "==> $1 never listened on :$2 — last lines of $4:" >&2
  tail -20 "$4" >&2 || true
  return 1
}

# A half-up stack is worse than no stack: bring it all down if either fails.
if ! wait_for API "$API_PORT" "$API_PID" "$API_LOG" ||
   ! wait_for web "$WEB_PORT" "$WEB_PID" "$WEB_LOG"; then
  bash "$ROOT/scripts/stop.sh" >/dev/null 2>&1 || true
  exit 1
fi

cat <<EOF

  API    http://localhost:$API_PORT
  Web    http://localhost:$WEB_PORT   (proxies /trpc /upload /file to :$API_PORT)
  Login  a@a.com / aaaaaaaa

  stop   pnpm stop

EOF

# Follow both servers here, each line tagged with where it came from. Two
# followers rather than `tail -f "$API_LOG" "$WEB_LOG"`, because tail reprints a
# full-path banner every time it switches file, which is constant here.
follow() { # <label> <log>
  tail -n +1 -f "$2" | sed -u "s/^/[$1] /"
}

# Ctrl-C must not read as "everything is down": the servers are in their own
# sessions and outlive this shell, so say which one it is and how to end it.
stop_following() {
  jobs -p | xargs -r kill 2>/dev/null || true
}
trap 'stop_following; printf "\nDetached. The stack is still running — %s to stop it.\n" "pnpm stop"; exit 0' INT TERM

follow api "$API_LOG" &
follow web "$WEB_LOG" &
wait
stop_following
