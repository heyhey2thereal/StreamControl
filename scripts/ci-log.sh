#!/usr/bin/env bash
#
# Execute une commande en consignant l'integralite de sa sortie dans le
# journal de compilation, puis en affichant cette sortie dans la console.
#
# Usage : scripts/ci-log.sh "Etiquette de l'etape" commande [arguments...]
#
# Le code de sortie de la commande est propage tel quel, pour que l'etape
# echoue correctement si la commande echoue.

set -uo pipefail

LABEL="${1:-commande}"
shift || true

LOG="${STREAMCONTROL_BUILD_LOG:-build-log.txt}"
mkdir -p "$(dirname "$LOG")" 2>/dev/null || true

separator='====================================================================='

{
  printf '\n%s\n' "$separator"
  printf '  %s\n' "$LABEL"
  printf '  debut    : %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  # %q conserve les guillemets, pour que la commande consignee soit exacte.
  printf '  commande : '
  printf '%q ' "$@"
  printf '\n'
  printf '%s\n' "$separator"
} | tee -a "$LOG"

started=$(date +%s)

# La sortie standard et la sortie d'erreur vont dans le journal et a l'ecran.
"$@" 2>&1 | tee -a "$LOG"
status=${PIPESTATUS[0]}

finished=$(date +%s)

printf '  -> code %s, duree %ss, fin %s\n' \
  "$status" "$((finished - started))" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" | tee -a "$LOG"

exit "$status"
