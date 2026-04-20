import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { WebSocketProvider } from "./ws/WebSocketProvider";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Missing root element.");
}

createRoot(root).render(
  <React.StrictMode>
    <BrowserRouter>
      <WebSocketProvider>
        <App />
      </WebSocketProvider>
    </BrowserRouter>
  </React.StrictMode>
);
