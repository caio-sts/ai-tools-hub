#!/usr/bin/env bash
# Installs the local-first harvest schedule (spec §6.1): a systemd *user* timer inside WSL,
# plus a Windows Task Scheduler task at logon whose only job is to start WSL so systemd can
# take over. Idempotent — safe to re-run after moving the checkout or editing a unit.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
ENV_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/ai-tools-hub"
DISTRO="${WSL_DISTRO_NAME:-Ubuntu-26.04}"
TASK_NAME="ai-tools-hub-wsl-boot"

# Stamped into the unit's PATH — see the comment beside it in the .service. Resolved here rather
# than hard-coded because a version manager's path carries the version in it and moves on the next
# upgrade. Installing nothing beats installing a timer that fails 127 in silence every four hours.
if ! command -v node > /dev/null 2>&1 || ! command -v npm > /dev/null 2>&1; then
  echo "node and npm must be on PATH to install the schedule — load your version manager and re-run" >&2
  exit 1
fi
NODE_BIN="$(cd "$(dirname "$(command -v node)")" && pwd)"
NPM_BIN="$(cd "$(dirname "$(command -v npm)")" && pwd)"
[ "$NPM_BIN" = "$NODE_BIN" ] || NODE_BIN="$NODE_BIN:$NPM_BIN"

mkdir -p "$UNIT_DIR" "$ENV_DIR"

if [ ! -f "$ENV_DIR/harvest.env" ]; then
  printf 'CATALOG_PAT=\n' > "$ENV_DIR/harvest.env"
  chmod 600 "$ENV_DIR/harvest.env"
  echo "created $ENV_DIR/harvest.env — put the fine-grained PAT in it before the next run"
fi

sed -e "s|@REPO_DIR@|$REPO_DIR|g" -e "s|@NODE_BIN@|$NODE_BIN|g" \
  "$REPO_DIR/ops/ai-tools-hub-harvest.service" > "$UNIT_DIR/ai-tools-hub-harvest.service"
echo "the unit will run node from $NODE_BIN"
cp "$REPO_DIR/ops/ai-tools-hub-harvest.timer" "$UNIT_DIR/ai-tools-hub-harvest.timer"

# Without lingering the user manager dies with the last session, and the timer with it.
loginctl enable-linger "$(id -un)" || echo "enable-linger failed — the timer will only run while a session is open"

systemctl --user daemon-reload
systemctl --user enable --now ai-tools-hub-harvest.timer

if command -v powershell.exe > /dev/null 2>&1; then
  powershell.exe -NoProfile -Command "if (Get-ScheduledTask -TaskName '$TASK_NAME' -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName '$TASK_NAME' -Confirm:\$false }; \$action = New-ScheduledTaskAction -Execute 'wsl.exe' -Argument '-d $DISTRO -- true'; \$trigger = New-ScheduledTaskTrigger -AtLogOn; Register-ScheduledTask -TaskName '$TASK_NAME' -Action \$action -Trigger \$trigger -Description 'Starts WSL at logon so the ai-tools-hub systemd timer can run.' | Out-Null" > /dev/null
  echo "registered the Windows logon task $TASK_NAME"
else
  echo "powershell.exe not on PATH — skipped the Windows logon task, the systemd timer is still installed"
fi

systemctl --user list-timers ai-tools-hub-harvest.timer --no-pager
