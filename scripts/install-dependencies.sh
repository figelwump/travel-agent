#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}================================${NC}"
echo -e "${BLUE}Travel Agent Dependency Installer${NC}"
echo -e "${BLUE}================================${NC}"
echo ""

# Function to check if command exists
command_exists() {
    command -v "$1" &> /dev/null
}

# Step 1: Install Homebrew if not present
echo -e "${YELLOW}[1/4] Checking Homebrew...${NC}"
if command_exists brew; then
    echo -e "${GREEN}✓ Homebrew already installed${NC}"
else
    echo "Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

    # Add Homebrew to PATH for this session
    if [[ $(uname -m) == 'arm64' ]]; then
        echo "Adding Homebrew to PATH (Apple Silicon)..."
        eval "$(/opt/homebrew/bin/brew shellenv)"
    else
        echo "Adding Homebrew to PATH (Intel)..."
        eval "$(/usr/local/bin/brew shellenv)"
    fi

    echo -e "${GREEN}✓ Homebrew installed${NC}"
fi
echo ""

# Step 2: Install Bun
echo -e "${YELLOW}[2/4] Checking Bun...${NC}"
if command_exists bun; then
    echo -e "${GREEN}✓ Bun already installed ($(bun --version))${NC}"
else
    echo "Installing Bun..."
    curl -fsSL https://bun.sh/install | bash

    # Add Bun to PATH for this session
    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"

    echo -e "${GREEN}✓ Bun installed${NC}"
    echo -e "${YELLOW}Note: You may need to restart your terminal or run: source ~/.bashrc (or ~/.zshrc)${NC}"
fi
echo ""

# Step 3: Install Tailscale
echo -e "${YELLOW}[3/4] Checking Tailscale...${NC}"
if command_exists tailscale; then
    echo -e "${GREEN}✓ Tailscale already installed${NC}"
else
    echo "Installing Tailscale..."
    brew install tailscale
    echo -e "${GREEN}✓ Tailscale installed${NC}"
    echo -e "${YELLOW}Note: You'll need to run 'sudo tailscale up' to start Tailscale${NC}"
fi
echo ""

# Step 4: Install project dependencies
echo -e "${YELLOW}[4/4] Installing project dependencies...${NC}"
cd "$(dirname "$0")/.."

# Check if bun is now available
if command_exists bun; then
    bun install
    echo -e "${GREEN}✓ Project dependencies installed${NC}"
else
    # Try with explicit path
    if [ -f "$HOME/.bun/bin/bun" ]; then
        "$HOME/.bun/bin/bun" install
        echo -e "${GREEN}✓ Project dependencies installed${NC}"
    else
        echo -e "${RED}✗ Bun installation not found in PATH${NC}"
        echo "Please restart your terminal and run: bun install"
        exit 1
    fi
fi
echo ""

# Summary
echo -e "${BLUE}================================${NC}"
echo -e "${GREEN}Installation Complete!${NC}"
echo -e "${BLUE}================================${NC}"
echo ""
echo "Next steps:"
echo ""
echo "1. Configure authentication:"
echo "   Edit .env and set: AUTH_PASSWORD=your-secure-password"
echo ""
echo "2. Start Tailscale (if not already running):"
echo "   sudo tailscale up"
echo ""
echo "3. Install the service:"
echo "   ./scripts/install-service.sh"
echo ""
echo "4. Get your Tailscale IP:"
echo "   tailscale ip -4"
echo ""
echo "See QUICKSTART.md for full setup instructions."
echo ""

# Check if PATH needs updating
if ! command_exists bun && [ -f "$HOME/.bun/bin/bun" ]; then
    echo -e "${YELLOW}⚠ Important: Bun is installed but not in your PATH${NC}"
    echo ""
    echo "Add to your shell profile (~/.zshrc or ~/.bashrc):"
    echo '  export BUN_INSTALL="$HOME/.bun"'
    echo '  export PATH="$BUN_INSTALL/bin:$PATH"'
    echo ""
    echo "Then run: source ~/.zshrc (or ~/.bashrc)"
    echo ""
fi
