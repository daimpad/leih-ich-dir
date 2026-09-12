# vendor/nozilla-ci

Unveränderte Kopie des Erscheinungsbilds aus
[daimpad/nozilla-ci](https://github.com/daimpad/nozilla-ci).

| | |
|---|---|
| Datei | `design-system.css` |
| Stand | `3bb38a3dacd000cdfb3cc4eb6c7acb80f902a78e` |
| Übernommen am | 12. September 2026 |

## Warum eine Kopie

Der Leih-Katalog kommt ohne Paketverwaltung und ohne Bauschritt aus. Eine
eingefrorene Kopie ist deshalb die einzige Form, in der sich ein fremdes
Stylesheet hier einbinden lässt. Die Datei bleibt Byte für Byte wie im
Ursprung, damit ein Abgleich ein einfacher Dateivergleich bleibt.

## Was hier nicht geändert wird

Nichts. Anpassungen für diese Anwendung gehören in `style.css`, die
ausschließlich über die Marken `--nz-*` und die Bausteine `.nz-*` arbeitet.
Wer hier eine Zahl ändert, verliert den Abgleich.

## Auffrischen

```bash
git clone --depth 1 https://github.com/daimpad/nozilla-ci /tmp/nozilla-ci
cp /tmp/nozilla-ci/design-system.css vendor/nozilla-ci/design-system.css
diff <(git show HEAD:vendor/nozilla-ci/design-system.css) vendor/nozilla-ci/design-system.css
```

Danach den Stand oben nachtragen und die Oberfläche gegenlesen: Das
Erscheinungsbild kann Bausteine ändern, nicht nur Werte.

## Schriften

Die Schriftdateien unter `assets/fonts/` stammen aus `project/fonts/`
desselben Ursprungs und werden mit `tools/build-fonts.py` zu WOFF2-Teilmengen
verkleinert. Sie werden selbst ausgeliefert, nicht von Google-Servern geladen.

## Zeichen

Die Zeichen in `index.html` sind Kopien aus `project/assets/icon-*.svg`.
Sie tragen die Signatur des Hauses, ein grünes Quadrat bei 54,54. Neue Zeichen
gehören in das Ursprungs-Repository und werden von dort übernommen, nicht hier
gezeichnet.
