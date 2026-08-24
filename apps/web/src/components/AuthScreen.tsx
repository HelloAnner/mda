import { Hand, LoaderCircle } from "lucide-react";
import { type FormEvent, useState } from "react";
import type { ApiClient, AuthMeResponse } from "../lib/api.ts";
import { ApiClientError } from "../lib/api.ts";
import { Button } from "./Ui.tsx";

interface AuthScreenProps {
  api: ApiClient;
  initialMode?: "login" | "register";
  onAuth(user: AuthMeResponse): void;
  onBack(): void;
}

export function AuthScreen({
  api,
  initialMode = "login",
  onAuth,
  onBack,
}: AuthScreenProps) {
  const [mode, setMode] = useState<"login" | "register">(initialMode);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const response =
        mode === "register"
          ? await api.register(username.trim(), password)
          : await api.login(username.trim(), password);
      onAuth(response);
    } catch (caught) {
      let message = "请求失败，请重试";
      if (caught instanceof ApiClientError) {
        if (caught.code === "USERNAME_TAKEN") {
          message = "用户名已被使用";
        } else if (caught.code === "INVALID_CREDENTIALS") {
          message = "用户名或密码不正确";
        } else if (caught.message) {
          message = caught.message;
        }
      }
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-screen">
      <nav className="auth-nav">
        <button type="button" className="landing-brand" onClick={onBack}>
          <span className="landing-logo" aria-hidden="true">
            <Hand size={22} />
          </span>
          <span className="landing-word">MDA</span>
        </button>
      </nav>

      <section className="auth-card">
        <div className="auth-icon" aria-hidden="true">
          <Hand size={32} />
        </div>
        <h1 className="auth-title">登录或注册</h1>
        <p className="auth-subtitle">和 MDA 一起开始创作</p>

        <div className="auth-tabs">
          <button
            type="button"
            className={mode === "login" ? "is-active" : ""}
            onClick={() => setMode("login")}
          >
            登录
          </button>
          <button
            type="button"
            className={mode === "register" ? "is-active" : ""}
            onClick={() => setMode("register")}
          >
            注册
          </button>
        </div>

        <form onSubmit={submit} className="auth-form">
          <label className="auth-field">
            <span>用户名</span>
            <input
              type="text"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="输入用户名"
              required
            />
          </label>
          <label className="auth-field">
            <span>密码</span>
            <input
              type="password"
              autoComplete={mode === "register" ? "new-password" : "current-password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="输入密码"
              required
            />
          </label>
          {error && <div className="auth-error" role="alert">{error}</div>}
          <Button
            type="submit"
            tone="primary"
            loading={submitting}
            className="auth-submit"
          >
            {submitting ? (
              <LoaderCircle size={14} className="spin" />
            ) : mode === "register" ? (
              "注册并继续"
            ) : (
              "继续"
            )}
          </Button>
        </form>
      </section>
    </main>
  );
}
