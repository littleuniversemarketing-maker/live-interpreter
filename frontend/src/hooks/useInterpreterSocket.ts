import { useCallback, useRef, useState } from "react";
import type { ClientToServerMessage, ServerToClientMessage } from "../types";

const WS_URL = (() => {
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
  // Messages sent before the socket finishes opening used to be silently
  // dropped — queue them here and flush once onopen fires.
  const pendingMessages = useRef<ClientToServerMessage[]>([]);

  const connect = useCallback(() => {
    shouldReconnect.current = true;
    const ws = new WebSocket(WS_URL);
    socketRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setReconnecting(false);
      reconnectAttempt.current = 0;
      const queued = pendingMessages.current;
      pendingMessages.current = [];
      for (const msg of queued) {
        ws.send(JSON.stringify(msg));
      }
    };

    ws.onmessage = (event) => {
      try {
        onMessageRef.current(JSON.parse(event.data));
      } catch {
        // Malformed frame — drop it rather than crash the session.
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
    pendingMessages.current.push(msg);
    return false;
  }, []);

  return { connect, disconnect, send, connected, reconnecting };
}
