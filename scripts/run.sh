#!/usr/bin/env bash
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
npm run build
mkdir -p bin
go build -o bin/yolu .
exec ./bin/yolu "$@"
