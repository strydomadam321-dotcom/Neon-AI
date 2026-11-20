#!/usr/bin/env bash
# NEON AI: one-command setup for Ubuntu Server (22.04 / 24.04, 64-bit).
#
#   sudo bash deploy/setup-ubuntu.sh            run it from inside the cloned repo
#   sudo bash deploy/setup-ubuntu.sh --dry-run  show what it would do, change nothing
#
# It installs Node.js + PostgreSQL, creates the database, installs the app in /opt/neon-ai,
# keeps it running (and starts it on boot), makes a nightly database backup, and lets the
# laptop run with the lid closed. Safe to run again: it updates the app and keeps your
# settings and data.
set -euo pipefail

APP_USER=neonai
APP_DIR=/opt/neon-ai
DB_NAME=neonai
DB_USER=neonai
PORT_NUM=3000
DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

# in a dry run, files are written under a temporary folder and system commands are only printed
ROOT=""
if [ "$DRY" = 1 ]; then ROOT="$(mktemp -d)"; fi
ENV_FILE="$ROOT/etc/neon-ai.env"
UNIT_DIR="$ROOT/etc/systemd/system"
BACKUP_BIN="$ROOT/usr/local/bin/neon-ai-backup"
BACKUP_DIR="$ROOT/var/backups/neon-ai"
LOGIND_DIR="$ROOT/etc/systemd/logind.conf.d"

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!! %s\033[0m\n' "$*"; }
run()  { if [ "$DRY" = 1 ]; then printf '   + %s\n' "$*"; else "$@"; fi; }
have_systemd() { [ -d /run/systemd/system ]; }

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[ -f "$SRC/server.js" ] || { echo "Run this from inside the Neon-AI repo (server.js not found in $SRC)."; exit 1; }
if [ "$DRY" = 0 ]; then
  [ "$(id -u)" -eq 0 ] || { echo "Please run with sudo:  sudo bash deploy/setup-ubuntu.sh"; exit 1; }
  command -v apt-get >/dev/null || { echo "This script is for Ubuntu/Debian (apt-get not found)."; exit 1; }
fi
[ "$DRY" = 1 ] && warn "DRY RUN: nothing will be installed or changed. Generated files go to $ROOT"

# ---------------------------------------------------------------- packages
say "Installing packages (curl, rsync, PostgreSQL)"
run apt-get update -y
run apt-get install -y curl ca-certificates gnupg rsync openssl postgresql postgresql-client

node_ok() { command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ]; }
install_node() {
  # NodeSource first (a newer Node that includes npm); if that doesn't support this Ubuntu release yet, use Ubuntu's own packages
  if curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs; then return 0; fi
  warn "NodeSource didn't work on this release; using Ubuntu's own Node packages instead"
  apt-get install -y nodejs npm
}

say "Checking Node.js (version 20 or newer is needed)"
if node_ok; then
  echo "   found Node $(node -v)"
elif [ "$DRY" = 1 ]; then
  echo "   + install Node.js 22 (NodeSource, falling back to Ubuntu's own packages)"
else
  install_node
  node_ok || { echo "Could not install Node.js 20 or newer. Run 'node -v' and send me the output."; exit 1; }
fi
NODE_BIN="$(command -v node || echo /usr/bin/node)"

if have_systemd; then run systemctl enable --now postgresql; else warn "systemd not running here: not starting PostgreSQL (fine for a dry run)"; fi

# ---------------------------------------------------------------- settings file + database
ask() {   # ask VAR "label" secret(0/1): uses the value from the environment if given, otherwise asks (Enter to skip)
  local var="$1" label="$2" secret="${3:-0}" v=""
  [ -n "${!var:-}" ] && return 0
  [ -t 0 ] || return 0
  if [ "$secret" = 1 ]; then read -rsp "$label: " v || true; echo; else read -rp "$label: " v || true; fi
  printf -v "$var" '%s' "$v"
}
quote() { local v="$1"; v="${v//\\/\\\\}"; v="${v//\"/\\\"}"; printf '"%s"' "$v"; }

NEW_ENV=0
if [ -f "$ENV_FILE" ]; then
  say "Keeping your existing settings in /etc/neon-ai.env (edit that file to change keys)"
else
  NEW_ENV=1
  say "First-time settings (press Enter to skip any you don't have yet)"
  ask ANTHROPIC_API_KEY "Anthropic API key (Claude)" 1
  ask GEMINI_API_KEY    "Gemini API key (Google AI Studio)" 1
  ask OWNER_USERNAMES   "Your own username(s) for full free access, comma separated (optional)" 0
  DB_PASS="$(openssl rand -hex 24)"

  say "Creating the database"
  if [ "$DRY" = 1 ]; then
    echo "   + create role $DB_USER and database $DB_NAME (owned by $DB_USER)"
  else
    if runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1; then
      runuser -u postgres -- psql -qc "ALTER ROLE $DB_USER WITH LOGIN PASSWORD '$DB_PASS'"
    else
      runuser -u postgres -- psql -qc "CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASS'"
    fi
    runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 || runuser -u postgres -- createdb -O "$DB_USER" "$DB_NAME"
  fi

  mkdir -p "$(dirname "$ENV_FILE")"
  ( umask 077
    {
      echo "# NEON AI settings. After editing, run:  sudo systemctl restart neon-ai"
      echo "NODE_ENV=production"
      echo "PORT=$PORT_NUM"
      echo "DATABASE_URL=$(quote "postgres://$DB_USER:$DB_PASS@127.0.0.1:5432/$DB_NAME")"
      echo "ANTHROPIC_API_KEY=$(quote "${ANTHROPIC_API_KEY:-}")"
      echo "GEMINI_API_KEY=$(quote "${GEMINI_API_KEY:-}")"
      echo "OWNER_USERNAMES=$(quote "${OWNER_USERNAMES:-}")"
    } > "$ENV_FILE" )
  if [ "$DRY" = 0 ]; then chown root:"$APP_USER" "$ENV_FILE" 2>/dev/null || true; chmod 640 "$ENV_FILE"; fi
