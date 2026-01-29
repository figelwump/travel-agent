#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}Dependency Status Check${NC}"
echo ""

MISSING=0

# Check Homebrew
echo -n "Homebrew: "
if command -v brew &> /dev/null; then
    echo -e "${GREEN}✓ Installed ($(brew --version | head -1))${NC}"
else
    echo -e "${RED}✗ Not installed${NC}"
    echo "  Install: /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
    MISSING=1
fi

# Check Bun
echo -n "Bun: "
if command -v bun &> /dev/null; then
    echo -e "${GREEN}✓ Installed ($(bun --version))${NC}"
elif [ -f "$HOME/.bun/bin/bun" ]; then
    echo -e "${YELLOW}⚠ Installed but not in PATH${NC}"
    echo "  Location: $HOME/.bun/bin/bun"
    echo "  Add to ~/.zshrc: export PATH=\"\$HOME/.bun/bin:\$PATH\""
else
    echo -e "${RED}✗ Not installed${NC}"
    echo "  Install: curl -fsSL https://bun.sh/install | bash"
    MISSING=1
fi

# Check Tailscale
echo -n "Tailscale: "
if command -v tailscale &> /dev/null; then
    echo -e "${GREEN}✓ Installed${NC}"
    if tailscale status &> /dev/null; then
        TSIP=$(tailscale ip -4 2>/dev/null || echo "N/A")
        echo "  Status: Connected"
        echo "  IP: $TSIP"
    else
        echo -e "  Status: ${YELLOW}Not connected${NC}"
        echo "  Run: sudo tailscale up"
    fi
else
    echo -e "${RED}✗ Not installed${NC}"
    echo "  Install: brew install tailscale"
    MISSING=1
fi

# Check project dependencies
echo -n "Project dependencies: "
if [ -d "node_modules" ] && [ -f "bun.lock" ]; then
    echo -e "${GREEN}✓ Installed${NC}"
else
    echo -e "${RED}✗ Not installed${NC}"
    echo "  Install: bun install"
    MISSING=1
fi

# Check .env configuration
echo -n "Configuration (.env): "
if [ -f ".env" ]; then
    if grep -q "^AUTH_PASSWORD=..*" ".env"; then
        echo -e "${GREEN}✓ AUTH_PASSWORD set${NC}"
    else
        echo -e "${YELLOW}⚠ AUTH_PASSWORD not set${NC}"
        echo "  Edit .env and set: AUTH_PASSWORD=your-secure-password"
    fi
else
    echo -e "${RED}✗ .env file not found${NC}"
    echo "  Copy .env.example to .env and configure"
    MISSING=1
fi

echo ""
if [ $MISSING -eq 0 ]; then
    echo -e "${GREEN}All dependencies are installed!${NC}"
    echo ""
    echo "Next steps:"
    echo "  1. Make sure AUTH_PASSWORD is set in .env"
    echo "  2. Run: ./scripts/install-service.sh"
else
    echo -e "${YELLOW}Some dependencies are missing.${NC}"
    echo ""
    echo "See INSTALL.md for detailed installation instructions."
fi
