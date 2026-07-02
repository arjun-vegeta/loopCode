#!/bin/bash
set -e

echo "Building TypeScript codebase..."
npm run build

npx esbuild src/index.ts --bundle --platform=node --format=esm --outfile=dist/bundle.js --packages=external

echo "Generating Single Executable Application blob..."
node --experimental-sea-config sea-config.json

echo "Copying node binary..."
cp $(which node) loopcode

if [ "$(uname)" = "Darwin" ]; then
  echo "Removing codesign signature (macOS)..."
  codesign --remove-signature loopcode
fi

echo "Injecting blob into binary..."
SENTINEL=$(grep -a -o "NODE_SEA_FUSE_[a-f0-9]*" $(which node) | head -n 1)
echo "Found sentinel: $SENTINEL"

npx postject loopcode NODE_SEA_BLOB sea-prep.blob \
  --sentinel-fuse "$SENTINEL" \
  --macho-segment-name NODE_SEA

if [ "$(uname)" = "Darwin" ]; then
  echo "Signing binary ad-hoc (macOS)..."
  codesign --sign - loopcode
fi

echo "✓ LoopCode single executable binary created: ./loopcode"
