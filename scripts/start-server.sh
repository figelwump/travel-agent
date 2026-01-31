#!/bin/bash
# Wrapper script for launchd to load .env before starting the server

# Set PATH explicitly for launchd environment
export PATH="/Users/agents/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

cd "$(dirname "$0")/.."

# Load .env file if it exists
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

exec /Users/agents/.bun/bin/bun run start
