"use client";

import { useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";

export interface ChatMessage {
  id: string;
  side: "white" | "black" | "system";
  text: string;
  timestamp: number;
  san?: string;
}

interface ChatPanelProps {
  messages: ChatMessage[];
  title?: string;
}

/**
 * Live AI monologue stream. Auto-scrolls to bottom on new messages.
 */
export function ChatPanel({ messages, title = "AI Trash Talk" }: ChatPanelProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  return (
    <div className="flex flex-col h-full border rounded-lg bg-card overflow-hidden">
      <div className="px-4 py-3 border-b bg-muted/40 flex items-center gap-2">
        <span className="text-lg">💬</span>
        <h3 className="font-semibold text-sm">{title}</h3>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-3 space-y-2">
          {messages.length === 0 && (
            <div className="text-xs text-muted-foreground italic text-center py-8">
              No moves yet. The AIs are warming up their excuses...
            </div>
          )}
          {messages.map((m) => (
            <MessageBubble key={m.id} msg={m} />
          ))}
          <div ref={endRef} />
        </div>
      </ScrollArea>
    </div>
  );
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  if (msg.side === "system") {
    return (
      <div className="text-center my-2">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
          {msg.text}
        </span>
      </div>
    );
  }

  const isWhite = msg.side === "white";
  const sideLabel = isWhite ? "WHITE" : "BLACK";
  const sideColor = isWhite
    ? "bg-zinc-100 text-zinc-900 border-zinc-300"
    : "bg-zinc-900 text-zinc-50 border-zinc-700";

  return (
    <div className={`flex flex-col ${isWhite ? "items-start" : "items-end"}`}>
      <div className="flex items-center gap-1.5 mb-0.5">
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${sideColor}`}>
          {sideLabel}
        </span>
        {msg.san && (
          <span className="text-[11px] font-mono text-primary font-bold">
            {msg.san}
          </span>
        )}
        <span className="text-[10px] text-muted-foreground">
          {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        </span>
      </div>
      <div
        className={`max-w-[90%] px-3 py-2 rounded-lg text-sm ${
          isWhite
            ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
            : "bg-zinc-900 dark:bg-zinc-900 text-zinc-100"
        }`}
      >
        {msg.text}
      </div>
    </div>
  );
}
