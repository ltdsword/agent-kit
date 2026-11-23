"""Keep tests away from the person's real Herdr app: no alerts, artifacts or hc session from the outer terminal."""
import os

for _name in ("HC_TERMINAL_ID", "HERDR_ENV"):
    os.environ.pop(_name, None)
# Temp repos use the hc backend: without this, the Herdr task mirror writes real tasks to ~/.herdr/tasks.
os.environ["AGENT_KIT_HERDR_TASKS"] = "0"
