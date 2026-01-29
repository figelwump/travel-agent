#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Travel Agent Service Uninstaller${NC}"
echo ""

USER_HOME="$HOME"
PLIST_PATH="$USER_HOME/Library/LaunchAgents/com.travelagent.server.plist"

# Check if service is loaded
if launchctl list | grep -q "com.travelagent.server"; then
    echo "Stopping service..."
    launchctl stop com.travelagent.server 2>/dev/null || true

    echo "Unloading service..."
    launchctl unload "$PLIST_PATH" 2>/dev/null || true
fi

# Remove plist file
if [ -f "$PLIST_PATH" ]; then
    echo "Removing LaunchAgent file..."
    rm "$PLIST_PATH"
fi

# Check if it's really gone
if launchctl list | grep -q "com.travelagent.server"; then
    echo -e "${RED}✗ Service may still be loaded${NC}"
    echo "Try running: launchctl remove com.travelagent.server"
    exit 1
else
    echo -e "${GREEN}✓ Service uninstalled successfully!${NC}"
    echo ""
    echo "Note: Log files are preserved at:"
    echo "  ~/Library/Logs/travel-agent-stdout.log"
    echo "  ~/Library/Logs/travel-agent-stderr.log"
    echo ""
    echo "To remove them:"
    echo "  rm ~/Library/Logs/travel-agent-*.log"
fi
