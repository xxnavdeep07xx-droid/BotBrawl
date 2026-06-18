/**
 * Socket.io client helper — connects to the match-runner mini-service
 * on port 3003 via the Caddy gateway (using XTransformPort).
 */

import { io, Socket } from "socket.io-client";

let _socket: Socket | null = null;

export function getMatchSocket(): Socket {
  if (_socket) return _socket;
  _socket = io("/?XTransformPort=3003", {
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
  });
  return _socket;
}

export interface LiveMatchEvent {
  matchId: string;
  type: string;
  ply: number;
  side: string;
  san?: string;
  monologue?: string;
  retries?: number;
  apiErrors?: number;
  elapsedMs?: number;
  rawResponse?: string;
  timestamp: number;
  extra?: Record<string, unknown>;
}
