import { useEffect, useRef, useState, useCallback } from "react";
import { queryClient } from "@/lib/queryClient";

interface WSMessage {
  type: string;
  data: any;
  timestamp: string;
}

// Build WS base URL using the same pattern as API_BASE in queryClient
const API_BASE = "";

function buildWsUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";

  if (!API_BASE) {
    // Local development — connect directly
    return `${protocol}//${window.location.host}/ws`;
  }

  // Deployed — use proxy path
  const origin = window.location.origin;
  const pathBase = window.location.pathname.replace(/\/[^/]*$/, "");
  return `${origin}${pathBase}/${API_BASE}/ws`;
}

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WSMessage | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    try {
      const wsUrl = buildWsUrl();
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        if (reconnectTimer.current) {
          clearTimeout(reconnectTimer.current);
          reconnectTimer.current = null;
        }
      };

      ws.onmessage = (event) => {
        try {
          const msg: WSMessage = JSON.parse(event.data);
          setLastMessage(msg);

          switch (msg.type) {
            case "stats_update":
              queryClient.setQueryData(["/api/stats"], msg.data);
              break;
            case "market_update":
              queryClient.invalidateQueries({ queryKey: ["/api/markets"] });
              break;
            case "position_update":
              queryClient.invalidateQueries({ queryKey: ["/api/positions"] });
              break;
            case "new_prediction":
              queryClient.invalidateQueries({ queryKey: ["/api/predictions"] });
              break;
            case "trade_executed":
              queryClient.invalidateQueries({ queryKey: ["/api/trades"] });
              queryClient.invalidateQueries({ queryKey: ["/api/positions"] });
              break;
            case "scan_result":
              queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
              queryClient.invalidateQueries({ queryKey: ["/api/markets"] });
              queryClient.invalidateQueries({ queryKey: ["/api/predictions"] });
              break;
            case "engine_status":
              queryClient.invalidateQueries({ queryKey: ["/api/engine/status"] });
              break;
            case "initial_state":
              if (msg.data.stats) queryClient.setQueryData(["/api/stats"], msg.data.stats);
              if (msg.data.markets) queryClient.setQueryData(["/api/markets"], msg.data.markets);
              if (msg.data.predictions) queryClient.setQueryData(["/api/predictions"], msg.data.predictions);
              break;
          }
        } catch {
          // Ignore parse errors
        }
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        reconnectTimer.current = setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      // WebSocket not available in this environment
    }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (wsRef.current) wsRef.current.close();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };
  }, [connect]);

  const sendMessage = useCallback((msg: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  return { connected, lastMessage, sendMessage };
}
