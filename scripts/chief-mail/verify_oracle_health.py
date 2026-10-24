#!/usr/bin/env python3
"""Read-only Chief Oracle health check. No Gmail API calls or credential output."""
import datetime as dt
import base64
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
ENV = ROOT / ".env"
REQUIRED = ("SSH_SANDBOX_HOST", "SSH_SANDBOX_USER", "SSH_SANDBOX_PORT", "SSH_SANDBOX_IDENTITY_FILE")
REMOTE = r"""
import datetime as dt
import json
import sqlite3
import subprocess
from pathlib import Path
now = dt.datetime.now(dt.timezone.utc)
result = {"cron_installed": False, "last_successful_scan": None, "age_minutes": None,
          "errors": [], "classification_failures": 0, "scanner_running": False}
cron = subprocess.run(["crontab", "-l"], capture_output=True, text=True)
result["cron_installed"] = cron.returncode == 0 and any(
    x.strip().startswith("*/15 ") and "chief_mail.py sync" in x
    for x in cron.stdout.splitlines())
db = Path("/home/rakazo-agent/.local/share/chief-mail/triage.sqlite3")
if db.exists():
    try:
        with sqlite3.connect("file:" + str(db) + "?mode=ro", uri=True) as conn:
            row = conn.execute("select value from metadata where key='last_successful_scan'").fetchone()
            if row:
                result["last_successful_scan"] = row[0]
                scan = dt.datetime.fromisoformat(row[0].replace("Z", "+00:00"))
                result["age_minutes"] = round((now - scan).total_seconds()/60, 1)
    except (sqlite3.Error, ValueError) as exc:
        result["errors"].append("database inspection failed: " + type(exc).__name__)
else:
    result["errors"].append("database missing")
log = Path("/home/rakazo-agent/.local/share/chief-mail/sync.log")
if log.exists():
    for line in log.read_text(errors="replace").splitlines()[-100:]:
        try:
            event = json.loads(line)
            if isinstance(event, dict):
                result["classification_failures"] += int(event.get("classification_failures", 0))
                continue
        except (ValueError, TypeError):
            pass
        if any(s in line.lower() for s in ("traceback", "error", "failed")):
            result["errors"].append("scanner log contains an error")
            break
else:
    result["errors"].append("scanner log missing")
proc = subprocess.run(["pgrep", "-f", "^/usr/bin/python3 /home/rakazo-agent/chief-mail/chief_mail.py sync"],
                      capture_output=True, text=True)
result["scanner_running"] = proc.returncode == 0
print(json.dumps(result, sort_keys=True))
"""
def main():
    if not ENV.is_file():
        print(json.dumps({"status":"BLOCKED","reason":"Rakazo private environment missing"}))
        return 2
    config = {}
    for line in ENV.read_text().splitlines():
        if not line.strip() or line.lstrip().startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key in REQUIRED:
            config[key] = value.strip().strip("'\"")
    if not all(config.get(key) for key in REQUIRED):
        print(json.dumps({"status":"BLOCKED","reason":"SSH configuration incomplete"}))
        return 2
    identity = Path(os.path.expanduser(config["SSH_SANDBOX_IDENTITY_FILE"]))
    if not identity.is_file():
        print(json.dumps({"status":"BLOCKED","reason":"SSH identity unavailable"}))
        return 2
    command = ["ssh","-o","BatchMode=yes","-o","ConnectTimeout=8",
               "-o","StrictHostKeyChecking=yes","-i",str(identity),
               "-p",config["SSH_SANDBOX_PORT"],
               config["SSH_SANDBOX_USER"]+"@"+config["SSH_SANDBOX_HOST"],
               "python3 -c "+ "\"import base64;exec(base64.b64decode('" + base64.b64encode(REMOTE.encode()).decode() + "'))\""]
    try:
        response = subprocess.run(command, capture_output=True, text=True, timeout=20)
        if response.returncode:
            raise RuntimeError("SSH or remote check failed")
        data = json.loads(response.stdout)
        age = data.get("age_minutes")
        status = ("HEALTHY" if data["cron_installed"] and age is not None
                  and -2 <= age <= 35 and not data["errors"]
                  and data["classification_failures"] == 0 else "DEGRADED")
        data["status"] = status
        print(json.dumps(data, sort_keys=True))
        return 0 if status == "HEALTHY" else 1
    except (subprocess.TimeoutExpired, RuntimeError, ValueError, KeyError, TypeError):
        print(json.dumps({"status":"BLOCKED","reason":"SSH verification failed; scanner state unknown"}))
        return 2

if __name__ == "__main__":
    sys.exit(main())
