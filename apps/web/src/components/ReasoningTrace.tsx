import type { AgentEvent, AgentJob } from "@mda/contracts";
import { ChevronDown } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { isActiveJob, processActivities } from "../lib/events.ts";
import { formatDuration, jobDuration } from "../lib/format.ts";

function ProcessIcon({
  status,
}: {
  status: "running" | "completed" | "failed";
}) {
  if (status === "running") return <span className="trace-spinner" />;
  if (status === "failed") {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <path
          fill="currentColor"
          d="M7 0a7 7 0 1 1 0 14A7 7 0 0 1 7 0Zm0 1.125A5.875 5.875 0 1 0 7 12.875 5.875 5.875 0 0 0 7 1.125Zm0 8.25a1 1 0 1 1 0 2 1 1 0 0 1 0-2Zm0-6.75c.414 0 .75.336.75.75v3.5a.75.75 0 0 1-1.5 0v-3.5c0-.414.336-.75.75-.75Z"
        />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="8" fill="currentColor" />
      <path
        d="M4.25 8.1 6.75 10.5l5-5"
        fill="none"
        stroke="var(--background-gray-main)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ToolIcon({ name, failed }: { name: string; failed: boolean }) {
  if (failed) {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <path
          fill="currentColor"
          d="M7 0a7 7 0 1 1 0 14A7 7 0 0 1 7 0Zm0 1.125A5.875 5.875 0 1 0 7 12.875 5.875 5.875 0 0 0 7 1.125Zm-.75 2.25v3.5a.75.75 0 0 0 1.5 0v-3.5a.75.75 0 0 0-1.5 0ZM7 9.375a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"
        />
      </svg>
    );
  }
  const write = /write|edit|build|register|写|编|构建/i.test(name);
  const read = /read|list|describe|阅读|读取/i.test(name);
  if (write) {
    return (
      <svg width="13" height="13" viewBox="0 0 13 13" aria-hidden="true">
        <path
          fill="currentColor"
          d="M3.53 5.99a.563.563 0 0 1 0 1.126H2.09a.969.969 0 1 0 0 1.937h8.63a1.969 1.969 0 1 1 0 3.938H5.5a.563.563 0 0 1 0-1.126h5.22a.844.844 0 0 0 0-1.687H2.09a2.094 2.094 0 1 1 0-4.188h1.44ZM8.9.458a1.563 1.563 0 0 1 2.21 0l1.124 1.126c.61.61.61 1.6.001 2.21L9.164 6.87c-.292.293-.688.458-1.101.459l-1.128.002a1.563 1.563 0 0 1-1.566-1.566l.002-1.129c0-.413.165-.81.457-1.102L8.9.458Z"
        />
      </svg>
    );
  }
  if (read) {
    return (
      <svg width="12.5" height="14" viewBox="0 0 12.5 14" aria-hidden="true">
        <path
          fill="currentColor"
          d="M10.5 0a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2h8.5ZM2.125 1.125a1 1 0 0 0-1 1v9.75a1 1 0 0 0 1 1H3.25V1.125H2.125Zm2.25 11.75h6a1 1 0 0 0 1-1v-9.75a1 1 0 0 0-1-1h-6v11.75ZM9.313 5.875a.563.563 0 0 1 0 1.125H6.438a.563.563 0 0 1 0-1.125h2.875Zm0-2.625a.563.563 0 0 1 0 1.125H6.438a.563.563 0 0 1 0-1.125h2.875Z"
        />
      </svg>
    );
  }
  return (
    <svg width="13" height="13" viewBox="0 0 13.2 13.1" aria-hidden="true">
      <path
        fill="currentColor"
        d="M3.32.872a6.25 6.25 0 0 1 8.58 1.904l.398-.23a.563.563 0 1 1 .563.974l-.4.23a6.25 6.25 0 0 1-2.64 8.38 6.25 6.25 0 0 1-8.578-1.904l-.4.231a.563.563 0 0 1-.562-.974l.4-.231A6.25 6.25 0 0 1 3.32.872Zm2.134 6.923c.772 1.224 1.635 2.177 2.409 2.761.438.331.802.51 1.066.58.128.035.214.039.263.035.046-.003.062-.012.066-.015.004-.002.02-.012.046-.05.028-.041.067-.117.102-.245.07-.264.098-.668.03-1.213-.119-.963-.513-2.186-1.187-3.467L5.454 7.795Z"
      />
    </svg>
  );
}

function terminalLabel(job: AgentJob): string {
  if (job.state === "failed") return "任务执行失败";
  if (job.state === "cancelled") return "任务已取消";
  return `已完成，耗时${formatDuration(jobDuration(job))}`;
}

export function ReasoningTrace({
  job,
  events,
}: {
  job: AgentJob;
  events: AgentEvent[];
}) {
  const running = isActiveJob(job);
  const activities = useMemo(
    () => processActivities(events, running),
    [events, running],
  );
  const [collapsed, setCollapsed] = useState(!running);

  useEffect(() => {
    if (running) setCollapsed(false);
    else setCollapsed(true);
  }, [running]);

  if (activities.length === 0 && !running) return null;

  return (
    <section className="reasoning-trace" aria-label="工作过程">
      {running ? (
        <div className="running-status" role="status" aria-live="polite">
          {events.some((event) => event.type === "tool.started")
            ? "正在处理中..."
            : "正在思考..."}
        </div>
      ) : (
        <button
          type="button"
          className="reasoning-toggle"
          onClick={() => setCollapsed((value) => !value)}
          title="展开或收起工作过程"
        >
          <span>{terminalLabel(job)}</span>
          <ChevronDown
            size={16}
            style={{ transform: collapsed ? undefined : "rotate(180deg)" }}
          />
        </button>
      )}
      {!collapsed && (
        <div className="trace-feed">
          {activities.map((activity, index) => {
            const connector =
              activity.tools.length > 0 || index < activities.length - 1;
            return (
              <div className="trace-group" key={activity.id}>
                {connector && (
                  <span className="trace-connector" aria-hidden="true" />
                )}
                <div className="trace-note">
                  <span className="process-icon-slot">
                    <ProcessIcon status={activity.status} />
                  </span>
                  <span>{activity.label}</span>
                </div>
                {activity.tools.length > 0 && (
                  <div className="tool-list">
                    {activity.tools.map((tool) => (
                      <div className="tool-row" key={tool.id}>
                        <span className="tool-icon-slot">
                          {tool.status === "running" ? (
                            <span className="timeline-spinner" />
                          ) : (
                            <ToolIcon
                              name={tool.name}
                              failed={tool.status === "failed"}
                            />
                          )}
                        </span>
                        <span>{tool.label}</span>
                        {tool.durationMs !== undefined && (
                          <time>{formatDuration(tool.durationMs)}</time>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
