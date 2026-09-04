#!/usr/bin/env bash
# Give somebody else access to the server, or take it away again.
#
#   ./deploy/operator.sh root@YOUR_IP add    tarnas ~/keys/tarnas.pub
#   ./deploy/operator.sh root@YOUR_IP remove tarnas
#   ./deploy/operator.sh root@YOUR_IP list
#
# Idempotent: running `add` twice replaces the key rather than appending a
# second one, so rotating somebody's key is the same command.
#
# WHAT THIS ACTUALLY GRANTS
#
# A named account in the `docker` group. Be clear-eyed about what that is:
# anyone in the docker group can run `docker run -v /:/host` and read or write
# every file on the box, including the Postgres volume and deploy/.env. It is
# root, reachable in one extra step.
#
# So this is not a containment boundary and must not be sold as one. What it
# buys is accountability and revocability: their own key, their own name in
# the logs and in file ownership, and a single command that takes it away
# without rotating anybody else's key. Give it only to somebody you would
# have given root to.
#
# The database holds body weight, meals and training history for everyone
# using the app. An operator can read all of it.

set -euo pipefail

TARGET="${1:?usage: operator.sh user@host <add|remove|list> [name] [key.pub]}"
ACTION="${2:?usage: operator.sh user@host <add|remove|list> [name] [key.pub]}"
REMOTE_DIR=/opt/lockin

case "$ACTION" in
  list)
    ssh "$TARGET" 'bash -s' <<'REMOTE'
set -euo pipefail
echo "operators (members of the docker group):"
getent group docker | cut -d: -f4 | tr ',' '\n' | grep -v '^$' | sed 's/^/  /' || echo "  (none)"
echo
echo "keys that can log in as root:"
cut -d' ' -f3 /root/.ssh/authorized_keys 2>/dev/null | sed 's/^/  /' || echo "  (none)"
REMOTE
    ;;

  add)
    NAME="${3:?usage: operator.sh user@host add <name> <key.pub>}"
    KEYFILE="${4:?usage: operator.sh user@host add <name> <key.pub>}"
    [ -f "$KEYFILE" ] || { echo "no such key file: $KEYFILE" >&2; exit 1; }

    # Refuse a private key by mistake. Sending one to a server would be bad
    # enough; installing it as an authorized_key would also silently not work.
    if grep -q 'PRIVATE KEY' "$KEYFILE"; then
      echo "$KEYFILE is a PRIVATE key. Send the .pub one." >&2
      exit 1
    fi
    ssh-keygen -l -f "$KEYFILE" >/dev/null 2>&1 || {
      echo "$KEYFILE does not parse as a public key" >&2; exit 1
    }
    echo "==> key fingerprint: $(ssh-keygen -l -f "$KEYFILE")"

    KEY="$(cat "$KEYFILE")"
    ssh "$TARGET" "NAME='$NAME' KEY='$KEY' REMOTE_DIR='$REMOTE_DIR' bash -s" <<'REMOTE'
set -euo pipefail

if ! id -u "$NAME" >/dev/null 2>&1; then
  echo "==> creating $NAME"
  adduser --disabled-password --gecos '' "$NAME"
fi

# No password is ever set, so there is nothing to guess and nothing to leak.
# sshd has PasswordAuthentication off regardless; this is belt and braces.
passwd -l "$NAME" >/dev/null

echo "==> docker group"
usermod -aG docker "$NAME"

echo "==> installing key"
install -d -m 700 -o "$NAME" -g "$NAME" "/home/$NAME/.ssh"
# Written, not appended: `add` twice is a key rotation, not a second way in.
printf '%s\n' "$KEY" > "/home/$NAME/.ssh/authorized_keys"
chmod 600 "/home/$NAME/.ssh/authorized_keys"
chown "$NAME:$NAME" "/home/$NAME/.ssh/authorized_keys"

echo "==> giving the deploy directory to the docker group"
# deploy.sh rsyncs into this directory, so an operator has to be able to write
# it. setgid on the directories keeps files created later in the same group
# instead of quietly becoming unwritable by everyone else.
chgrp -R docker "$REMOTE_DIR"
chmod -R g+rwX "$REMOTE_DIR"
find "$REMOTE_DIR" -type d -exec chmod g+s {} +
# deploy/.env holds the Gemini key, the database password and the app's bearer
# token. Group-readable, because an operator needs it to deploy — and could
# read it through docker anyway.
chmod 640 "$REMOTE_DIR/deploy/.env" 2>/dev/null || true

echo "==> done: $NAME"
REMOTE
    echo
    echo "They deploy with:  ./deploy/deploy.sh $NAME@${TARGET#*@}"
    ;;

  remove)
    NAME="${3:?usage: operator.sh user@host remove <name>}"
    ssh "$TARGET" "NAME='$NAME' bash -s" <<'REMOTE'
set -euo pipefail
if ! id -u "$NAME" >/dev/null 2>&1; then
  echo "no such user: $NAME"
  exit 0
fi
echo "==> revoking key"
rm -f "/home/$NAME/.ssh/authorized_keys"
echo "==> out of the docker group"
deluser "$NAME" docker >/dev/null 2>&1 || true
echo "==> killing live sessions"
pkill -KILL -u "$NAME" 2>/dev/null || true
echo "==> done. The home directory is left in place; delete it with:"
echo "    deluser --remove-home $NAME"
REMOTE
    echo
    echo "Their key is gone, but they have had root-equivalent access."
    echo "Rotate anything they could have read: APP_BEARER_TOKEN, GEMINI_API_KEY,"
    echo "POSTGRES_PASSWORD. See docs/deploy.md."
    ;;

  *)
    echo "unknown action: $ACTION (add|remove|list)" >&2
    exit 1
    ;;
esac
