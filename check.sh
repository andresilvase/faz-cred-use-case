#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 1 || ! "$1" =~ ^[0-9]+$ ]]; then
  echo "Uso: $0 <numero-da-tarefa>" >&2
  echo "Exemplo: $0 6" >&2
  exit 1
fi

task_number="$1"
prompt="\$loan-decision-verify-manual-tests ${task_number}"

exec codex exec \
  --sandbox workspace-write \
  "$prompt"

# Uncomment when you want to run the command with full access to the sandbox.
# exec codex exec \
#   --sandbox danger-full-access \
#   "$prompt"