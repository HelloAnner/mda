import { ArrowUp, Hand, Plus } from "lucide-react";
import {
  type FormEvent,
  type KeyboardEvent,
  useState,
} from "react";
import { Button } from "./Ui.tsx";

interface LandingScreenProps {
  onLogin(): void;
  onRegister(): void;
  onStart(message: string): void;
}

const chips = [
  "创建看板",
  "数据探索",
  "设计指标",
  "制作报告",
  "更多",
];

export function LandingScreen({
  onLogin,
  onRegister,
  onStart,
}: LandingScreenProps) {
  const [message, setMessage] = useState("");

  function submit(value = message) {
    const text = value.trim();
    if (!text) return;
    setMessage("");
    onStart(text);
  }

  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <main className="landing-screen">
      <nav className="landing-nav">
        <div className="landing-brand">
          <span className="landing-logo" aria-hidden="true">
            <Hand size={22} />
          </span>
          <span className="landing-word">MDA</span>
        </div>
        <div className="landing-links">
          <button type="button" className="landing-link">功能</button>
          <button type="button" className="landing-link">解决方案</button>
          <button type="button" className="landing-link">资源</button>
        </div>
        <div className="landing-actions">
          <Button tone="ghost" size="compact" onClick={onLogin}>
            登录
          </Button>
          <Button tone="primary" size="compact" onClick={onRegister}>
            注册
          </Button>
        </div>
      </nav>

      <section className="landing-hero">
        <h1 className="landing-title">我能为你做什么？</h1>
        <div className="landing-composer">
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value.slice(0, 20_000))}
            onKeyDown={keyDown}
            placeholder="分配一个任务或提问任何问题"
            aria-label="任务描述"
            rows={3}
          />
          <div className="landing-composer-tools">
            <button
              type="button"
              className="round-button"
              aria-label="添加附件"
            >
              <Plus size={16} />
            </button>
            <span className="composer-spacer" />
            <button
              type="button"
              className="submit-button"
              disabled={!message.trim()}
              aria-label="发送"
              onClick={() => submit()}
            >
              <ArrowUp size={18} />
            </button>
          </div>
        </div>
        <div className="landing-chips">
          {chips.map((chip) => (
            <button
              type="button"
              className="chip"
              key={chip}
              onClick={() => submit(chip)}
            >
              {chip}
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}
