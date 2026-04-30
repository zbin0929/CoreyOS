#!/usr/bin/env bash
# Hermes v0.12 compatibility verification — run on macOS after upgrading Hermes.
# Exit 0 = all checks pass; exit 1 = something needs attention.

set -euo pipefail

HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
PASS=0
FAIL=0

ok() { echo "✅ $1"; PASS=$((PASS+1)); }
warn() { echo "⚠️  $1"; FAIL=$((FAIL+1)); }

# ── 1. state.db FTS5 column order ──────────────────────────────
DB="$HERMES_HOME/state.db"
if [ ! -f "$DB" ]; then
  warn "state.db not found at $DB — skip (fresh install)"
else
  COLS=$(sqlite3 "$DB" ".schema messages_fts" 2>/dev/null | tr '\n' ' ' | sed -n 's/.*fts5(\([^)]*\)).*/\1/p' | head -1)
  if [ -z "$COLS" ]; then
    warn "messages_fts table not found — Hermes may not have run yet"
  else
    FIRST_COL=$(echo "$COLS" | cut -d',' -f1 | tr -d ' ')
    if [ "$FIRST_COL" = "content" ]; then
      ok "messages_fts first column is 'content' — snippet(messages_fts,0,...) safe"
    else
      warn "messages_fts first column is '$FIRST_COL', expected 'content' — session_search may need update"
    fi
  fi
  TRIGRAM=$(sqlite3 "$DB" ".schema messages_fts_trigram" 2>/dev/null | tr '\n' ' ' | sed -n 's/.*fts5(\([^)]*\)).*/\1/p' | head -1)
  if [ -n "$TRIGRAM" ]; then
    ok "messages_fts_trigram found (v0.12 trigram index) — columns: $TRIGRAM"
  fi
fi

# ── 2. QQ Bot sandbox patch path ───────────────────────────────
QQ_CONST=""
for candidate in \
  "$HERMES_HOME/hermes-agent/gateway/platforms/qqbot/constants.py" \
  "$HERMES_HOME/hermes-agent/lib/python*/site-packages/hermes_cli/gateway/platforms/qqbot/constants.py"; do
  if [ -f "$candidate" ]; then
    QQ_CONST="$candidate"
    break
  fi
done

if [ -n "$QQ_CONST" ]; then
  ok "QQ Bot constants.py found at $QQ_CONST — sandbox patch path valid"
else
  warn "QQ Bot constants.py NOT found under $HERMES_HOME — sandbox patch may fail"
fi

# ── 3. Hermes version ──────────────────────────────────────────
VER=$(hermes --version 2>/dev/null | sed -n 's/.*v\([0-9][0-9]*\.[0-9][0-9]*\).*/\1/p' | head -1 || echo "unknown")
if [ "$VER" = "0.12" ]; then
  ok "Hermes version is $VER"
else
  warn "Hermes version is '$VER' — expected 0.12"
fi

# ── 4. Gateway health ──────────────────────────────────────────
if curl -sf http://127.0.0.1:8642/health >/dev/null 2>&1; then
  ok "Gateway /health responds"
else
  warn "Gateway /health not responding (may not be running)"
fi

# ── 5. config.yaml version ─────────────────────────────────────
CFG="$HERMES_HOME/config.yaml"
if [ -f "$CFG" ]; then
  CV=$(sed -n 's/^[[:space:]]*version:[[:space:]]*\([0-9]*\).*/\1/p' "$CFG" | head -1 || echo "missing")
  ok "config.yaml version field = $CV"
else
  warn "config.yaml not found at $CFG"
fi

# ── 6. jobs.json round-trip ────────────────────────────────────
JOBS="$HERMES_HOME/cron/jobs.json"
if [ ! -f "$JOBS" ]; then
  warn "cron/jobs.json not found — skip (no scheduler jobs yet)"
else
  if python3 -c "import json; d=json.load(open('$JOBS')); print('fields:', list(d.get('jobs',[{}])[0].keys()) if d.get('jobs') else 'empty')" 2>/dev/null; then
    ok "jobs.json parses OK"
  else
    warn "jobs.json parse error"
  fi
fi

# ── Summary ────────────────────────────────────────────────────
echo ""
echo "── Results: $PASS passed, $FAIL need attention ──"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
