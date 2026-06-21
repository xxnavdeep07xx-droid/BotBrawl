"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Send, Users, Loader2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { getMatchSocket } from "@/lib/socket";

interface ChatMessageInfo {
  id: string;
  content: string;
  createdAt: string;
  user: { id: string; name: string };
}

interface SpectatorChatProps {
  matchId: string;
}

export function SpectatorChat({ matchId }: SpectatorChatProps) {
  const qc = useQueryClient();
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const { data: messages, isLoading } = useQuery<ChatMessageInfo[]>({
    queryKey: ["chat", matchId],
    queryFn: async () => {
      const r = await fetch(`/api/chat/${matchId}`);
      const j = await r.json();
      return j.messages;
    },
    refetchInterval: 5000, // fallback polling in case socket misses
  });

  // Listen for live chat messages via socket.io
  useEffect(() => {
    const socket = getMatchSocket();
    const onChat = (payload: { matchId: string; message: ChatMessageInfo }) => {
      if (payload.matchId !== matchId) return;
      qc.setQueryData<ChatMessageInfo[]>(["chat", matchId], (old) => {
        if (!old) return [payload.message];
        // Avoid duplicates (we might have already added it via POST response)
        if (old.some((m) => m.id === payload.message.id)) return old;
        return [...old, payload.message];
      });
    };
    socket.on("chat_message", onChat);
    return () => {
      socket.off("chat_message", onChat);
    };
  }, [matchId, qc]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage() {
    const content = input.trim();
    if (!content || sending) return;
    setSending(true);
    try {
      const r = await fetch(`/api/chat/${matchId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Failed to send");
      // Add our own message immediately (the socket broadcast may also add it,
      // but our dedupe in the onChat handler handles that).
      qc.setQueryData<ChatMessageInfo[]>(["chat", matchId], (old) => {
        if (!old) return [j.message];
        if (old.some((m) => m.id === j.message.id)) return old;
        return [...old, j.message];
      });
      setInput("");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  const all = messages ?? [];

  return (
    <div className="flex flex-col h-full border rounded-lg bg-card overflow-hidden">
      <div className="px-4 py-3 border-b bg-muted/40 flex items-center gap-2">
        <Users className="w-4 h-4" />
        <h3 className="font-semibold text-sm flex-1">Spectator Chat</h3>
        <span className="text-[10px] text-muted-foreground">{all.length} msgs</span>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-3 space-y-2">
          {isLoading && (
            <div className="text-center py-4">
              <Loader2 className="w-4 h-4 animate-spin mx-auto text-muted-foreground" />
            </div>
          )}
          {!isLoading && all.length === 0 && (
            <div className="text-xs text-muted-foreground italic text-center py-8">
              Be the first to react to this match!
            </div>
          )}
          {all.map((m) => (
            <div key={m.id} className="text-sm">
              <span className="font-semibold text-primary mr-1">{m.user.name}:</span>
              <span className="text-foreground">{m.content}</span>
              <span className="text-[10px] text-muted-foreground ml-1">
                {new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          ))}
          <div ref={endRef} />
        </div>
      </ScrollArea>
      <div className="p-2 border-t flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              sendMessage();
            }
          }}
          placeholder="Type a message..."
          maxLength={500}
          disabled={sending}
          className="text-sm"
        />
        <Button size="sm" onClick={sendMessage} disabled={!input.trim() || sending}>
          <Send className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}
