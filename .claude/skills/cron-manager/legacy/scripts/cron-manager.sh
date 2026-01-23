#!/bin/sh
# cron-manager.sh - Manage cron jobs on persistent storage
#
# Usage:
#   cron-manager.sh create <name> <schedule> <command>
#   cron-manager.sh list
#   cron-manager.sh show <name>
#   cron-manager.sh delete <name>
#   cron-manager.sh reload

set -e

# Configuration - matches entrypoint.sh
PERSIST_CRON_DIR=${CRON_DIR:-/var/data/cron.d}
PERSIST_SCRIPTS_DIR="$PERSIST_CRON_DIR/scripts"
SYSTEM_CRON_DIR=/etc/cron.d

# Check if we can access the persistent directory
if [ ! -d "/var/data" ] && [ -z "$CRON_DIR" ]; then
    echo "Error: /var/data does not exist." >&2
    echo "This script is designed to run inside the Render container." >&2
    echo "SSH into your Render service first, or set CRON_DIR to override." >&2
    exit 1
fi

# Ensure directories exist
mkdir -p "$PERSIST_CRON_DIR" "$PERSIST_SCRIPTS_DIR"

usage() {
    cat <<EOF
Usage: cron-manager.sh <command> [arguments]

Commands:
  create <name> <schedule> <command>  Create a new cron job
  list                                List all cron jobs
  show <name>                         Show details of a cron job
  delete <name>                       Delete a cron job
  reload                              Reload cron daemon

Examples:
  cron-manager.sh create daily-backup "0 2 * * *" "/var/data/cron.d/scripts/backup.sh"
  cron-manager.sh create hourly-check "0 * * * *" "curl -s https://example.com/health"
  cron-manager.sh list
  cron-manager.sh delete daily-backup

Scripts directory: /var/data/cron.d/scripts/
EOF
    exit 1
}

# Validate cron job name (alphanumeric, dash, underscore only)
validate_name() {
    name="$1"
    if ! echo "$name" | grep -qE '^[a-zA-Z0-9_-]+$'; then
        echo "Error: Job name must contain only letters, numbers, dashes, and underscores" >&2
        exit 1
    fi
}

# Create a new cron job
create_job() {
    name="$1"
    schedule="$2"
    command="$3"

    if [ -z "$name" ] || [ -z "$schedule" ] || [ -z "$command" ]; then
        echo "Error: create requires <name> <schedule> <command>" >&2
        usage
    fi

    validate_name "$name"

    job_file="$PERSIST_CRON_DIR/$name"

    # Check if job already exists
    if [ -f "$job_file" ]; then
        echo "Warning: Job '$name' already exists. Overwriting..." >&2
    fi

    # Create the cron job file
    # Format: schedule user command
    # Using root user, redirecting output to syslog
    cat > "$job_file" <<EOF
# Cron job: $name
# Created: $(date -Iseconds 2>/dev/null || date)
$schedule root $command >> /var/log/cron.log 2>&1
EOF

    # Set proper permissions
    chmod 0644 "$job_file"

    # Copy to system cron.d
    if [ -d "$SYSTEM_CRON_DIR" ]; then
        cp "$job_file" "$SYSTEM_CRON_DIR/$name"
        chmod 0644 "$SYSTEM_CRON_DIR/$name"
    fi

    echo "Created cron job: $name"
    echo "Schedule: $schedule"
    echo "Command: $command"
    echo ""
    echo "Run 'cron-manager.sh reload' to apply changes."
}

# List all cron jobs
list_jobs() {
    echo "Cron jobs in $PERSIST_CRON_DIR:"
    echo ""

    found=0
    for f in "$PERSIST_CRON_DIR"/*; do
        [ -f "$f" ] || continue
        name=$(basename "$f")
        # Skip hidden files
        case "$name" in
            .*) continue ;;
        esac

        found=1
        # Extract schedule and command from file
        line=$(grep -v '^#' "$f" | grep -v '^$' | head -1)
        if [ -n "$line" ]; then
            # Parse: schedule (5 fields) user command
            schedule=$(echo "$line" | awk '{print $1, $2, $3, $4, $5}')
            command=$(echo "$line" | awk '{for(i=7;i<=NF;i++) printf "%s ", $i; print ""}' | sed 's/ *$//')
            echo "  $name"
            echo "    Schedule: $schedule"
            echo "    Command: $command"
            echo ""
        else
            echo "  $name (empty or invalid)"
        fi
    done

    if [ $found -eq 0 ]; then
        echo "  (no cron jobs found)"
    fi
}

# Show details of a specific cron job
show_job() {
    name="$1"

    if [ -z "$name" ]; then
        echo "Error: show requires <name>" >&2
        usage
    fi

    validate_name "$name"

    job_file="$PERSIST_CRON_DIR/$name"

    if [ ! -f "$job_file" ]; then
        echo "Error: Job '$name' not found" >&2
        exit 1
    fi

    echo "Cron job: $name"
    echo "File: $job_file"
    echo ""
    echo "Contents:"
    cat "$job_file"
}

# Delete a cron job
delete_job() {
    name="$1"

    if [ -z "$name" ]; then
        echo "Error: delete requires <name>" >&2
        usage
    fi

    validate_name "$name"

    job_file="$PERSIST_CRON_DIR/$name"
    system_file="$SYSTEM_CRON_DIR/$name"

    if [ ! -f "$job_file" ]; then
        echo "Error: Job '$name' not found" >&2
        exit 1
    fi

    # Remove from persistent storage
    rm -f "$job_file"

    # Remove from system cron.d
    if [ -f "$system_file" ]; then
        rm -f "$system_file"
    fi

    echo "Deleted cron job: $name"
    echo ""
    echo "Run 'cron-manager.sh reload' to apply changes."
}

# Reload cron daemon
reload_cron() {
    echo "Reloading cron daemon..."

    # Try different methods to reload cron
    if command -v service >/dev/null 2>&1; then
        service cron reload 2>/dev/null || service cron restart 2>/dev/null || true
    fi

    if command -v systemctl >/dev/null 2>&1; then
        systemctl reload cron 2>/dev/null || systemctl restart cron 2>/dev/null || true
    fi

    # For Alpine/BusyBox, send HUP signal to crond
    if command -v crond >/dev/null 2>&1; then
        pkill -HUP crond 2>/dev/null || true
    fi

    # Also try sending HUP to cron
    if command -v cron >/dev/null 2>&1; then
        pkill -HUP cron 2>/dev/null || true
    fi

    echo "Cron daemon reloaded."
}

# Main command dispatcher
case "${1:-}" in
    create)
        shift
        create_job "$@"
        ;;
    list)
        list_jobs
        ;;
    show)
        shift
        show_job "$@"
        ;;
    delete)
        shift
        delete_job "$@"
        ;;
    reload)
        reload_cron
        ;;
    -h|--help|help)
        usage
        ;;
    *)
        usage
        ;;
esac
