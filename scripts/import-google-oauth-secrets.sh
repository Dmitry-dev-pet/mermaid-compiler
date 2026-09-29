#!/usr/bin/env bash
set -euo pipefail

CLIENT_JSON="${1:-}"
TARGET_REPO="${TARGET_REPO:-Dmitry-dev-pet/mermaid-compiler}"

if [[ -z "$CLIENT_JSON" ]]; then
  echo "Usage: $0 /path/to/client_secret_*.json" >&2
  exit 2
fi

if [[ ! -f "$CLIENT_JSON" ]]; then
  echo "OAuth client JSON not found: $CLIENT_JSON" >&2
  exit 2
fi

command -v gh >/dev/null 2>&1 || {
  echo "GitHub CLI (gh) is required." >&2
  exit 2
}

gh auth status >/dev/null 2>&1 || {
  echo "GitHub CLI is not authenticated. Run: gh auth login" >&2
  exit 2
}

python3 - "$CLIENT_JSON" "$TARGET_REPO" <<'PY'
import json
import subprocess
import sys
from pathlib import Path

client_path = Path(sys.argv[1]).expanduser()
repo = sys.argv[2]

data = json.loads(client_path.read_text(encoding="utf-8"))
web = data.get("web")
if not isinstance(web, dict):
    raise SystemExit(
        "Expected a Google OAuth client of type 'Web application' "
        "(JSON must contain a top-level 'web' object)."
    )

client_id = str(web.get("client_id") or "").strip()
client_secret = str(web.get("client_secret") or "").strip()
redirect_uris = [str(v).strip() for v in (web.get("redirect_uris") or [])]
javascript_origins = [str(v).strip() for v in (web.get("javascript_origins") or [])]

expected_redirect = (
    "https://wpefygslnzayhkgsvkju.supabase.co/auth/v1/callback"
)
expected_origin = (
    "https://mermaid-compiler-hrt94ln5k-dmitrys-projects-60af16a7.vercel.app"
)

if not client_id.endswith(".apps.googleusercontent.com"):
    raise SystemExit("Unexpected Google OAuth client_id format.")
if not client_secret:
    raise SystemExit("Google OAuth client_secret is missing.")
if expected_redirect not in redirect_uris:
    raise SystemExit(
        "OAuth client is missing the required Supabase callback URI:\n"
        f"  {expected_redirect}"
    )
if expected_origin not in javascript_origins:
    raise SystemExit(
        "OAuth client is missing the production JavaScript origin:\n"
        f"  {expected_origin}"
    )

for secret_name, secret_value in (
    ("GOOGLE_OAUTH_CLIENT_ID", client_id),
    ("GOOGLE_OAUTH_CLIENT_SECRET", client_secret),
):
    subprocess.run(
        ["gh", "secret", "set", secret_name, "--repo", repo],
        input=secret_value,
        text=True,
        check=True,
    )

print(
    "Stored GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET "
    f"in GitHub repository secrets for {repo}."
)
print("Secret values were not printed.")
PY
