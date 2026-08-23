import { ArrowRight, CircleCheck, KeyRound, Server } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import {
  ApiClient,
  ApiClientError,
  type ConnectionSettings,
} from "../lib/api.ts";
import { Button, Field } from "./Ui.tsx";

export function ConnectionScreen({
  initial,
  onConnected,
}: {
  initial?: ConnectionSettings;
  onConnected(settings: ConnectionSettings): void;
}) {
  const [accessPassword, setAccessPassword] = useState(
    initial?.accessPassword ?? "",
  );
  const [tenant, setTenant] = useState(initial?.tenant || "local");
  const [token, setToken] = useState(initial?.token ?? "");
  const [ready, setReady] = useState<boolean>();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void fetch("/health/ready")
      .then((response) => setReady(response.ok))
      .catch(() => setReady(false));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    const settings = {
      accessPassword: accessPassword.trim(),
      tenant: tenant.trim() || "local",
      token: token.trim(),
    };
    try {
      await new ApiClient(settings).metadata();
      onConnected(settings);
    } catch (caught) {
      setError(
        caught instanceof ApiClientError
          ? caught.code === "ACCESS_PASSWORD_REQUIRED"
            ? "访问密码不正确，请核对后重试。"
            : `${caught.code} · ${caught.message}`
          : "暂时无法连接到控制平面，请稍后重试。",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="connection-screen">
      <div className="connection-grain" aria-hidden="true" />
      <section className="connection-intro">
        <div className="brand-lockup is-large">
          <span className="brand-mark">M</span>
          <strong>MDA</strong>
          <i />
          <span>智能看板工作台</span>
        </div>
        <div className="connection-copy">
          <span className="eyebrow">MANAGED DASHBOARD AGENT</span>
          <h1>
            从一次对话，
            <br />
            到可以分享的看板。
          </h1>
          <p>
            在同一个安静的工作空间里生成、校验、保存、发布并管理每一块看板。
          </p>
        </div>
        <div className="connection-status">
          <span
            className={ready ? "is-ready" : ready === false ? "is-down" : ""}
          >
            {ready ? <CircleCheck size={14} /> : <Server size={14} />}
            {ready === undefined
              ? "正在确认服务状态"
              : ready
                ? "控制平面已就绪"
                : "控制平面暂未就绪"}
          </span>
        </div>
      </section>

      <section className="connection-card">
        <div className="connection-card-head">
          <span className="connection-key">
            <KeyRound size={17} />
          </span>
          <div>
            <h2>连接工作空间</h2>
            <p>凭据仅保留在当前浏览器标签页。</p>
          </div>
        </div>
        <form onSubmit={submit}>
          <Field label="部署访问密码" required>
            <input
              type="password"
              autoComplete="current-password"
              value={accessPassword}
              onChange={(event) => setAccessPassword(event.target.value)}
              placeholder="输入 MDA_ACCESS_PASSWORD"
              required
            />
          </Field>
          <Field label="租户" hint="本地密码模式默认使用 local。">
            <input
              value={tenant}
              onChange={(event) => setTenant(event.target.value)}
              placeholder="local"
            />
          </Field>
          <Field
            label="Bearer Token"
            hint="密码模式可以留空；OIDC 模式需要填写。"
          >
            <input
              type="password"
              autoComplete="off"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="可选"
            />
          </Field>
          {error && (
            <div className="form-banner is-error" role="alert">
              {error}
            </div>
          )}
          <Button
            type="submit"
            tone="primary"
            loading={submitting}
            className="connection-submit"
          >
            进入工作台 <ArrowRight size={15} />
          </Button>
        </form>
        <p className="connection-footnote">
          MDA 不会把访问密码写入服务端、URL 或仓库。
        </p>
      </section>
    </main>
  );
}
