import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ClientMessage, FixtureSummary, LiveOddsState, PublicState, ServerMessage } from "../protocol";

type WebSocketContextValue = {
  connection: string;
  fixtures: FixtureSummary[];
  send: (message: ClientMessage) => void;
  state: PublicState;
  liveOddsState: LiveOddsState;
};

const emptyState: PublicState = {
  currentPhase: null,
  currentRound: null,
  displayOutcomes: [],
  displayWindows: "",
  isDisplayRound: false,
  lastError: null,
  lastPayloadAt: null,
  lastUpdateAt: null,
  market: null,
  phaseEndsIn: null,
  selectedFixtureName: null,
  selectedFixtureSlug: null,
  showing: false,
  status: "Connecting...",
  swapSides: false,
  tournament: null,
  visibleUntil: null
};

const emptyLiveOddsState: LiveOddsState = {
  show: false,
  oddLeft: 0,
  oddRight: 0
};

const WebSocketContext = createContext<WebSocketContextValue | null>(null);

export function WebSocketProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [state, setState] = useState<PublicState>(emptyState);
  const [liveOddsState, setLiveOddsState] = useState<LiveOddsState>(emptyLiveOddsState);
  const [fixtures, setFixtures] = useState<FixtureSummary[]>([]);
  const [connection, setConnection] = useState("Connecting...");
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
    socketRef.current = socket;

    socket.onopen = () => {
      setConnection("Connected");
    };

    socket.onmessage = (event) => {
      const message = JSON.parse(event.data) as ServerMessage;

      if (message.type === "snapshot") {
        const { state, fixtures } = message.payload;
        setState(state);
        setFixtures(fixtures);
        setLiveOddsState({
          show: state.showing,
          oddLeft: state.displayOutcomes[0]?.odds ?? 0,
          oddRight: state.displayOutcomes[1]?.odds ?? 0
        });
        return;
      }

      if (message.type === "error") {
        setConnection(message.error);
      }
    };

    socket.onerror = () => {
      setConnection("WebSocket error");
    };

    socket.onclose = () => {
      setConnection("Disconnected");
      socketRef.current = null;
    };

    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, []);

  const value = useMemo<WebSocketContextValue>(() => {
    return {
      connection,
      fixtures,
      send: (message: ClientMessage) => {
        const socket = socketRef.current;

        if (!socket || socket.readyState !== WebSocket.OPEN) {
          setConnection("WebSocket not connected");
          return;
        }

        socket.send(JSON.stringify(message));
      },
      state,
      liveOddsState
    };
  }, [connection, fixtures, state, liveOddsState]);

  return <WebSocketContext.Provider value={value}>{children}</WebSocketContext.Provider>;
}

export function useWebSocketState(): WebSocketContextValue {
  const value = useContext(WebSocketContext);

  if (!value) {
    throw new Error("useWebSocketState must be used inside WebSocketProvider.");
  }

  return value;
}
