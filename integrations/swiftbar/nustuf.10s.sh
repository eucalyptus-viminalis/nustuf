#!/bin/bash
# <xbar.title>nustuf</xbar.title>
# <xbar.version>v1.0</xbar.version>
# <xbar.desc>Shows what nustuf is serving from this Mac, with stop and copy-link actions.</xbar.desc>
# <xbar.dependencies>node,nustuf</xbar.dependencies>
# <swiftbar.hideAbout>true</swiftbar.hideAbout>
# <swiftbar.hideRunInTerminal>true</swiftbar.hideRunInTerminal>
#
# Install: brew install --cask swiftbar, then copy or symlink this file into your
# SwiftBar plugin folder. Set NUSTUF_CLI if nustuf lives somewhere unusual.

# SwiftBar starts plugins with a minimal PATH; add the usual Node locations.
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.volta/bin:$HOME/.local/share/fnm/aliases/default/bin:$PATH"
NVM_NODE=$(ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | tail -n 1)
[ -n "$NVM_NODE" ] && export PATH="$NVM_NODE:$PATH"

NUSTUF="${NUSTUF_CLI:-$(command -v nustuf)}"
if [ -z "$NUSTUF" ]; then
  echo "nustuf ? | color=#ff9500"
  echo "---"
  echo "nustuf CLI not found on PATH"
  echo "Set NUSTUF_CLI in the plugin's environment settings"
  exit 0
fi

exec "$NUSTUF" status --swiftbar
