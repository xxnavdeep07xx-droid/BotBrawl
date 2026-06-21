/**
 * Match-runner mini-service — port 3003.
 *
 * Two responsibilities:
 *  1. Accept POST /emit from the Next.js API route (which runs the actual
 *     match) and fan each event out to all socket.io clients who are
 *     subscribed to that match.
 *  2. Accept socket.io connections from the browser. Clients emit
 *     `subscribe_match` with a matchId to join a per-match room; the
 *     service then pushes any event for that match to them.
 */

import { createServer } from "http";
import { Server } from "socket.io";

const PORT = 3003;

const httpServer = createServer((req, res) => {
  if (req.method === "POST" && req.url === "/emit") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const { matchId, event } = JSON.parse(body);
        if (matchId && event) {
          io.to(`match:${matchId}`).emit("match_event", { matchId, ...event });
          if (event.type === "match_end") {
            io.to(`match:${matchId}`).emit("match_end", { matchId, ...event });
          }
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: (err as Error).message }));
      }
    });
    return;
  }
  // Phase 4: Chat emit — let the API route broadcast a persisted chat
  // message to everyone in the match room.
  if (req.method === "POST" && req.url === "/chat-emit") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const { matchId, message } = JSON.parse(body);
        if (matchId && message) {
          io.to(`match:${matchId}`).emit("chat_message", { matchId, message });
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: (err as Error).message }));
      }
    });
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

const io = new Server(httpServer, {
  path: "/",
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60000,
  pingInterval: 25000,
});

io.on("connection", (socket) => {
  console.log(`[socket] connected: ${socket.id}`);

  socket.on("subscribe_match", (matchId: string) => {
    if (typeof matchId !== "string") return;
    socket.join(`match:${matchId}`);
    console.log(`[socket] ${socket.id} subscribed to match ${matchId}`);
    socket.emit("subscribed", { matchId });
  });

  socket.on("unsubscribe_match", (matchId: string) => {
    if (typeof matchId !== "string") return;
    socket.leave(`match:${matchId}`);
    console.log(`[socket] ${socket.id} unsubscribed from match ${matchId}`);
  });

  // Phase 4: Spectator chat — broadcast chat messages to everyone in the
  // match room. The browser sends `chat_message` after persisting via
  // /api/chat/[matchId]; we just fan it out. We also accept a server
  // POST /chat-emit for the API route to broadcast messages it persisted.
  socket.on("chat_message", (payload: { matchId: string; message: any }) => {
    if (!payload || typeof payload.matchId !== "string") return;
    io.to(`match:${payload.matchId}`).emit("chat_message", payload);
  });

  socket.on("disconnect", () => {
    console.log(`[socket] disconnected: ${socket.id}`);
  });
});

httpServer.listen(PORT, () => {
  console.log(`[match-runner] socket.io service listening on port ${PORT}`);
});
