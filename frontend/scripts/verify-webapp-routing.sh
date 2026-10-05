#!/usr/bin/env bash
# Verifies the nginx fixes documented in docs/NGINX_WEBAPP_ROUTING.md and
# shipped as deploy/nginx/opendeck-webapp.conf:
#   1. the /webapp/ proxy (spec v3.0, issue 7.2)
#   2. the /sidebet-api/ proxy (separate backend process, same failure mode)
#   3. no-trailing-slash redirects for the three static demo games
#
# Run this FROM a machine that can actually reach opendeck.ca - it cannot
# be run from an isolated build/CI sandbox with restricted egress. On the
# AWS server itself, `curl -s http://127.0.0.1:8000/health` (and `:4000` for
# sidebet-server) is also a useful local sanity check that the backend
# process is up before blaming nginx for anything this script reports.
#
# Usage:
#   ./scripts/verify-webapp-routing.sh [base_url]
#   ./scripts/verify-webapp-routing.sh            # defaults to https://opendeck.ca
#   ./scripts/verify-webapp-routing.sh https://staging.opendeck.ca

set -uo pipefail

BASE_URL="${1:-https://opendeck.ca}"
FAIL=0

check() {
  local path="$1"
  local url="${BASE_URL}${path}"
  local body
  local status

  body="$(curl -s -m 10 "$url")"
  status="$(curl -s -m 10 -o /dev/null -w '%{http_code}' "$url")"

  echo "GET ${url}"
  echo "  status: ${status}"

  # A response is "still broken" if it looks like the SPA's index.html
  # (the exact failure mode this fix addresses) rather than JSON from the
  # backend.
  if echo "$body" | head -c 200 | grep -qi '<!doctype html>\|<html'; then
    echo "  ❌ FAIL - got HTML back (the SPA's index.html). The location"
    echo "     block either isn't applied, or nginx hasn't been reloaded,"
    echo "     or this hit the wrong server block."
    FAIL=1
  elif [ "$status" = "000" ]; then
    echo "  ❌ FAIL - no response at all (connection/DNS/TLS failure)."
    FAIL=1
  else
    echo "  ✅ OK - non-HTML response (JSON body or a JSON-shaped 404 are"
    echo "     both fine; the point is it's no longer the SPA's HTML)."
  fi
  echo
}

# A demo page's no-slash form must redirect (or otherwise resolve) to real
# content, not the SPA's index.html.
check_demo_redirect() {
  local path="$1"
  local url="${BASE_URL}${path}"
  local final_url
  local body

  final_url="$(curl -s -m 10 -o /dev/null -w '%{url_effective}' -L "$url")"
  body="$(curl -s -m 10 -L "$url")"

  echo "GET ${url} (following redirects)"
  echo "  final URL: ${final_url}"

  if ! echo "$body" | grep -qi "opendeck"; then
    echo "  ❌ FAIL - didn't land on recognizable demo content."
    FAIL=1
  elif [ "$final_url" = "$url" ] && [[ "$path" != */ ]]; then
    echo "  ⚠️  WARN - no redirect happened (curl -L only follows real 3xx"
    echo "     responses; if this still rendered the demo, either the"
    echo "     redirect is missing but something else is serving it"
    echo "     correctly, or double-check manually in a browser)."
  else
    echo "  ✅ OK - resolves to demo content."
  fi
  echo
}

echo "Verifying nginx /webapp/ proxy against ${BASE_URL}"
echo "============================================================"
check "/webapp/health"
check "/webapp/api/health"

echo "Verifying nginx /sidebet-api/ proxy against ${BASE_URL}"
echo "============================================================"
check "/sidebet-api/predictions"

echo "Verifying static demo page no-slash redirects against ${BASE_URL}"
echo "============================================================"
check_demo_redirect "/cashgame-demo"
check_demo_redirect "/heads-up"
check_demo_redirect "/RNG-shuffle-tester"

echo "============================================================"
if [ "$FAIL" -eq 0 ]; then
  echo "Result: PASS"
  exit 0
else
  echo "Result: FAIL - re-check docs/NGINX_WEBAPP_ROUTING.md's 'Where this"
  echo "goes' section and deploy/nginx/opendeck-webapp.conf: confirm you"
  echo "edited the server{} block nginx -T actually reports for"
  echo "opendeck.ca, and that 'sudo systemctl reload nginx' (or nginx -t"
  echo "&& reload) was run after saving the change."
  exit 1
fi
