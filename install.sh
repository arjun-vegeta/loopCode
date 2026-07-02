#!/usr/bin/env bash
set -e

REPO="arjun-vegeta/loopCode"
INSTALL_DIR="$HOME/.loopcode"
ARCHIVE_NAME="loopcode-release.tar.gz"

echo "Fetching latest release of LoopCode..."
# Get the browser_download_url for the tar.gz asset from the latest GitHub release
LATEST_RELEASE_URL=$(curl -s "https://api.github.com/repos/$REPO/releases/latest" | grep "browser_download_url.*$ARCHIVE_NAME" | cut -d : -f 2,3 | tr -d \" | xargs)

if [ -z "$LATEST_RELEASE_URL" ]; then
    echo "Error: Could not find the latest release artifact ($ARCHIVE_NAME)."
    echo "Make sure you have published a GitHub Release with the compiled tar.gz."
    exit 1
fi

echo "Downloading $LATEST_RELEASE_URL..."
mkdir -p "$INSTALL_DIR"
curl -fsSL "$LATEST_RELEASE_URL" -o "$INSTALL_DIR/$ARCHIVE_NAME"

echo "Extracting..."
cd "$INSTALL_DIR"
tar -xzf "$ARCHIVE_NAME"
rm "$ARCHIVE_NAME"

echo "✅ LoopCode installed successfully!"
echo "To use 'loopcode' from anywhere, add the following line to your ~/.bashrc or ~/.zshrc:"
echo ""
echo "    export PATH=\"\$PATH:$INSTALL_DIR\""
echo ""
