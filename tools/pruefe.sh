#!/bin/sh
# pruefe.sh · Alles Statische in einem Aufruf, eine Zeile je Pruefung.
#
# Dieselben sechs Pruefungen wie in .github/workflows/ci.yml, in derselben
# Reihenfolge und mit denselben Befehlen — damit lokal grün auch dort grün
# heisst. Wer vor dem Push nur diesen einen Befehl aufruft, statt fuenf
# einzeln, spart sich fuenf Ausgaben und vergisst keine.
#
# Ohne Browser: Die Browsertests unter tests/e2e/ laufen getrennt, sie
# brauchen eine laufende Anwendung. Siehe CLAUDE.md.
#
# Endet mit 1, sobald eine Pruefung faellt, laeuft aber alle zu Ende: Ein
# Fund pro Lauf waere zu wenig, wenn drei da sind.

cd "$(dirname "$0")/.." || exit 1

fehler=0
zeile() {
  # $1 Name, $2 Status (0 = ok), $3 Kurztext bei Fund
  if [ "$2" -eq 0 ]; then
    printf '  ok    %s\n' "$1"
  else
    printf '  FEHLT %s\n' "$1"
    [ -n "$3" ] && printf '%s\n' "$3" | sed 's/^/        /'
    fehler=1
  fi
}

# 1 · PHP-Syntax, jede Datei
aus=$(find . -name '*.php' -not -path './vendor/*' -not -path './.git/*' -print0 \
      | xargs -0 -n1 php -l 2>&1 | grep -v 'No syntax errors')
zeile 'PHP-Syntax' "$([ -z "$aus" ] && echo 0 || echo 1)" "$aus"

# 2 · JavaScript-Syntax, jede ausgelieferte Datei
aus=$(find . -name '*.js' -not -path './.git/*' -not -path './vendor/*' -print0 \
      | xargs -0 -n1 node --check 2>&1)
zeile 'JavaScript-Syntax' "$([ -z "$aus" ] && echo 0 || echo 1)" "$aus"

# 3 · ES5-Zusage (CONTRIBUTING.md): keine Pfeilfunktionen, kein let/const,
#     kein async/await. Wortgleich mit der Action.
aus=$(find . -name '*.js' -not -path './.git/*' -not -path './vendor/*' -print0 \
      | xargs -0 grep -nE '=>|\b(let|const)[[:space:]]|\basync[[:space:]]|\bawait[[:space:]]')
zeile 'ES5-Zusage' "$([ -z "$aus" ] && echo 0 || echo 1)" "$aus"

# 4 · Funktionstest des Backends, in eigenem Datenverzeichnis
aus=$(php tests/api-test.php 2>&1)
if printf '%s' "$aus" | grep -q 'Alle Prüfungen bestanden'; then
  zeile 'api-test.php' 0
else
  zeile 'api-test.php' 1 "$(printf '%s' "$aus" | grep -v ' ok$' | tail -8)"
fi

# 5 · Beide Woerterbuecher vollstaendig
aus=$(node tools/i18n-check.js 2>&1)
zeile 'i18n-check' $? "$aus"

# 6 · Ersatztexte im HTML wie im Woerterbuch
aus=$(node tools/fallback-check.js 2>&1)
zeile 'fallback-check' $? "$aus"

if [ "$fehler" -eq 0 ]; then
  echo
  echo 'Alle Prüfungen bestanden.'
fi
exit $fehler
