#!/usr/bin/env bash
# Regenerates the stable Tailwind-compiled CSS the design-sync converter reads
# (cfg.cssEntry). `pnpm build` runs the real @tailwindcss/vite plugin against
# src/styles.css, producing dist/client/assets/styles-<hash>.css with actual
# utility classes + @font-face rules — but Vite emits font url()s as
# root-absolute (/assets/xyz.woff2), which the converter's font extractor
# can't resolve. This copies the compiled CSS + font files to a stable
# directory and rewrites the urls to relative siblings.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

OUT=.design-sync/.cache/compiled-assets
rm -rf "$OUT"
mkdir -p "$OUT"

CSS_SRC=$(find dist/client/assets -iname "styles-*.css" | head -1)
if [ -z "$CSS_SRC" ]; then
  echo "compile-styles: no dist/client/assets/styles-*.css found — did pnpm build run?" >&2
  exit 1
fi

cp "$CSS_SRC" "$OUT/styles.css"
perl -pi -e 's{url\(/assets/}{url(./}g' "$OUT/styles.css"
cp dist/client/assets/*.woff2 "$OUT/" 2>/dev/null || true
cp dist/client/assets/*.woff "$OUT/" 2>/dev/null || true
cp dist/client/assets/*.ttf "$OUT/" 2>/dev/null || true
cp dist/client/assets/*.otf "$OUT/" 2>/dev/null || true

echo "compile-styles: wrote $OUT/styles.css ($(grep -c '@font-face' "$OUT/styles.css") @font-face rules)"
