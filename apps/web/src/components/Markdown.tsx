import { marked } from "marked";
import type { ReactNode } from "react";

type MarkdownToken = {
  type: string;
  raw?: string;
  text?: string;
  lang?: string;
  href?: string;
  title?: string | null;
  ordered?: boolean;
  start?: number | "";
  tokens?: MarkdownToken[];
  items?: MarkdownToken[];
  header?: MarkdownToken[];
  rows?: MarkdownToken[][];
};

function keyed<T>(
  values: T[],
  identity: (value: T) => string,
): Array<{ key: string; value: T }> {
  const occurrences = new Map<string, number>();
  return values.map((value) => {
    const base = identity(value);
    const occurrence = occurrences.get(base) ?? 0;
    occurrences.set(base, occurrence + 1);
    return { key: `${base}:${occurrence}`, value };
  });
}

function tokenIdentity(token: MarkdownToken): string {
  return `${token.type}:${token.raw ?? token.text ?? "token"}`;
}

function safeHref(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, window.location.href);
    return ["http:", "https:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function inline(
  tokens: MarkdownToken[] | undefined,
  key = "inline",
): ReactNode[] {
  return (tokens ?? []).map((token, index) => {
    const id = `${key}-${index}`;
    switch (token.type) {
      case "strong":
        return <strong key={id}>{inline(token.tokens, id)}</strong>;
      case "em":
        return <em key={id}>{inline(token.tokens, id)}</em>;
      case "del":
        return <del key={id}>{inline(token.tokens, id)}</del>;
      case "codespan":
        return <code key={id}>{token.text}</code>;
      case "br":
        return <br key={id} />;
      case "link": {
        const href = safeHref(token.href);
        return href ? (
          <a key={id} href={href} target="_blank" rel="noreferrer">
            {inline(token.tokens, id)}
          </a>
        ) : (
          <span key={id}>{inline(token.tokens, id)}</span>
        );
      }
      case "image":
        return <span key={id}>[{token.text || "图片"}]</span>;
      case "escape":
      case "text":
        return token.tokens?.length ? (
          <span key={id}>{inline(token.tokens, id)}</span>
        ) : (
          <span key={id}>{token.text}</span>
        );
      default:
        return token.text ? <span key={id}>{token.text}</span> : null;
    }
  });
}

function blocks(tokens: MarkdownToken[], key = "block"): ReactNode[] {
  return tokens.map((token, index) => {
    const id = `${key}-${index}`;
    switch (token.type) {
      case "space":
        return null;
      case "heading": {
        const depth = Math.min(
          6,
          Math.max(1, Number((token as { depth?: number }).depth ?? 2)),
        );
        const content = inline(token.tokens, id);
        if (depth === 1) return <h1 key={id}>{content}</h1>;
        if (depth === 2) return <h2 key={id}>{content}</h2>;
        if (depth === 3) return <h3 key={id}>{content}</h3>;
        if (depth === 4) return <h4 key={id}>{content}</h4>;
        if (depth === 5) return <h5 key={id}>{content}</h5>;
        return <h6 key={id}>{content}</h6>;
      }
      case "paragraph":
        return <p key={id}>{inline(token.tokens, id)}</p>;
      case "text":
        return token.tokens?.length ? (
          <span key={id}>{inline(token.tokens, id)}</span>
        ) : (
          <span key={id}>{token.text}</span>
        );
      case "code":
        return (
          <pre key={id} data-language={token.lang || undefined}>
            <code>{token.text}</code>
          </pre>
        );
      case "blockquote":
        return (
          <blockquote key={id}>{blocks(token.tokens ?? [], id)}</blockquote>
        );
      case "hr":
        return <hr key={id} />;
      case "list": {
        const children = keyed(token.items ?? [], tokenIdentity).map(
          ({ key: itemKey, value: item }) => {
            const itemId = `${id}-${itemKey}`;
            return <li key={itemId}>{blocks(item.tokens ?? [], itemId)}</li>;
          },
        );
        return token.ordered ? (
          <ol
            key={id}
            start={typeof token.start === "number" ? token.start : undefined}
          >
            {children}
          </ol>
        ) : (
          <ul key={id}>{children}</ul>
        );
      }
      case "table":
        return (
          <div className="markdown-table-scroll" key={id}>
            <table>
              <thead>
                <tr>
                  {keyed(token.header ?? [], tokenIdentity).map(
                    ({ key: cellKey, value: cell }) => {
                      const cellId = `${id}-head-${cellKey}`;
                      return (
                        <th key={cellId}>{inline(cell.tokens, cellId)}</th>
                      );
                    },
                  )}
                </tr>
              </thead>
              <tbody>
                {keyed(token.rows ?? [], (row) =>
                  row.map(tokenIdentity).join("|"),
                ).map(({ key: rowKey, value: row }) => {
                  const rowId = `${id}-row-${rowKey}`;
                  return (
                    <tr key={rowId}>
                      {keyed(row, tokenIdentity).map(
                        ({ key: cellKey, value: cell }) => {
                          const cellId = `${rowId}-${cellKey}`;
                          return (
                            <td key={cellId}>{inline(cell.tokens, cellId)}</td>
                          );
                        },
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      case "html":
        return token.text ? <p key={id}>{token.text}</p> : null;
      default:
        return token.tokens?.length ? (
          <div key={id}>{blocks(token.tokens, id)}</div>
        ) : token.text ? (
          <p key={id}>{token.text}</p>
        ) : null;
    }
  });
}

export function Markdown({ content }: { content: string }) {
  const tokens = marked.lexer(content, {
    gfm: true,
    breaks: true,
  }) as MarkdownToken[];
  return <div className="markdown-content">{blocks(tokens)}</div>;
}
