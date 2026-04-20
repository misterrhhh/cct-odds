import React from "react";
import "./../styles/control-center.scss";
import { useWebSocketState } from "../ws/WebSocketProvider";

function formatTime(value: string | null): string {
  if (!value) {
    return "-";
  }

  return new Date(value).toLocaleTimeString();
}

export function ControlCenterPage(): React.JSX.Element {
  const { connection, fixtures, send, state } = useWebSocketState();

  return (
    <main className="control-center">
      <div className="status-bar">{connection}</div>

      <div className="grid">
        <section className="panel">
          <h1 className="panel-title">Control Center</h1>

          <div className="meta-grid">
            <div className="meta-item">
              <span className="meta-label">Current Round</span>
              <span className="meta-value">{state.currentRound ?? "-"}</span>
            </div>
            <div className="meta-item">
              <span className="meta-label">Phase</span>
              <span className="meta-value">{state.currentPhase ?? "-"}</span>
            </div>
            <div className="meta-item">
              <span className="meta-label">Showing</span>
              <span className="meta-value">{state.showing ? "Yes" : "No"}</span>
            </div>
            <div className="meta-item">
              <span className="meta-label">Selected Fixture</span>
              <span className="meta-value">{state.selectedFixtureName ?? state.selectedFixtureSlug ?? "-"}</span>
            </div>
            <div className="meta-item">
              <span className="meta-label">Sides</span>
              <span className="meta-value">{state.swapSides ? "Swapped" : "Default"}</span>
            </div>
            <div className="meta-item">
              <span className="meta-label">Display Windows</span>
              <span className="meta-value">{state.displayWindows || "-"}</span>
            </div>
            <div className="meta-item">
              <span className="meta-label">Last GSI Payload</span>
              <span className="meta-value">{formatTime(state.lastPayloadAt)}</span>
            </div>
            <div className="meta-item">
              <span className="meta-label">Last Odds Update</span>
              <span className="meta-value">{formatTime(state.lastUpdateAt)}</span>
            </div>
            <div className="meta-item">
              <span className="meta-label">Visible Until</span>
              <span className="meta-value">{formatTime(state.visibleUntil)}</span>
            </div>
            <div className="meta-item">
              <span className="meta-label">Tournament</span>
              <span className="meta-value">{state.tournament ?? "-"}</span>
            </div>
          </div>

          <div className="button-row">
            <button onClick={() => send({ type: "toggleSwapSides" })} type="button">
              Swap Sides
            </button>
            <button onClick={() => send({ type: "refreshOdds" })} type="button">
              Refresh Odds
            </button>
            <button onClick={() => send({ type: "refreshFixtures" })} type="button">
              Refresh Fixtures
            </button>
          </div>

          <div className="status-bar">{state.lastError ?? state.status}</div>

          {state.market && state.displayOutcomes.length > 0 ? (
            <div className="odds-grid">
              {state.displayOutcomes.slice(0, 2).map((outcome) => (
                <article className="odd-card" key={`${outcome.label}-${outcome.name}`}>
                  <p className="odd-side">{outcome.label}</p>
                  <h2 className="odd-name">{outcome.name}</h2>
                  <div className={`odd-price${outcome.active ? "" : " inactive"}`}>
                    {outcome.odds.toFixed(2)}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="loading">No odds loaded yet.</div>
          )}
        </section>

        <aside className="panel">
          <h2 className="panel-title">Fixtures</h2>
          <div className="fixtures">
            {fixtures.length > 0 ? (
              fixtures.map((fixture) => {
                const active = fixture.slug === state.selectedFixtureSlug;

                return (
                  <article className={`fixture${active ? " active" : ""}`} key={fixture.slug}>
                    <p className="fixture-name">{fixture.name}</p>
                    <div className="fixture-meta">{fixture.slug}</div>
                    <div className="fixture-meta">
                      {[
                        fixture.startTime ? new Date(fixture.startTime).toLocaleString() : "Unknown start",
                        fixture.status ?? "unknown"
                      ].join(" | ")}
                    </div>
                    <div className="fixture-actions">
                      <button onClick={() => send({ slug: fixture.slug, type: "selectFixture" })} type="button">
                        {active ? "Selected" : "Use Fixture"}
                      </button>
                    </div>
                  </article>
                );
              })
            ) : (
              <div className="loading">No fixtures available.</div>
            )}
          </div>
          <div className="status-bar">{fixtures.length} fixtures loaded</div>
        </aside>
      </div>
    </main>
  );
}
