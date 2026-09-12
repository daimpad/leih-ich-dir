#!/usr/bin/env python3
"""
Leih-Katalog · Schriften bauen
-------------------------------------------------------------------------------
Erzeugt aus den TrueType-Dateien des Erscheinungsbilds (Repository
daimpad/nozilla-ci, Ordner project/fonts) verkleinerte WOFF2-Dateien für
assets/fonts.

Die Schriften werden selbst ausgeliefert und nicht von Google-Servern geladen.
Das hat zwei Gründe: Die Anwendung soll ohne externe Ressourcen auskommen, und
ein Nachladen von fonts.gstatic.com würde die IP-Adresse jeder Besucherin an
einen Dritten übertragen.

Aufruf:
    pip install fonttools brotli
    python3 tools/build-fonts.py --source /pfad/zu/nozilla-ci/project/fonts

Die erzeugten .woff2-Dateien gehören ins Repository; dieses Skript muss nur
laufen, wenn das Erscheinungsbild seine Schriften ändert.
"""

import argparse
import pathlib
import sys

from fontTools import subset
from fontTools.ttLib import TTFont

# Latein samt Umlauten, typografischen Anführungszeichen, Strichen und Pfeilen.
UNICODES = (
    "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,"
    "U+2000-206F,U+2074,U+20AC,U+2122,U+2190-2193,U+2212,U+2215,U+FEFF,U+FFFD"
)

# Quelldatei → Zieldatei, Familie, Schnitt, Stil
FACES = [
    ("Inter-Regular.ttf",     "inter-400.woff2",      "Inter",      400, "normal"),
    ("Inter-SemiBold.ttf",    "inter-600.woff2",      "Inter",      600, "normal"),
    ("ZillaSlab-Medium.ttf",  "zillaslab-500.woff2",  "Zilla Slab", 500, "normal"),
    ("ZillaSlab-Bold.ttf",    "zillaslab-700.woff2",  "Zilla Slab", 700, "normal"),
    ("SpaceMono-Regular.ttf", "spacemono-400.woff2",  "Space Mono", 400, "normal"),
    ("SpaceMono-Bold.ttf",    "spacemono-700.woff2",  "Space Mono", 700, "normal"),
]

FONTS_CSS_HEAD = """/* Schriften des Erscheinungsbilds, selbst ausgeliefert.
   Erzeugt von tools/build-fonts.py aus den TrueType-Dateien in
   daimpad/nozilla-ci. Nicht von Hand bearbeiten. */
"""


def build(source: pathlib.Path, target: pathlib.Path) -> int:
    target.mkdir(parents=True, exist_ok=True)
    rules = [FONTS_CSS_HEAD]
    total = 0

    for filename, outname, family, weight, style in FACES:
        src = source / filename
        if not src.exists():
            print(f"fehlt: {src}", file=sys.stderr)
            return 1

        font = TTFont(str(src))
        options = subset.Options()
        options.layout_features = ["kern", "liga", "clig", "calt", "ccmp", "locl"]
        options.desubroutinize = True
        options.notdef_outline = False
        options.recalc_bounds = True
        options.drop_tables += ["DSIG"]
        options.flavor = "woff2"

        subsetter = subset.Subsetter(options=options)
        subsetter.populate(unicodes=subset.parse_unicodes(UNICODES))
        subsetter.subset(font)

        out = target / outname
        font.flavor = "woff2"
        font.save(str(out))
        font.close()

        size = out.stat().st_size
        total += size
        print(f"{outname:<24} {size / 1024:6.1f} KiB")

        rules.append(
            "\n@font-face {\n"
            f"  font-family: '{family}';\n"
            f"  font-style: {style};\n"
            f"  font-weight: {weight};\n"
            "  font-display: swap;\n"
            f"  src: url('{outname}') format('woff2');\n"
            "}\n"
        )

    (target / "fonts.css").write_text("".join(rules), encoding="utf-8")
    print(f"{'gesamt':<24} {total / 1024:6.1f} KiB")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="WOFF2-Schriften für den Leih-Katalog bauen")
    parser.add_argument("--source", required=True, help="Ordner project/fonts aus daimpad/nozilla-ci")
    parser.add_argument("--target", default="assets/fonts", help="Zielordner (Vorgabe: assets/fonts)")
    args = parser.parse_args()
    sys.exit(build(pathlib.Path(args.source), pathlib.Path(args.target)))
