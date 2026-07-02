#!/usr/bin/env bash
set -e

REPO="arjun-vegeta/loopCode"
INSTALL_DIR="$HOME/.loopcode"
BIN_DIR="/usr/local/bin"
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
if [ "$OS" = "darwin" ]; then
    ARCHIVE_NAME="loopcode-macos.tar.gz"
elif [ "$OS" = "linux" ]; then
    ARCHIVE_NAME="loopcode-linux.tar.gz"
else
    echo "Unsupported OS: $OS"
    exit 1
fi

echo "Fetching latest release of LoopCode..."
LATEST_RELEASE_URL=$(curl -s "https://api.github.com/repos/$REPO/releases/latest" | grep "browser_download_url.*$ARCHIVE_NAME" | cut -d : -f 2,3 | tr -d \" | xargs)

if [ -z "$LATEST_RELEASE_URL" ]; then
    echo "Error: Could not find the latest release artifact ($ARCHIVE_NAME) on GitHub."
    echo "Make sure you have published a GitHub Release with the compiled tar.gz."
    exit 1
fi

echo "Downloading LoopCode from: $LATEST_RELEASE_URL"
mkdir -p "$INSTALL_DIR"
curl -L "$LATEST_RELEASE_URL" -o "$INSTALL_DIR/$ARCHIVE_NAME"

echo "Extracting LoopCode..."
tar -xzf "$INSTALL_DIR/$ARCHIVE_NAME" -C "$INSTALL_DIR"
rm "$INSTALL_DIR/$ARCHIVE_NAME"

echo "Installing loopcode binary..."
if [ -w "$BIN_DIR" ]; then
    ln -sf "$INSTALL_DIR/loopcode" "$BIN_DIR/loopcode"
    echo "✓ LoopCode installed to $BIN_DIR/loopcode"
else
    LOCAL_BIN="$HOME/.local/bin"
    mkdir -p "$LOCAL_BIN"
    ln -sf "$INSTALL_DIR/loopcode" "$LOCAL_BIN/loopcode"
    echo "✓ LoopCode installed to $LOCAL_BIN/loopcode"
    echo "Please ensure $LOCAL_BIN is in your PATH."
fi
