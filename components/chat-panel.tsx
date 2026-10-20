"use client";

import { useState, type FormEvent } from "react";

type Turn = {
  role: "user" | "assistant";
  content: string;
};

export function ChatPanel() {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<Turn[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = draft.trim();
    if (!question || pending) return;

    const history = [...messages, { role: "user" as const, content: question }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setDraft("");
    setError(null);
    setPending(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });

      if (!response.ok || !response.body) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error || "The question could not be answered.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let answer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        answer += decoder.decode(value, { stream: true });
        const next = answer;
        setMessages((current) => {
          const copy = current.slice();
          copy[copy.length - 1] = { role: "assistant", content: next };
          return copy;
        });
      }
    } catch (chatError) {
      setMessages((current) => {
        const copy = current.slice();
        const last = copy.at(-1);
        if (last?.role === "assistant" && !last.content) copy.pop();
        return copy;
      });
      setError(
        chatError instanceof Error
          ? chatError.message
          : "The question could not be answered.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="chat-dock">
      {open ? (
        <section className="chat-panel" aria-label="Ask about this document">
          <div className="chat-log" aria-live="polite">
            {messages.length === 0 ? (
              <p className="chat-empty">Ask a question about this document.</p>
            ) : (
              messages.map((message, index) => (
                <p key={`${message.role}-${index}`} className={`chat-${message.role}`}>
                  {message.content || (pending ? "…" : "")}
                </p>
              ))
            )}
          </div>
          {error ? (
            <p className="chat-error" role="alert">
              {error}
            </p>
          ) : null}
          <form className="chat-form" onSubmit={onSubmit}>
            <input
              value={draft}
              placeholder="Ask a question"
              maxLength={2000}
              disabled={pending}
              onChange={(event) => setDraft(event.target.value)}
              aria-label="Question"
            />
            <button type="submit" disabled={pending || !draft.trim()}>
              Send
            </button>
          </form>
        </section>
      ) : null}
      <button
        type="button"
        className="chat-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? "Close" : "Ask"}
      </button>
    </div>
  );
}
