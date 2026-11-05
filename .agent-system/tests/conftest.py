"""Keep tests away from the person's real Herdr app: no alerts, artifacts or hc session from the outer terminal."""
import os

for _name in ("HC_TERMINAL_ID", "HERDR_ENV"):
    os.environ.pop(_name, None)
