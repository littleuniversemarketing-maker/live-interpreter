import { useCallback, useRef, useState } from "react";
import type { ClientToServerMessage, ServerToClientMessage } from "../types";

const WS_URL = (() => {
  // Set VITE_WS_URL when frontend and backend are on different domains
  // (e.g. Netlify + Render) — see README section 6 (Production deployment).
  // Falls back to same-origin, which works for local dev (Vite's proxy)
  // and for a single-domain reverse-proxy deployment.
  const configured = import.meta.env.VITE_WS_URL as string | undefined;
  if (configured) return configured;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/ws/interpreter`;
})();

const MAX_RECONNECT_DELAY_MS = 8000;

export function useInterpreterSocket(onMessage: (msg: ServerToClientMessage) => void) {
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectAttempt = useRef(0);
  const shouldReconnect = useRef(false);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const connect = useCallback(() => {
    shouldReconnect.current = true;
    const ws = new WebSocket(WS_URL);
    socketRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setReconnecting(false);
      reconnectAttempt.current = 0;
    };

    ws.onmessage = (event) => {
      try {
        onMessageRef.current(JSON.parse(event.data));
      } catch {
        // Malformed frame — drop it rather than crash the session
        // (section 16: never crash the conversation).
      }
    };

    ws.onclose = () => {
      setConnected(false);
      socketRef.current = null;
      if (shouldReconnect.current) {
        setReconnecting(true);
        const delay = Math.min(1000 * 2 ** reconnectAttempt.current, MAX_RECONNECT_DELAY_MS);
        reconnectAttempt.current += 1;
        setTimeout(() => {
          if (shouldReconnect.current) connect();
        }, delay);
      }
    };

    ws.onerror = () => {
      // onclose fires right after and drives the reconnect loop above.
    };
  }, []);

  const disconnect = useCallback(() => {
    shouldReconnect.current = false;
    socketRef.current?.close(1000, "user stopped");
    socketRef.current = null;
    setConnected(false);
    setReconnecting(false);
  }, []);

  const send = useCallback((msg: ClientToServerMessage) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }, []);

  return { connect, disconnect, send, connected, reconnecting };
}
