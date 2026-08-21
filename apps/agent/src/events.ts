import type {
  AgentEventType,
  AgentLeaseCommand,
  PendingAgentEvent,
} from "@mda/contracts";
import type { ControlPlaneClient } from "./clients/control-plane.ts";

export class AgentEventForwarder {
  private pending: PendingAgentEvent[] = [];
  private delta = "";
  private timer?: ReturnType<typeof setTimeout>;
  private chain = Promise.resolve();
  private failure?: unknown;

  constructor(
    private readonly client: ControlPlaneClient,
    private readonly jobId: string,
    private readonly lease: AgentLeaseCommand,
  ) {}

  push(type: AgentEventType, data: Record<string, unknown>): void {
    if (type === "assistant.delta") {
      this.delta += String(data.text ?? "");
      if (this.delta.length >= 256) this.flushSoon(0);
      else this.flushSoon(100);
      return;
    }
    this.materializeDelta();
    this.pending.push({ type, data });
    this.flushSoon(0);
  }

  async drain(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.materializeDelta();
    this.send();
    await this.chain;
    if (this.failure) throw this.failure;
  }

  private flushSoon(delay: number): void {
    if (this.timer) {
      if (delay > 0) return;
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.materializeDelta();
      this.send();
    }, delay);
  }

  private materializeDelta(): void {
    if (!this.delta) return;
    this.pending.push({ type: "assistant.delta", data: { text: this.delta } });
    this.delta = "";
  }

  private send(): void {
    if (this.pending.length === 0) return;
    const batch = this.pending.splice(0, 100);
    this.chain = this.chain.then(async () => {
      if (this.failure) return;
      try {
        await this.client.appendEvents(this.jobId, this.lease, batch);
      } catch (error) {
        this.failure = error;
      }
    });
    if (this.pending.length > 0) this.send();
  }
}
