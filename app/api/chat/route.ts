import { NextResponse } from "next/server";
import { loadKnowledgeForChat } from "@/lib/knowledge";
import { allowQuestion, clientIp } from "@/lib/rate-limit";

type Turn = {
  role: "user" | "assistant";
  content: string;
};

const QUESTION_LIMIT = 2000;
const HISTORY_LIMIT = 6;

export async function POST(request: Request) {
  let body: { messages?: unknown };
  try {
    body = (await request.json()) as { messages?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const turns = recentTurns(body.messages);
  if (turns === "long") {
    return NextResponse.json({ error: "Ask a shorter question." }, { status: 400 });
  }
  if (!turns) {
    return NextResponse.json({ error: "Ask a question." }, { status: 400 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  if (!apiKey) {
    return NextResponse.json({ error: "Chat is not configured." }, { status: 500 });
  }

  if (!allowQuestion(clientIp(request))) {
    return NextResponse.json(
      { error: "Too many questions. Try again in a few minutes." },
      { status: 429 },
    );
  }

  let knowledge: Awaited<ReturnType<typeof loadKnowledgeForChat>>;
  try {
    knowledge = await loadKnowledgeForChat();
  } catch {
    return NextResponse.json(
      { error: "The question could not be answered." },
      { status: 500 },
    );
  }

  if (knowledge.status === "absent") {
    return NextResponse.json({ error: "No PDF has been uploaded yet." }, { status: 404 });
  }
  if (knowledge.status === "unread") {
    return NextResponse.json(
      { error: "The new deck is still being read." },
      { status: 409 },
    );
  }

  const completion = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      stream: true,
      messages: [
        {
          role: "system",
          content: `You answer questions about a PDF deck. Use only the text below. If the answer is not in the deck, say so. Do not use outside knowledge. Mention the page number when it helps.\n\n${knowledge.text}`,
        },
        ...turns,
      ],
    }),
  });

  if (!completion.ok || !completion.body) {
    return NextResponse.json(
      { error: "The question could not be answered." },
      { status: 502 },
    );
  }

  return new Response(streamAnswer(completion.body), {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

function recentTurns(input: unknown): Turn[] | "long" | null {
  if (!Array.isArray(input)) return null;

  const turns: Turn[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") return null;
    const role = (item as { role?: unknown }).role;
    const content = (item as { content?: unknown }).content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") return null;
    const trimmed = content.trim();
    if (!trimmed) continue;
    turns.push({ role, content: trimmed });
  }

  const kept = turns.slice(-HISTORY_LIMIT);
  const question = kept.at(-1);
  if (!question || question.role !== "user") return null;
  if (question.content.length > QUESTION_LIMIT) return "long";
  return kept;
}

function streamAnswer(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  return new ReadableStream({
    async start(controller) {
      const reader = body.getReader();
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const delta = readDelta(line);
            if (delta) controller.enqueue(encoder.encode(delta));
          }
        }
        const delta = readDelta(buffer);
        if (delta) controller.enqueue(encoder.encode(delta));
        controller.close();
      } catch (error) {
        controller.error(error);
      } finally {
        reader.releaseLock();
      }
    },
  });
}

function readDelta(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const data = trimmed.slice(5).trim();
  if (!data || data === "[DONE]") return null;

  try {
    const payload = JSON.parse(data) as {
      choices?: Array<{ delta?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.delta?.content;
    return typeof content === "string" ? content : null;
  } catch {
    return null;
  }
}
