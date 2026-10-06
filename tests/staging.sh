#!/usr/bin/env bash
# Banc de test complet en local : modèle simulé + émulateurs Firebase + vrai client + vraies fonctions.
# Usage : bash tests/staging.sh            (ou MOCK_NO_FORCED_TOOL=1 bash tests/staging.sh pour imiter un modèle sans tool_choice forcé)
set -e
cd "$(dirname "$0")/.."
export ANTHROPIC_BASE_URL="http://127.0.0.1:4010"
mkdir -p functions
printf 'ANTHROPIC_BASE_URL=http://127.0.0.1:4010\n' > functions/.env.local
printf 'ANTHROPIC_API_KEY=sk-ant-test-local-00000000000000000000000000000000\n' > functions/.secret.local
node tests/mock-model.js & MOCK=$!
trap 'kill $MOCK 2>/dev/null || true' EXIT
sleep 0.5
npx --no-install firebase emulators:exec --only auth,firestore,functions,hosting --project rituel-6b365 "node tests/staging-run.js"
