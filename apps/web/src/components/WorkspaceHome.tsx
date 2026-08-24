import {
  ArrowUp,
  Image,
  LayoutDashboard,
  Mic,
  Monitor,
  Paperclip,
  Phone,
  Plus,
  SquarePen,
  X,
} from "lucide-react";
import {
  type KeyboardEvent,
  useState,
} from "react";

interface WorkspaceHomeProps {
  onStart(message: string): void;
}

const recommendations = [
  { icon: <LayoutDashboard size={18} />, text: "创建一块面向管理层的销售经营看板" },
  { icon: <SquarePen size={18} />, text: "基于已有数据源设计能发现异常的运营看板" },
  { icon: <Image size={18} />, text: "检查当前看板的移动布局和空状态" },
];

const chips = [
  { icon: <LayoutDashboard size={14} />, text: "创建看板" },
  { icon: <SquarePen size={14} />, text: "数据探索" },
  { icon: <Image size={14} />, text: "设计指标" },
  { icon: <LayoutDashboard size={14} />, text: "制作报告" },
  { text: "更多" },
];

export function WorkspaceHome({ onStart }: WorkspaceHomeProps) {
  const [message, setMessage] = useState("");
  const [bannerOpen, setBannerOpen] = useState(true);

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
    <main className="workspace-home">
      <h1 className="workspace-hero">我能为你做什么？</h1>

      <section className="composer">
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value.slice(0, 20_000))}
          onKeyDown={keyDown}
          placeholder="向 MDA 描述你想构建的看板，不消耗积分"
          aria-label="任务描述"
          rows={3}
        />
        <div className="composer-tools">
          <button type="button" className="round-button" aria-label="添加附件">
            <Plus size={16} />
          </button>
          <button type="button" className="tool-pill">
            <LayoutDashboard size={14} /> MDA 桌面端
          </button>
          <span className="composer-spacer" />
          <button type="button" className="icon-button" aria-label="语音聊天">
            <Phone size={16} />
          </button>
          <button type="button" className="icon-button" aria-label="麦克风">
            <Mic size={16} />
          </button>
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
      </section>

      <section className="recommendations">
        <div className="recommend-head">
          <span className="recommend-title">为您推荐</span>
          <span className="recommend-actions">
            <button className="icon-button" aria-label="刷新推荐">
              {/* refresh icon omitted for minimalism */}
            </button>
            <button className="icon-button" aria-label="忽略推荐">
              <X size={16} />
            </button>
          </span>
        </div>
        <div className="recommend-grid">
          {recommendations.map((item, index) => (
            <button
              type="button"
              className="recommend-card"
              key={index}
              onClick={() => submit(item.text)}
            >
              <span className="corner">
                <ArrowUp size={14} />
              </span>
              {item.icon}
              <p>{item.text}</p>
            </button>
          ))}
        </div>
      </section>

      <div className="chips">
        {chips.map((chip) => (
          <button
            type="button"
            className="chip"
            key={chip.text}
            onClick={() => submit(chip.text)}
          >
            {chip.icon}
            {chip.text}
          </button>
        ))}
      </div>

      {bannerOpen && (
        <div className="workspace-banner">
          <span className="workspace-banner-icon">
            <Monitor size={22} />
          </span>
          <div>
            <strong>下载适用于 Windows 或 macOS 的 MDA</strong>
            <span>访问本地文件，与桌面无缝协作。</span>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="关闭"
            onClick={() => setBannerOpen(false)}
          >
            <X size={14} />
          </button>
        </div>
      )}
    </main>
  );
}
