# Archiv

Geparkt, nicht gelöscht: Was die Anwendung bis Oktober 2026 trug, bevor sie
in Knete umgestellt wurde. Erreichbar über Git, nicht im Betrieb — `archiv/`
ist gesperrt wie `tools/` und fehlt in der Pages-Vorschau.

Den vollständigen alten Stand, mit dem `index.html` dazu, hat Commit
`9cd4c5d` auf `main`.

## alter-stil/

| Datei | War |
| --- | --- |
| `style.css` | das Stylesheet der Anwendung: Papiergrün, weiße Karten, Ranchers |
| `fonts/` | Ranchers, Inter, Zilla Slab und das alte `fonts.css`; Space Mono ist weiter in `assets/fonts/` |
| `pics/logo.svg` | die Bildmarke: eine Katzenpfote mit Wollknäuel |
| `pics/pfote.svg` | die Pfote mit ihrer Leihliste im Hero |
| `pics/og.png` | das Vorschaubild beim Teilen |
| `favicon/` | die Zeichen der Anwendung in allen Größen |
| `og-vorlage.html` | die Vorlage, aus der `og.png` entstand |
| `site.webmanifest` | das Manifest mit den alten Farben |

Zurückholen: die Dateien an ihren alten Ort legen (Pfade wie in der Tabelle,
unter `assets/` bzw. in der Wurzel) und in `index.html` die Pfote und die
Bildmarke aus Commit `9cd4c5d` übernehmen.

## stilprobe/

Die Stilprobe, aus der der neue Stil kommt, mit ihrer Wächterin
`stilprobe.mjs`. Lokal läuft beides weiter:

    php -S 127.0.0.1:8099                 # in der Wurzel
    # dann /archiv/stilprobe/stilprobe.html im Browser
    node archiv/stilprobe/stilprobe.mjs   # 82 Zusicherungen

`tests/e2e/lauf.mjs` sieht die Suite nicht mehr.
