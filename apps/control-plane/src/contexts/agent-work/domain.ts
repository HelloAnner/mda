import type {
  AgentJobState,
  AgentTerminalError,
  SettleAgentJobRequest,
} from "@mda/contracts";

export interface AgentJobAggregate {
  id: string;
  state: AgentJobState;
  attemptCount: number;
  leaseOwner?: string;
  fencingToken: number;
  leaseExpiresAt?: string;
  cancellationRequestedAt?: string;
  terminalError?: AgentTerminalError;
  version: number;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}

export class AgentJobTransitionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const terminalStates: AgentJobState[] = ["succeeded", "failed", "cancelled"];

function assertLease(
  job: AgentJobAggregate,
  owner: string,
  fencingToken: number,
  now: Date,
): void {
  if (job.leaseOwner !== owner || job.fencingToken !== fencingToken) {
    throw new AgentJobTransitionError("STALE_LEASE", "Agent lease is stale");
  }
  if (!job.leaseExpiresAt || new Date(job.leaseExpiresAt) <= now) {
    throw new AgentJobTransitionError("LEASE_EXPIRED", "Agent lease expired");
  }
}

export function claimJob(
  job: AgentJobAggregate,
  owner: string,
  now: Date,
  leaseMs: number,
): AgentJobAggregate {
  if (job.state !== "queued") {
    throw new AgentJobTransitionError("JOB_NOT_CLAIMABLE", "Job is not queued");
  }
  return {
    ...job,
    state: "leased",
    attemptCount: job.attemptCount + 1,
    leaseOwner: owner,
    fencingToken: job.fencingToken + 1,
    leaseExpiresAt: new Date(now.getTime() + leaseMs).toISOString(),
    version: job.version + 1,
  };
}

export function startJob(
  job: AgentJobAggregate,
  owner: string,
  fencingToken: number,
  now: Date,
): AgentJobAggregate {
  if (job.state !== "leased") {
    throw new AgentJobTransitionError("JOB_NOT_LEASED", "Job is not leased");
  }
  assertLease(job, owner, fencingToken, now);
  return {
    ...job,
    state: "running",
    startedAt: job.startedAt ?? now.toISOString(),
    version: job.version + 1,
  };
}

export function renewJobLease(
  job: AgentJobAggregate,
  owner: string,
  fencingToken: number,
  now: Date,
  leaseMs: number,
): AgentJobAggregate {
  if (job.state !== "leased" && job.state !== "running") {
    throw new AgentJobTransitionError("JOB_NOT_ACTIVE", "Job is not active");
  }
  assertLease(job, owner, fencingToken, now);
  const candidate = new Date(now.getTime() + leaseMs).toISOString();
  return {
    ...job,
    leaseExpiresAt:
      candidate > (job.leaseExpiresAt ?? candidate)
        ? candidate
        : job.leaseExpiresAt,
    version: job.version + 1,
  };
}

export function settleJob(
  job: AgentJobAggregate,
  command: SettleAgentJobRequest,
  now: Date,
): AgentJobAggregate {
  if (job.state !== "running") {
    throw new AgentJobTransitionError("JOB_NOT_RUNNING", "Job is not running");
  }
  assertLease(job, command.owner, command.fencingToken, now);
  if (job.cancellationRequestedAt && command.state !== "cancelled") {
    throw new AgentJobTransitionError(
      "CANCELLATION_REQUESTED",
      "Job cancellation was requested",
    );
  }
  if (command.state === "failed" && !command.error) {
    throw new AgentJobTransitionError(
      "TERMINAL_ERROR_REQUIRED",
      "Failed Jobs require a sanitized error",
    );
  }
  if (command.state !== "failed" && command.error) {
    throw new AgentJobTransitionError(
      "TERMINAL_ERROR_NOT_ALLOWED",
      "Only failed Jobs may include an error",
    );
  }

  return {
    ...job,
    state: command.state,
    leaseOwner: undefined,
    leaseExpiresAt: undefined,
    terminalError: command.error,
    finishedAt: now.toISOString(),
    version: job.version + 1,
  };
}

export function requestJobCancellation(
  job: AgentJobAggregate,
  now: Date,
): AgentJobAggregate {
  if (terminalStates.includes(job.state) || job.cancellationRequestedAt) {
    return job;
  }
  if (job.state === "queued") {
    return {
      ...job,
      state: "cancelled",
      cancellationRequestedAt: now.toISOString(),
      finishedAt: now.toISOString(),
      version: job.version + 1,
    };
  }
  return {
    ...job,
    cancellationRequestedAt: now.toISOString(),
    version: job.version + 1,
  };
}

export function recoverExpiredJob(
  job: AgentJobAggregate,
  now: Date,
): AgentJobAggregate {
  if (
    (job.state !== "leased" && job.state !== "running") ||
    !job.leaseExpiresAt ||
    new Date(job.leaseExpiresAt) > now
  ) {
    throw new AgentJobTransitionError(
      "JOB_NOT_RECOVERABLE",
      "Job lease has not expired",
    );
  }
  const cancelled = Boolean(job.cancellationRequestedAt);
  return {
    ...job,
    state: cancelled ? "cancelled" : "queued",
    leaseOwner: undefined,
    leaseExpiresAt: undefined,
    ...(cancelled ? { finishedAt: now.toISOString() } : {}),
    version: job.version + 1,
  };
}
