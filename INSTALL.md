# Installation Guide

Run these commands in your terminal (you'll be prompted for your password for sudo operations).

## Step 1: Install Homebrew (if not installed)

Check if Homebrew is installed:
```bash
brew --version
```

If not installed, run:
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

After installation, follow the instructions to add Homebrew to your PATH.

For Apple Silicon Macs, add to `~/.zshrc`:
```bash
eval "$(/opt/homebrew/bin/brew shellenv)"
```

For Intel Macs, add to `~/.zshrc`:
```bash
eval "$(/usr/local/bin/brew shellenv)"
```

Then reload your shell:
```bash
source ~/.zshrc
```

## Step 2: Install Bun

```bash
curl -fsSL https://bun.sh/install | bash
```

Add Bun to your PATH by adding this to `~/.zshrc`:
```bash
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"
```

Then reload:
```bash
source ~/.zshrc
```

Verify installation:
```bash
bun --version
```

## Step 3: Install Tailscale

```bash
brew install tailscale
```

Start Tailscale:
```bash
sudo tailscale up
```

This will open a browser window to authenticate. Follow the prompts.

Get your Tailscale IP:
```bash
tailscale ip -4
```

## Step 4: Install Project Dependencies

Navigate to the project directory:
```bash
cd /Users/agents/GiantThings/repos/travel-agent
```

Install dependencies:
```bash
bun install
```

## Step 5: Configure Authentication

Edit `.env` and set a secure password:
```bash
# Use your preferred editor
nano .env
# or
vim .env
# or
code .env
```

Set:
```bash
AUTH_PASSWORD=your-secure-password-here
```

Make sure to remove or comment out `DISABLE_AUTH=true` if present.

## Step 6: Install the Service

```bash
./scripts/install-service.sh
```

## Step 7: Verify Everything Works

Check service status:
```bash
launchctl list | grep travelagent
```

View logs:
```bash
tail -f ~/Library/Logs/travel-agent-stdout.log
```

Test locally:
```bash
curl http://localhost:3001
```

Get your Tailscale IP:
```bash
tailscale ip -4
```

## Step 8: Access from Your Phone

1. Install Tailscale app on your phone (App Store or Google Play)
2. Sign in with the same Tailscale account
3. Open browser on phone and go to: `http://[your-mac-mini-tailscale-ip]:3001`
4. Enter your `AUTH_PASSWORD`

## Troubleshooting

### Command not found errors

Make sure you've added the tools to your PATH and reloaded your shell:
```bash
source ~/.zshrc
```

### Service won't start

Check logs:
```bash
tail -50 ~/Library/Logs/travel-agent-stderr.log
```

### Can't access from phone

1. Verify Tailscale is running on both devices:
   ```bash
   tailscale status
   ```

2. Check Mac firewall settings:
   - System Settings → Network → Firewall
   - Allow incoming connections for "bun"

3. Test from Mac first:
   ```bash
   curl http://localhost:3001
   ```

## Quick Reference

```bash
# Service management
launchctl list | grep travelagent          # Check status
launchctl stop com.travelagent.server      # Stop
launchctl start com.travelagent.server     # Start
./scripts/uninstall-service.sh             # Uninstall

# Logs
tail -f ~/Library/Logs/travel-agent-stdout.log
tail -f ~/Library/Logs/travel-agent-stderr.log

# Tailscale
tailscale status                           # Connection status
tailscale ip -4                            # Your Tailscale IP
sudo tailscale down                        # Disconnect
sudo tailscale up                          # Reconnect

# Updates
cd /Users/agents/GiantThings/repos/travel-agent
git pull                                   # Get latest code
bun install                                # Update dependencies
launchctl stop com.travelagent.server      # Restart service
launchctl start com.travelagent.server
```
