# Repository Workflow

After completing requested code or documentation changes and running the relevant checks:

1. Commit only the changes made for the current task with a concise commit message.
2. Push the current branch to its configured remote automatically.
3. Do not amend existing commits, rewrite history, or force-push.
4. If committing or pushing fails, report the error instead of hiding it.

Do not wait for additional confirmation before a normal commit and push.

# Deployment Workflow

This repository deploys to a remote server. Follow these rules strictly:

## Server access

- Connect to the deployment server via the SSH alias **`moss-dev-2`** only:
  `ssh moss-dev-2`. The alias is defined in the local `~/.ssh/config` and must stay there.
- **Never write the real server IP address into any file in this repository.**
  The repo is public; only the alias `moss-dev-2` may appear in committed files.
- The default deployment port is **8356**. Compose exposes the Control Plane on
  `${MDA_PORT:-8356}` (container port 8080).

## Deploying

- `make deploy` is the single entrypoint: it deploys every Compose service to
  the server automatically via `rsync` + `docker compose` over SSH. When the
  server is unreachable it falls back to the full stack on the local computer.
- Runtime feature verification and debugging happen **on the server**, not in a
  local substitute when the server is available:
  1. Implement the feature locally, run `bun run typecheck && bun run lint && bun test`.
  2. Deploy with `make deploy`.
  3. Verify and debug the live server stack (`make status`, `make health`,
     dashboards, and chat).
- To reach the deployed Control Plane from this computer use an SSH tunnel:
  `ssh -N -L 8356:127.0.0.1:8356 moss-dev-2`, then point the CLI at
  `MDA_API_URL=http://localhost:8356`.

## Secrets

- Real credentials (postgres/redis passwords, agent tokens, model API keys) live
  in the gitignored `.env` and `var/secrets/` on the deployment target; they are
  never committed. `make deploy` bootstraps missing target secrets on first
  deploy and preserves existing target secrets on later deploys.
- The model endpoint defaults to the local environment (`LLM_BASE_URL`,
  `LLM_MODEL_NAME`, `DEEPSEEK_API_KEY`) when present.
