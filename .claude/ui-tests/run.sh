#!/usr/bin/env bash
# Run the UI test harness against index.html.
#
# Headless (default): prints the harness results as JSON on stdout.
#   Exit code: 0 if every test passed, 1 if any failed, 2 if the harness could not run.
#
# Visible (--visible): opens a normal Chrome window (separate temporary
#   profile) on a test copy of the page. A live panel lists each test as it
#   runs, a highlight follows each element the test touches, and a
#   "Download JSON report" button appears at the end. Returns immediately;
#   the run takes about a minute because steps are slowed down to watch.
#
# Usage: .claude/ui-tests/run.sh [--visible] [path/to/index.html]
set -euo pipefail

visible=0
if [ "${1:-}" = "--visible" ]; then visible=1; shift; fi

here="$(cd "$(dirname "$0")" && pwd)"
page="${1:-$here/../../index.html}"
chrome="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"

[ -f "$page" ] || { echo "index.html not found: $page" >&2; exit 2; }
[ -x "$chrome" ] || { echo "Chrome not found; set CHROME=/path/to/chrome" >&2; exit 2; }

tmp="$(mktemp -d "${TMPDIR:-/tmp}/ui-tests.XXXXXX")"
# Headless runs clean up at once; a visible window keeps its copy until you close it
if [ "$visible" = 0 ]; then trap 'rm -rf "$tmp"' EXIT; fi

# Copy the page and inject the harness just before </body>
python3 - "$page" "$here/harness.js" "$tmp/page.html" "$visible" <<'PY'
import sys
page, harness, out, visible = sys.argv[1:5]
html = open(page, encoding="utf-8").read()
js = open(harness, encoding="utf-8").read()
marker = "</body>"
if marker not in html:
    sys.exit("no </body> in page")
flag = '<script id="ui-test-flag">window.__UI_TEST_VISUAL = true;</script>\n' if visible == "1" else ""
html = html.replace(marker, flag + '<script id="ui-test-harness">\n' + js + "\n</script>\n" + marker, 1)
open(out, "w", encoding="utf-8").write(html)
PY

if [ "$visible" = 1 ]; then
  # Its own profile, so it opens a new window even if Chrome is already running
  "$chrome" --user-data-dir="$tmp/profile" --no-first-run --no-default-browser-check \
    --window-size=1440,960 --new-window "file://$tmp/page.html" >/dev/null 2>&1 &
  echo "Opened a Chrome window running the UI tests (about 1 minute)."
  echo "Test copy: $tmp/page.html (delete $tmp when you are done)"
  exit 0
fi

# Virtual time lets the 10 s help-popup test finish instantly
"$chrome" --headless=new --disable-gpu --no-first-run --virtual-time-budget=60000 \
  --window-size=1440,900 --dump-dom "file://$tmp/page.html" 2>/dev/null > "$tmp/dom.html" || true

python3 - "$tmp/dom.html" <<'PY'
import base64, json, re, sys
dom = open(sys.argv[1], encoding="utf-8", errors="replace").read()
m = re.search(r'data-ui-results="([A-Za-z0-9+/=]+)"', dom)
if not m:
    print(json.dumps({"harness_version": None, "results": [], "errors": ["Harness produced no results (page failed to load or run)"]}, indent=2))
    sys.exit(2)
data = json.loads(base64.b64decode(m.group(1)).decode("utf-8"))
print(json.dumps(data, indent=2, ensure_ascii=False))
sys.exit(0 if all(r["passed"] for r in data["results"]) and not data["errors"] else 1)
PY
