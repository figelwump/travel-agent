#!/bin/sh
set -e

# Ensure SSH host keys exist for sshd; generates only if missing.
if command -v ssh-keygen >/dev/null 2>&1; then
  ssh-keygen -A >/dev/null 2>&1 || true
fi

# Make sure sshd has a runtime dir. (Render's ssh proxy will drop the
# session immediately if sshd can't start.)
mkdir -p /run/sshd

# Unlock root if it is still marked as locked in /etc/shadow (some base
# images ship root as '!' which blocks SSH even with key auth).
if command -v passwd >/dev/null 2>&1; then
  if passwd -S root 2>/dev/null | grep -q " L "; then
    passwd -u root >/dev/null 2>&1 || true
  fi
fi

# Ensure Claude skills are stored on a persistent disk (if attached).
PERSIST_SKILLS_DIR=${SKILLS_DIR:-/var/data/skills}
REPO_SKILLS_DIR=/app/.claude/skills
mkdir -p "$PERSIST_SKILLS_DIR"
mkdir -p /app/.claude

# Seed the persistent dir with bundled skills (without overwriting user files)
if [ -d "$REPO_SKILLS_DIR" ] && [ ! -L "$REPO_SKILLS_DIR" ]; then
  if ls "$REPO_SKILLS_DIR"/* >/dev/null 2>&1; then
    cp -a -n "$REPO_SKILLS_DIR"/. "$PERSIST_SKILLS_DIR"/
  fi
fi

# Replace /app/.claude/skills with a symlink pointing at the persistent dir
if [ ! -L /app/.claude/skills ]; then
  rm -rf /app/.claude/skills 2>/dev/null || true
  ln -s "$PERSIST_SKILLS_DIR" /app/.claude/skills
fi

# Start sshd so Render can open SSH sessions. Fail the container if sshd
# cannot start, and keep a log for debugging.
if command -v sshd >/dev/null 2>&1; then
  /usr/sbin/sshd -E /var/log/sshd.log || {
    echo "sshd failed to start; tail follows" >&2
    tail -n 50 /var/log/sshd.log >&2 || true
    exit 1
  }
  # Emit quick diagnostics so we can see SSH readiness in service logs.
  echo "[entrypoint] sshd started, root passwd entry: $(getent passwd root | cut -d: -f1,2,7)"
  ls -ld /run/sshd /root /root/.ssh 2>/dev/null || true
  if [ -f /var/log/sshd.log ]; then
    echo "[entrypoint] recent sshd.log:" && tail -n 40 /var/log/sshd.log || true
  fi
  # Emit a delayed snapshot so we can capture sshd state in Render logs.
  {
    sleep 5
    echo "[entrypoint] delayed sshd.log tail:" && tail -n 50 /var/log/sshd.log || true
    ps -ef | grep [s]shd || true
  } &
  # Stream sshd logs to stdout so connection attempts show up in service logs.
  tail -F /var/log/sshd.log &
else
  echo "sshd not found in image" >&2
fi

# Persist and merge cron jobs (repo-managed + user-created)
PERSIST_CRON_DIR=${CRON_DIR:-/var/data/cron.d}
PERSIST_CRONTAB_DIR=${CRONTAB_DIR:-/var/data/crontabs}
mkdir -p "$PERSIST_CRON_DIR" "$PERSIST_CRONTAB_DIR"

# Seed persistent cron.d with bundled jobs without overwriting user edits
if [ -d /app/cron.d ]; then
  if ls /app/cron.d/* >/dev/null 2>&1; then
    cp -a -n /app/cron.d/. "$PERSIST_CRON_DIR"/
  fi
fi

# Sync persistent cron.d into /etc/cron.d (overwrites with latest persisted copies)
if ls "$PERSIST_CRON_DIR"/* >/dev/null 2>&1; then
  for f in "$PERSIST_CRON_DIR"/*; do
    [ -f "$f" ] || continue
    dest="/etc/cron.d/$(basename "$f")"
    cp "$f" "$dest"
    chmod 0644 "$dest"
  done
fi

# Persist root crontab: symlink /var/spool/cron/crontabs/root to disk
mkdir -p /var/spool/cron/crontabs
if [ ! -f "$PERSIST_CRONTAB_DIR/root" ] && [ -f /var/spool/cron/crontabs/root ]; then
  cp /var/spool/cron/crontabs/root "$PERSIST_CRONTAB_DIR/root"
fi
touch "$PERSIST_CRONTAB_DIR/root"
chmod 600 "$PERSIST_CRONTAB_DIR/root"
if command -v getent >/dev/null 2>&1 && getent group crontab >/dev/null 2>&1; then
  chown root:crontab "$PERSIST_CRONTAB_DIR/root"
else
  chown root:root "$PERSIST_CRONTAB_DIR/root"
fi
if [ ! -L /var/spool/cron/crontabs/root ]; then
  rm -f /var/spool/cron/crontabs/root
  ln -s "$PERSIST_CRONTAB_DIR/root" /var/spool/cron/crontabs/root
fi

# Start cron in the background so scheduled jobs can run.
if command -v cron >/dev/null 2>&1; then
  cron &
elif command -v crond >/dev/null 2>&1; then
  crond &
else
  echo "cron daemon not found in image" >&2
fi

# Hand off to the main container command.
exec "$@"
