import express from "express";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { config } from "./config.js";
import { SessionManager } from "./sessionManager.js";
import { LANGUAGES } from "./languages.js";

const app = express();

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && config.allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  next();
});

app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/languages", (_req, res) => res.json(Object.values(LANGUAGES)));

const httpServer = createServer(app);

// Realtime audio + control channel. Kept separate from any REST routes so
// the WebSocket relay is the only thing that ever sees API credentials —
// the API key never reaches the browser (section 19).
const wss = new WebSocketServer({ server: httpServer, path: "/ws/interpreter" });

wss.on("connection", (socket, req) => {
  const origin = req.headers.origin;
  if (origin && !config.allowedOrigins.includes(origin)) {
    socket.close(1008, "origin not allowed");
    return;
  }

  const session = new SessionManager(socket);

  socket.on("message", (data, isBinary) => {
    if (isBinary) {
      // Reserved: a binary-frame audio path would land here if you later
      // switch off base64 JSON framing for lower overhead. The current
      // build sends audio as base64 inside JSON control messages for
      // simplicity — see ClientToServerMessage["audio_chunk"].
      return;
    }
    session.handleMessage(data.toString()).catch((err) => {
      console.error("Error handling client message:", err);
    });
  });

  socket.on("close", () => session.dispose());
  socket.on("error", (err) => {
    console.error("Client socket error:", err);
    session.dispose();
  });
});

httpServer.listen(config.port, () => {
  console.log(`Live interpreter backend listening on :${config.port}`);
  console.log(`WebSocket relay at ws://localhost:${config.port}/ws/interpreter`);
});
