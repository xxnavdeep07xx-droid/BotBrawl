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

  socket.on("disconnect", () => {
    console.log(`[socket] disconnected: ${socket.id}`);
  });
});

httpServer.listen(PORT, () => {
  console.log(`[match-runner] socket.io service listening on port ${PORT}`);
});
