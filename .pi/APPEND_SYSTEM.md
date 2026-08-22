# Repository Workflow

After completing requested code or documentation changes, running the relevant
checks, and passing the deployment verification required below:

1. Commit only the changes made for the current task with a concise commit message.
2. Push the current branch to its configured remote automatically.
3. Do not amend existing commits, rewrite history, or force-push.
4. If committing or pushing fails, report the error instead of hiding it.

Never push a feature before the newest CLI from the local working tree has
passed its feature test against the newest deployed environment.

Do not wait for additional confirmation before a normal commit and push.

# Deployment Workflow

This repository deploys to a remote server. Follow these rules strictly:

## Server access

- Connect to the deployment server through an SSH alias defined by the current
  environment in local `~/.ssh/config`; any environment-specific alias is valid.
- When the environment does not specify an alias, use **`moss-dev-2`**. It is the
  default deployment target, not a required alias for every environment.
- **Never write a real server IP address into any file in this repository.** The
  repo is public; committed files may contain SSH aliases or alias placeholders only.
- The default deployment port is **8356**. Compose exposes the Control Plane on
  `${MDA_PORT:-8356}` (container port 8080).

## Deploying

- `make deploy` is the single entrypoint: it deploys every Compose service to
  the configured server (default: `moss-dev-2`) automatically via `rsync` +
  `docker compose` over SSH. Only when that server is unreachable may it fall
  back to the full local Compose stack.
- **Never deploy or start a local MDA stack while the configured deployment
  server is reachable.** Do not use `make deploy-local`, `docker compose up`, or
  any equivalent local deployment as an additional test when the server is available.
- Every feature follows this release gate:
  1. Implement the feature on the local computer.
  2. Run `bun run typecheck && bun run lint && bun test` locally.
  3. Run `make deploy`; it must update the reachable server rather than local Docker.
  4. From the local working tree, run the newest CLI with `bun run mda` against
     the newest server deployment. Do not test with a stale global CLI or a CLI
     installed on the server.
  5. Exercise the feature itself through the CLI, not only health checks. Use
     `make status` and `make health` as supporting checks, then debug failures
     against the server logs and repeat deployment and CLI testing.
  6. Commit and push the feature only after the local CLI feature test passes.
- If the configured deployment server is unreachable, and only then, deploy the
  full stack locally and run the same newest local CLI feature test against that
  local deployment before committing and pushing.
- To reach the deployed Control Plane from this computer, substitute the active
  alias in `ssh -N -L 8356:127.0.0.1:8356 <ssh-alias>` (use `moss-dev-2` by
  default), then point the CLI at `MDA_API_URL=http://localhost:8356`.

## Secrets

- Real credentials (postgres/redis passwords, agent tokens, model API keys) live
  in the gitignored `.env` and `var/secrets/` on the deployment target; they are
  never committed. `make deploy` bootstraps missing target secrets on first
  deploy and preserves existing target secrets on later deploys.
- The model endpoint defaults to the local environment (`LLM_BASE_URL`,
  `LLM_MODEL_NAME`, `DEEPSEEK_API_KEY`) when present.
