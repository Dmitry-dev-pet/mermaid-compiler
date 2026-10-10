#!/bin/bash
set -euo pipefail
MERMAID_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  echo "Mermaid ChatGPT requires Node.js 22 or later. Install Node.js, then open this file again."
  read -r -p "Press Enter to close. "
  exit 1
fi
exec node "$MERMAID_DIR/agent/chatgpt/cli.mjs"
