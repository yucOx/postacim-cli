#!/usr/bin/env bash
# postacim masaüstü — pinned web bundle üretici.
#
# postacim deposundan web uygulamasını klonlayıp build eder, çıktıyı
# webapp/ içine kopyalar ve her dosyanın sha256'ini webapp/manifest.json'e
# yazar. Uygulama (src/main.js) postacim.dev'in SAYFA varlıklarını bu
# paketten servis eder; /api, /ws, /livekit gerçek ağa gider. Böylece ele
# geçen sunucu masaüstü istemcisine değiştirilmiş JS basamaz (ana depodaki
# "Web JS trust" sınırının masaüstü kapanışı).
#
# Kullanım:
#   npm run web:embed                    # en son v* etiketi (yoksa main)
#   POSTACIM_REF=main npm run web:embed  # dal/etiket seçimi
#   POSTACIM_GIT_URL=git@github.com:yucOx/postacim.git npm run web:embed
#                                        # özel klon adresi (ssh vb.)
set -euo pipefail

GIT_URL="${POSTACIM_GIT_URL:-https://github.com/yucOx/postacim.git}"

# varsayılan ref: en son v* etiketi; hiç etiket yoksa main
if [[ -z "${POSTACIM_REF:-}" ]]; then
  POSTACIM_REF="$(git ls-remote --tags --refs "$GIT_URL" 'refs/tags/v*' \
    | awk -F'\t' '{sub("refs/tags/", "", $2); print $2}' | sort -V | tail -1)"
  POSTACIM_REF="${POSTACIM_REF:-main}"
fi

SRC="$(mktemp -d /tmp/postacim-web-src.XXXXXX)"
trap 'rm -rf "$SRC"' EXIT

echo "[web:embed] klon: $GIT_URL @ $POSTACIM_REF"
git clone --depth 1 --branch "$POSTACIM_REF" "$GIT_URL" "$SRC"

# web/ pnpm kilidiyle gelir (package-lock yok) → kurulum pnpm ile
echo "[web:embed] kurulum + build"
(cd "$SRC/web" && npx --yes pnpm install --frozen-lockfile && npx --yes pnpm run build)

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
rm -rf "$ROOT/webapp"
cp -r "$SRC/web/dist" "$ROOT/webapp"

# manifest: her dosyanın (manifest'in kendisi hariç) sha256'i; yollar
# '/' köklü, index.html dahil. main.js bu listedeki hash'lerle servis
# öncesi doğrulama yapar.
node - "$ROOT/webapp" <<'NODE'
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const root = process.argv[2];
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name !== 'manifest.json')
      files.push({
        path: '/' + path.relative(root, p).split(path.sep).join('/'),
        sha256: createHash('sha256').update(fs.readFileSync(p)).digest('hex'),
      });
  }
})(root);
files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
fs.writeFileSync(
  path.join(root, 'manifest.json'),
  JSON.stringify({ files }, null, 2) + '\n',
);
console.log(`[web:embed] manifest: ${files.length} dosya`);
console.log(`[web:embed] ilk kayıt: ${files[0].path} ${files[0].sha256.slice(0, 16)}…`);
NODE
