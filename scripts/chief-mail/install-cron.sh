#!/bin/sh
set -eu
# Only run after both Gmail and Jev have passed a live manual sync.
SELF_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ENTRY="*/15 * * * * /usr/bin/flock -n /home/rakazo-agent/.local/share/chief-mail/lock /usr/bin/python3 $SELF_DIR/chief_mail.py sync >>/home/rakazo-agent/.local/share/chief-mail/sync.log 2>&1"
mkdir -p /home/rakazo-agent/.local/share/chief-mail
umask 077
# Replace only the Chief-owned entry; retain unrelated user schedules.
{ crontab -l 2>/dev/null | grep -v '/chief-mail/chief_mail.py sync' || true; printf '%s\n' "$ENTRY"; } | crontab -
crontab -l | grep '/chief-mail/chief_mail.py sync'
