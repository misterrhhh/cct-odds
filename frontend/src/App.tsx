import React from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { ControlCenterPage } from "./routes/ControlCenterPage";
import { LiveOddsPage } from "./routes/LiveOddsPage";

export function App(): React.JSX.Element {
  return (
    <Routes>
      <Route element={<Navigate replace to="/control-center" />} path="/" />
      <Route element={<ControlCenterPage />} path="/control-center" />
      <Route element={<LiveOddsPage />} path="/live-odds" />
    </Routes>
  );
}
