import express from "express";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { config } from "./config.js";
import { SessionManager } from "./sessionManager.js";
import { LANGUAGES, isSupportedLanguage } from "./languages.js";
import { generateCoachSuggestion } from "./coach.js";

const app = express();

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && config.allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/languages", (_req, res) => res.json(Object.values(LANGUAGES)));

// "Coach me": a plain request/response endpoint, separate from the live
// WebSocket relay. Given something the other person just said, it suggests
// a short natural reply in their language (with a phonetic reading and a
// slow spoken version) so the user can say it back themselves — this is
// deliberately NOT part of the realtime interpreter session, which must
// stay a pure translator (see openaiRealtimeProvider.ts).
app.post("/coach", express.json(), async (req, res) => {
  const { utterance, utteranceLang, replyLang, translatedUtterance } = req.body ?? {};

  if (typeof utterance !== "string" || !utterance.trim()) {
    res.status(400).json({ error: "utterance is required." });
    return;
  }
  if (!isSupportedLanguage(utteranceLang) || !isSupportedLanguage(replyLang)) {
    res.status(400).json({ error: "utteranceLang and replyLang must be supported language codes." });
    return;
  }

  try {
    const suggestion = await generateCoachSuggestion({
      utterance,
      utteranceLang,
      replyLang,
      translatedUtterance: typeof translatedUtterance === "string" ? translatedUtterance : undefined,
    });
    res.json(suggestion);
  } catch (err: any) {
    console.error("Coach endpoint error:", err);
    res.status(502).json({ error: "Could not generate a coaching suggestion right now. Please try again." });
  }
});

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