fi

# ---------------------------------------------------------------- the app
say "Installing the app into /opt/neon-ai"
if [ "$DRY" = 1 ]; then
  echo "   + create user $APP_USER, copy the repo to $APP_DIR, run npm ci --omit=dev"
else
  id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
  mkdir -p "$APP_DIR"
  rsync -a --delete --exclude node_modules --exclude .git --exclude archive --exclude /.npm "$SRC"/ "$APP_DIR"/
  chown -R "$APP_USER":"$APP_USER" "$APP_DIR"
  # a login-less service user has no home folder of its own, so npm's cache is pointed at the app folder
  runuser -u "$APP_USER" -- env HOME="$APP_DIR" bash -c "cd '$APP_DIR' && npm ci --omit=dev --no-audit --no-fund"
fi
# the env file group must exist before it is readable by the service user
if [ "$DRY" = 0 ] && [ "$NEW_ENV" = 1 ]; then chown root:"$APP_USER" "$ENV_FILE"; chmod 640 "$ENV_FILE"; fi

# ---------------------------------------------------------------- services
say "Setting up the services (start on boot, restart if it crashes, nightly backup)"
mkdir -p "$UNIT_DIR" "$(dirname "$BACKUP_BIN")" "$BACKUP_DIR" "$LOGIND_DIR"
chmod 700 "$BACKUP_DIR"

cat > "$UNIT_DIR/neon-ai.service" <<EOF
[Unit]
Description=NEON AI
After=network-online.target postgresql.service
Wants=network-online.target postgresql.service

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=/etc/neon-ai.env
ExecStart=$NODE_BIN server.js
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true

[Install]
WantedBy=multi-user.target
EOF

cat > "$BACKUP_BIN" <<EOF
#!/usr/bin/env bash
# Nightly copy of the NEON AI database (keeps the 14 newest).
set -euo pipefail
dir=/var/backups/neon-ai
mkdir -p "\$dir"; chmod 700 "\$dir"
file="\$dir/$DB_NAME-\$(date +%F-%H%M).dump"
runuser -u postgres -- pg_dump -Fc $DB_NAME > "\$file"
chmod 600 "\$file"
ls -1t "\$dir"/$DB_NAME-*.dump | tail -n +15 | xargs -r rm -f
EOF
chmod 755 "$BACKUP_BIN"

cat > "$UNIT_DIR/neon-ai-backup.service" <<EOF
[Unit]
Description=Back up the NEON AI database

[Service]
Type=oneshot
ExecStart=/usr/local/bin/neon-ai-backup
EOF

cat > "$UNIT_DIR/neon-ai-backup.timer" <<EOF
[Unit]
Description=Nightly NEON AI database backup

[Timer]
OnCalendar=*-*-* 03:30:00
Persistent=true

[Install]
WantedBy=timers.target
EOF

# keep running with the lid closed (it's a laptop used as a server)
cat > "$LOGIND_DIR/neon-ai-lid.conf" <<EOF
[Login]
HandleLidSwitch=ignore
HandleLidSwitchExternalPower=ignore
HandleLidSwitchDocked=ignore
EOF

if have_systemd; then
  run systemctl daemon-reload
  run systemctl enable --now neon-ai.service
  run systemctl enable --now neon-ai-backup.timer
  run systemctl restart neon-ai.service                      # picks up a new version on re-runs
  run systemctl kill -s HUP systemd-logind.service || true   # reload the lid setting
else
  warn "systemd isn't running here, so the services were written but not started."
fi

# ---------------------------------------------------------------- check it works
if [ "$DRY" = 0 ] && have_systemd; then
  say "Waiting for the app to start"
  ok=0
  for _ in $(seq 1 20); do
    if curl -fsS "http://127.0.0.1:$PORT_NUM/api/config" >/dev/null 2>&1; then ok=1; break; fi
    sleep 1
  done
  if [ "$ok" = 1 ]; then
    IPS="$(hostname -I 2>/dev/null | xargs || true)"
    say "NEON AI is running!"
    for ip in $IPS; do echo "   open  http://$ip:$PORT_NUM  from a phone or computer on the same network"; done
  else
    warn "The app did not answer. Look at the log:  sudo journalctl -u neon-ai -n 50 --no-pager"
    exit 1
  fi
fi

cat <<EOF

Useful commands
  see the log          sudo journalctl -u neon-ai -f
  restart              sudo systemctl restart neon-ai
  change keys/settings sudo nano /etc/neon-ai.env     (then restart)
  update to new code   cd ~/Neon-AI && git pull && sudo bash deploy/setup-ubuntu.sh
  backups live in      /var/backups/neon-ai            (a new one every night, 14 kept)
EOF
[ "$DRY" = 1 ] && echo && echo "(dry run: generated files are in $ROOT)"
exit 0
