#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Travel Agent Service Installer${NC}"
echo ""

# Check if bun is installed
if ! command -v bun &> /dev/null; then
    # Check default Bun install location
    if [ -f "$HOME/.bun/bin/bun" ]; then
        echo "Bun found at ~/.bun/bin/bun (not in PATH)"
        export PATH="$HOME/.bun/bin:$PATH"
    else
        echo -e "${RED}Error: Bun is not installed${NC}"
        echo "Run: ./scripts/install-dependencies.sh"
        exit 1
    fi
fi

# Get the directory of this script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"

echo "Project directory: $PROJECT_DIR"
echo ""

# Check if .env exists
if [ ! -f "$PROJECT_DIR/.env" ]; then
    echo -e "${RED}Error: .env file not found${NC}"
    echo "Please copy .env.example to .env and configure it first"
    exit 1
fi

# Check for AUTH_PASSWORD
if ! grep -q "^AUTH_PASSWORD=..*" "$PROJECT_DIR/.env"; then
    echo -e "${YELLOW}Warning: AUTH_PASSWORD is not set in .env${NC}"
    echo "It's strongly recommended to set a password for security."
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Update plist with correct paths
PLIST_FILE="$PROJECT_DIR/com.travelagent.server.plist"

# Find bun path
BUN_PATH=$(which bun 2>/dev/null)
if [ -z "$BUN_PATH" ] && [ -f "$HOME/.bun/bin/bun" ]; then
    BUN_PATH="$HOME/.bun/bin/bun"
fi

USER_HOME="$HOME"

echo "Configuring LaunchAgent..."
echo "  Bun path: $BUN_PATH"
echo "  Working directory: $PROJECT_DIR"
echo "  User home: $USER_HOME"
echo ""

# Create a temporary plist with updated paths
cat > "$PLIST_FILE.tmp" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>com.travelagent.server</string>

	<key>ProgramArguments</key>
	<array>
		<string>$BUN_PATH</string>
		<string>run</string>
		<string>start</string>
	</array>

	<key>WorkingDirectory</key>
	<string>$PROJECT_DIR</string>

	<key>EnvironmentVariables</key>
	<dict>
		<key>PATH</key>
		<string>$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
	</dict>

	<key>RunAtLoad</key>
	<true/>

	<key>KeepAlive</key>
	<dict>
		<key>SuccessfulExit</key>
		<false/>
	</dict>

	<key>StandardOutPath</key>
	<string>$USER_HOME/Library/Logs/travel-agent-stdout.log</string>

	<key>StandardErrorPath</key>
	<string>$USER_HOME/Library/Logs/travel-agent-stderr.log</string>

	<key>ProcessType</key>
	<string>Interactive</string>
</dict>
</plist>
EOF

mv "$PLIST_FILE.tmp" "$PLIST_FILE"

# Create logs directory if it doesn't exist
mkdir -p "$USER_HOME/Library/Logs"

# Check if service is already loaded
if launchctl list | grep -q "com.travelagent.server"; then
    echo "Service is already loaded. Unloading first..."
    launchctl unload "$USER_HOME/Library/LaunchAgents/com.travelagent.server.plist" 2>/dev/null || true
fi

# Copy plist to LaunchAgents
echo "Installing LaunchAgent..."
mkdir -p "$USER_HOME/Library/LaunchAgents"
cp "$PLIST_FILE" "$USER_HOME/Library/LaunchAgents/"

# Load the service
echo "Loading service..."
launchctl load "$USER_HOME/Library/LaunchAgents/com.travelagent.server.plist"

# Start the service
echo "Starting service..."
launchctl start com.travelagent.server

# Wait a moment for startup
sleep 2

# Check if it's running
if launchctl list | grep -q "com.travelagent.server"; then
    echo -e "${GREEN}✓ Service installed and started successfully!${NC}"
    echo ""
    echo "Useful commands:"
    echo "  Status:  launchctl list | grep travelagent"
    echo "  Stop:    launchctl stop com.travelagent.server"
    echo "  Start:   launchctl start com.travelagent.server"
    echo "  Logs:    tail -f ~/Library/Logs/travel-agent-stdout.log"
    echo ""
    echo "Test the server:"
    echo "  curl http://localhost:3001"
else
    echo -e "${RED}✗ Service may not have started correctly${NC}"
    echo "Check the logs:"
    echo "  tail ~/Library/Logs/travel-agent-stderr.log"
    exit 1
fi
