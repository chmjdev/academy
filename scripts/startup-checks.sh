#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

command -v node >/dev/null 2>&1 || { echo "[startup-checks] node binary missing" >&2; exit 1; }

[ -f "data/curriculum.json" ] || { echo "[startup-checks] data/curriculum.json missing" >&2; exit 1; }
[ -d "data/videos" ] || { echo "[startup-checks] data/videos directory missing" >&2; exit 1; }
[ -d "data/screenshots" ] || { echo "[startup-checks] data/screenshots directory missing" >&2; exit 1; }

node -e '
import fs from "node:fs";
try {
  const cur = JSON.parse(fs.readFileSync("data/curriculum.json", "utf8"));
  if (!cur.academy || !cur.lessons || cur.lessons.length === 0) process.exit(1);
} catch {
  process.exit(1);
}
' || { echo "[startup-checks] invalid curriculum.json format" >&2; exit 1; }

echo "[startup-checks] OK: all academy prerequisites satisfied."
exit 0
