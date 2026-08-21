SHELL := /bin/bash
.DEFAULT_GOAL := help

# The deployment host is intentionally fixed in scripts/deploy.sh. Keep the
# real server address in ~/.ssh/config; only the moss-dev-2 alias belongs here.
MDA_REMOTE_DIR   ?= /srv/mda
MDA_PORT         ?= 8356
MDA_BIND_ADDRESS ?= 127.0.0.1
MDA_AGENT_SCALE  ?= 3
MDA_API_URL      ?= http://127.0.0.1:$(MDA_PORT)

export MDA_REMOTE_DIR MDA_PORT MDA_BIND_ADDRESS MDA_AGENT_SCALE MDA_API_URL

.PHONY: help deploy deploy-server deploy-local status health logs down doctor chat tunnel

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

deploy: ## Deploy on the server when reachable, otherwise deploy locally
	@bash scripts/deploy.sh deploy

deploy-server: ## Deploy on the server and fail when it is unreachable
	@bash scripts/deploy.sh deploy-server

deploy-local: ## Deploy the full Compose stack on this computer
	@bash scripts/deploy.sh deploy-local

status: ## Show server stack status, or local status when unreachable
	@bash scripts/deploy.sh status

health: ## Check server readiness, or local readiness when unreachable
	@bash scripts/deploy.sh health

logs: ## Follow logs; optionally set SERVICE=main or SERVICE=agent
	@bash scripts/deploy.sh logs $(SERVICE)

down: ## Stop the server stack, or local stack when unreachable
	@bash scripts/deploy.sh down

doctor: ## Run CLI diagnostics through an existing SSH tunnel
	@MDA_API_URL=$(MDA_API_URL) bun run mda doctor

tunnel: ## Forward local port $(MDA_PORT) to the server Control Plane
	@echo "Forwarding 127.0.0.1:$(MDA_PORT) to moss-dev-2:$(MDA_PORT)"
	@ssh -N -L $(MDA_PORT):127.0.0.1:$(MDA_PORT) moss-dev-2

chat: ## Chat through a tunnel: make chat DASHBOARD=<dashboard-id>
	@test -n "$(DASHBOARD)" || { echo "DASHBOARD is required" >&2; exit 2; }
	@MDA_API_URL=$(MDA_API_URL) bun run mda chat "$(DASHBOARD)"
