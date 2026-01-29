# Quick Start Guide: Running Travel Agent 24/7 with Tailscale

## TL;DR Setup

### 0. Install Dependencies (First Time Only)

```bash
./scripts/install-dependencies.sh
```

This installs:
- Homebrew (if needed)
- Bun (JavaScript runtime)
- Tailscale (secure networking)
- Project dependencies

After installation, restart your terminal or run:
```bash
source ~/.zshrc  # or ~/.bashrc if using bash
```

### 1. Set Authentication Password

Edit `.env`:
```bash
AUTH_PASSWORD=your-secure-password-here
```

### 2. Install as Always-On Service

```bash
./scripts/install-service.sh
```

This will:
- Configure the service to start on boot
- Keep it running (auto-restart on crash)
- Save logs to `~/Library/Logs/travel-agent-*.log`

### 3. Install Tailscale

On Mac Mini:
```bash
brew install tailscale
sudo tailscale up
```

On your phone:
- Install Tailscale from App Store (iOS) or Google Play (Android)
- Sign in with the same account

### 4. Get Your Mac Mini's Tailscale IP

```bash
tailscale ip -4
```

### 5. Access from Your Phone

1. Open Tailscale app on phone (ensure connected)
2. Open browser and navigate to: `http://[mac-mini-ip]:3001`
3. Enter your AUTH_PASSWORD when prompted

## Testing

```bash
# Check service status
launchctl list | grep travelagent

# View logs
tail -f ~/Library/Logs/travel-agent-stdout.log

# Test locally
curl http://localhost:3001

# Test from phone (after Tailscale setup)
# Open browser: http://[your-mac-mini-tailscale-ip]:3001
```

## Useful Commands

```bash
# Stop service
launchctl stop com.travelagent.server

# Start service
launchctl start com.travelagent.server

# Uninstall service
./scripts/uninstall-service.sh

# Reinstall after code changes
./scripts/install-service.sh
```

## Full Documentation

See [DEPLOYMENT.md](DEPLOYMENT.md) for detailed setup instructions, troubleshooting, and security notes.

## Security Checklist

- [x] Set `AUTH_PASSWORD` in `.env`
- [x] Remove or comment out `DISABLE_AUTH=true`
- [x] Use Tailscale (encrypted tunnel)
- [ ] Consider setting `ALLOWED_ORIGINS` for additional security
- [ ] Enable Tailscale 2FA
- [ ] Keep dependencies updated: `bun update`

## Need Help?

Common issues and solutions are in [DEPLOYMENT.md](DEPLOYMENT.md#troubleshooting).
