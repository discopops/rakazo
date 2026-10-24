# Chief Oracle health verification

Run from the Mac:

```sh
python3 ~/GitHub/rakazo/scripts/chief-mail/verify_oracle_health.py
```

This is **read-only**: it does not contact Gmail, modify Oracle, install cron, or restart the scanner. It uses the existing private `~/GitHub/rakazo/.env` SSH_SANDBOX_* settings, verifies the server's existing host key, and never prints the SSH identity or credentials.

Results: `HEALTHY` (exit 0), `DEGRADED` (exit 1), `BLOCKED` (exit 2). BLOCKED means the check cannot establish scanner health; do not interpret it as a scanner failure. DEGRADED means cron is absent, scan age exceeds 35 minutes, recent classification failures exist, or log/database inspection identifies errors. An idle process between cron ticks is normal.

The macOS Remote Desktop Commander LaunchAgent `com.ben.desktop-commander-remote` starts at login and restarts after unexpected exit. Verify it with `launchctl list | grep com.ben.desktop-commander-remote`. This is separate from the Atlas tunnel/watchdog. If remote access fails, inspect the Mac's LaunchAgent and use local Desktop Commander before assuming Oracle is unhealthy.

Oracle connection details are **not** the hostname `rakazo`: use Rakazo's existing private SSH environment, not a hard-coded alias or copied IP. The health check connects directly from the Mac; Desktop Commander Remote is not needed for the Oracle cron itself.

Limitations: the error scan reviews the latest 100 log lines and the classification-failure sum is over that window. The check does not establish historical absence of failures, nor prove Gmail-side changes. No monitoring schedule is installed for this script. The 15-minute Oracle cron is independent and unchanged.
