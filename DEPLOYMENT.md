# Travel Agent Deployment Guide

Guide for running the travel-agent continuously on macOS and accessing it remotely via Tailscale.

## Prerequisites

- Bun installed (check with `bun --version`)
- Tailscale account (free at https://tailscale.com)

## Part 1: Set Up Always-On Service (macOS LaunchAgent)

### 1. Configure Authentication

First, set a strong password for the travel agent. Edit `.env`:

```bash
AUTH_PASSWORD=your-secure-password-here
```

**Important:** Do NOT use `DISABLE_AUTH=true` in production. The AUTH_PASSWORD protects your travel data.

### 2. Verify Bun Path

Check where Bun is installed:

```bash
which bun
```

If the path is different from `/opt/homebrew/bin/bun`, edit `com.travelagent.server.plist` and update the path in the `ProgramArguments` section.

### 3. Install the LaunchAgent

```bash
# Copy the plist to LaunchAgents directory
cp com.travelagent.server.plist ~/Library/LaunchAgents/

# Load the service
launchctl load ~/Library/LaunchAgents/com.travelagent.server.plist

# Start the service
launchctl start com.travelagent.server
```

### 4. Verify It's Running

```bash
# Check if the service is loaded
launchctl list | grep travelagent

# Check the logs
tail -f ~/Library/Logs/travel-agent-stdout.log
tail -f ~/Library/Logs/travel-agent-stderr.log

# Test the server
curl http://localhost:3001
```

### 5. Useful Commands

```bash
# Stop the service
launchctl stop com.travelagent.server

# Unload the service (stops and removes from auto-start)
launchctl unload ~/Library/LaunchAgents/com.travelagent.server.plist

# Reload after making changes to the plist
launchctl unload ~/Library/LaunchAgents/com.travelagent.server.plist
cp com.travelagent.server.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.travelagent.server.plist

# View logs
tail -f ~/Library/Logs/travel-agent-stdout.log
tail -f ~/Library/Logs/travel-agent-stderr.log
```

## Part 2: Set Up Tailscale for Remote Access

### 1. Install Tailscale on Mac Mini

```bash
# Install via Homebrew
brew install tailscale

# Or download from https://tailscale.com/download/mac
```

Start Tailscale and authenticate:

```bash
sudo tailscale up
```

This will open a browser window to log in. Follow the prompts.

### 2. Get Your Tailscale IP

```bash
tailscale ip -4
```

Note this IP address (e.g., `100.x.x.x`). This is your Mac Mini's Tailscale IP.

### 3. Configure CORS for Tailscale

The travel-agent needs to allow connections from Tailscale IPs. You have two options:

**Option A: Allow all origins (simple but less secure)**

In `.env`, leave `ALLOWED_ORIGINS` commented out or empty.

**Option B: Restrict to Tailscale network (recommended)**

In `.env`:

```bash
ALLOWED_ORIGINS=http://100.64.0.0,https://100.64.0.0
```

Note: Tailscale uses the `100.64.0.0/10` CIDR range. You may need to adjust this based on your Tailscale network configuration.

**Option C: Specific device IP (most secure)**

After setting up Tailscale on your phone (next step), get your phone's Tailscale IP and add it:

```bash
ALLOWED_ORIGINS=http://100.x.x.x:3001
```

### 4. Restart the Service

After changing `.env`:

```bash
launchctl stop com.travelagent.server
launchctl start com.travelagent.server
```

### 5. Install Tailscale on Your Phone

- **iOS:** Install from the App Store
- **Android:** Install from Google Play Store

Open Tailscale and log in with the same account.

### 6. Access Travel Agent from Your Phone

1. Open Tailscale on your phone and ensure it's connected
2. Get your Mac Mini's Tailscale IP from the Tailscale app or by running `tailscale status` on the Mac Mini
3. Open your phone's browser and navigate to:
   ```
   http://[your-mac-mini-tailscale-ip]:3001
   ```
   For example: `http://100.101.102.103:3001`

4. When prompted, enter the `AUTH_PASSWORD` you set in `.env`

## Troubleshooting

### Service won't start

Check logs:
```bash
tail -50 ~/Library/Logs/travel-agent-stderr.log
```

Common issues:
- Wrong Bun path: Verify with `which bun` and update the plist
- Port already in use: Check with `lsof -i :3001` and kill the process
- Missing dependencies: Run `bun install` in the project directory

### Can't access from phone

1. Verify Tailscale is running on both devices:
   ```bash
   tailscale status
   ```

2. Check the Mac Mini firewall isn't blocking port 3001:
   - System Settings → Network → Firewall → Options
   - Allow incoming connections for "bun"

3. Test locally first:
   ```bash
   curl http://localhost:3001
   ```

4. Test from another device on Tailscale:
   ```bash
   curl http://[mac-mini-tailscale-ip]:3001
   ```

5. Check CORS configuration in `.env` and restart the service

### Authentication fails

- Verify `AUTH_PASSWORD` is set in `.env`
- Check that the password doesn't contain special characters that need escaping
- Try resetting the password in `.env` and restarting the service

## Security Notes

1. **Always use AUTH_PASSWORD** when exposing the service beyond localhost
2. **Keep your Tailscale account secure** with a strong password and 2FA
3. **Regularly update** the travel-agent and dependencies: `bun update`
4. **Monitor logs** for unusual activity: `tail -f ~/Library/Logs/travel-agent-*.log`
5. **Consider using Tailscale ACLs** for additional network-level security

## Updating the Travel Agent

To update the travel agent code:

```bash
# Navigate to the project directory
cd /Users/agents/GiantThings/repos/travel-agent

# Pull latest changes (if using git)
git pull

# Install any new dependencies
bun install

# Restart the service
launchctl stop com.travelagent.server
launchctl start com.travelagent.server
```
