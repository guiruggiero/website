# Imports
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from langfuse import Langfuse

# Paths
SCRIPT_DIR = Path(__file__).resolve().parent
PROMPT_FILE = SCRIPT_DIR.parent / "agentcore" / "prompt.md"
ENV_FILE = SCRIPT_DIR.parent / ".env"
PROMPT_NAME = "GuiPT-Sonic"

# Load env vars from sonic/.env (key=value, one per line, # comments ignored)
def load_env_file(path):
    env = {}
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                env[key.strip()] = value.strip().strip("\"'")
    except FileNotFoundError:
        pass
    return env

env = load_env_file(ENV_FILE)
secret_key = env.get("LANGFUSE_SECRET_KEY") or os.environ.get("LANGFUSE_SECRET_KEY")
public_key = env.get("LANGFUSE_PUBLIC_KEY") or os.environ.get("LANGFUSE_PUBLIC_KEY")

# Langfuse client
langfuse = Langfuse(
    secret_key=secret_key,
    public_key=public_key,
    host="https://us.cloud.langfuse.com",
)

# Pull: download production prompt from Langfuse and write to prompt.md
def pull():
    # Read current local content before overwriting
    local_content = None
    try:
        local_content = PROMPT_FILE.read_text(encoding="utf-8")
    except FileNotFoundError:
        pass

    prompt = langfuse.get_prompt(PROMPT_NAME)
    new_content = prompt.prompt

    # Show diff between local and production
    if local_content is not None:
        with tempfile.NamedTemporaryFile("w", suffix="_old.md", delete=False, encoding="utf-8") as f_old:
            f_old.write(local_content)
            tmp_old = f_old.name
        with tempfile.NamedTemporaryFile("w", suffix="_new.md", delete=False, encoding="utf-8") as f_new:
            f_new.write(new_content)
            tmp_new = f_new.name
        result = subprocess.run(["diff", "-u", tmp_old, tmp_new])
        if result.returncode == 0:
            print("(no changes)")

    PROMPT_FILE.write_text(new_content, encoding="utf-8")
    print(f"Pulled version {prompt.version} to prompt.md")

# Push: upload prompt.md to Langfuse as a new version (not production)
def push():
    content = PROMPT_FILE.read_text(encoding="utf-8")
    prompt = langfuse.create_prompt(
        name=PROMPT_NAME,
        type="text",
        prompt=content,
        labels=[],  # omit "production"
    )
    print(f"Pushed prompt.md as version {prompt.version} (not production)")

# Run based on command-line argument
command = sys.argv[1] if len(sys.argv) > 1 else None
if command == "pull":
    pull()
elif command == "push":
    push()
else:
    print("Usage: python scripts/prompt_sync.py pull|push", file=sys.stderr)
    sys.exit(1)