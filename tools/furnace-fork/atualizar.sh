#!/bin/sh
# Regera esta pasta a partir do fork do Furnace (uso: tools/furnace-fork/atualizar.sh /caminho/do/furnace)
set -e
F=${1:-/home/claude/furnace}
D=$(cd "$(dirname "$0")" && pwd)
B=$(cat "$D/BASE_COMMIT_tildearrow.txt")
cd "$F"
rm -f "$D"/*.patch "$D"/sdl/*.patch
git format-patch -q "$B" -o "$D"
SDLB=$(git ls-tree "$B" extern/SDL | awk '{print $3}')
mkdir -p "$D/sdl"
(cd extern/SDL && git format-patch -q "$SDLB" -o "$D/sdl")
rm -rf "$D/arquivos"
git diff --name-only --diff-filter=AM "$B" HEAD | while read f; do
  [ -f "$f" ] && { mkdir -p "$D/arquivos/$(dirname "$f")"; cp "$f" "$D/arquivos/$f"; }
done
(cd extern/SDL && git diff --name-only "$SDLB" HEAD | while read f; do
  mkdir -p "$D/arquivos/extern/SDL/$(dirname "$f")"; cp "$f" "$D/arquivos/extern/SDL/$f"; done)
git diff --name-status "$B" HEAD | grep -v "extern/SDL$" > "$D/arquivos/LISTA.txt"
echo "pronto: $(ls "$D"/*.patch | wc -l) alterações, $(find "$D/arquivos" -type f | wc -l) arquivos"
