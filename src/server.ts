import express, { Request, Response } from "express";
import fs from "fs";
import http from "http";
import path from "path";
import { WebSocket, WebSocketServer } from "ws";
import {
  ClientMessage,
  DisplayOutcome,
  FixtureSummary,
  MarketSnapshot,
  PublicState,
  ServerMessage
} from "./shared/protocol";

type FixtureFeedItem = {
  competitors?: string[];
  name: string;
  slug: string;
  startTime?: number;
  status?: string;
};

type FixturesFeedResponse = {
  fixtures?: FixtureFeedItem[];
  tournament?: string;
};

type OddsFeedMarket = {
  name: string;
  outcomes: Array<{
    active: boolean;
    name: string;
    odds: number;
  }>;
  specifiers?: string;
  updatedAt?: number;
};

type OddsFeedResponse = {
  fixture?: {
    name?: string;
    slug?: string;
  };
  groups?: Array<{
    markets?: OddsFeedMarket[][];
  }>;
};

type InternalState = Omit<PublicState, "displayOutcomes">;

const port = 9902;
const fixturesUrl =
  process.env.FIXTURES_URL ??
  "https://odds-data.stake.com/sports/counter-strike/international-3/cct-season-3-global-finals-t10/fixtures";
const configuredFixtureSlug = process.env.FIXTURE_SLUG ?? null;
const configuredSwapSides = parseBoolean(process.env.SWAP_SIDES) ?? false;
const oddsRefreshIntervalMs = parsePositiveInt(process.env.ODDS_REFRESH_INTERVAL_MS) ?? 60000;
const regulationDisplayRounds = new Set([1, 5, 10, 15, 20]);
const overtimeStartRound = 25;
const overtimeCycleLength = 6;
const finalFreezetimeSeconds = 5;
const openingLiveSeconds = 7;
const fixturesCacheMs = 30_000;

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

let fixtures: FixtureSummary[] = [];
let fixturesCacheExpiresAt = 0;
let lastFetchedRound: number | null = null;
let lastFetchedFixtureSlug: string | null = null;
let lastVisibleRound: number | null = null;
let liveWindowStartedAtMs: number | null = null;
let visibleUntilMs: number | null = null;

const state: InternalState = {
  currentPhase: null,
  currentRound: null,
  displayWindows: "Rounds 1, 5, 10, 15, 20, and overtime round 1. Last 5s of freezetime + first 7s of live.",
  isDisplayRound: false,
  lastError: null,
  lastPayloadAt: null,
  lastUpdateAt: null,
  market: null,
  phaseEndsIn: null,
  selectedFixtureName: null,
  selectedFixtureSlug: configuredFixtureSlug,
  showing: false,
  status: configuredFixtureSlug
    ? `Waiting for GSI. Fixture locked to ${configuredFixtureSlug}.`
    : "Waiting for GSI. Select a fixture from the control center.",
  swapSides: configuredSwapSides,
  tournament: null,
  visibleUntil: null
};

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use("/assets", express.static(resolveServerAssetsDirectory()));

app.get("/health", (_req: Request, res: Response) => {
  res.json({
    ok: true
  });
});

app.post("/gsi/input", (req: Request, res: Response) => {
  void processGsiPayload(req.body);

  res.status(202).json({
    accepted: true
  });
});

app.use(express.static(resolveFrontendDistDirectory()));

app.get(["/", "/control-center", "/live-odds"], (_req: Request, res: Response) => {
  const indexPath = path.join(resolveFrontendDistDirectory(), "index.html");

  if (!fs.existsSync(indexPath)) {
    res.status(503).type("text/plain").send(
      "Frontend build not found. Build the React app in ./frontend and make sure ./frontend/dist exists."
    );
    return;
  }

  res.sendFile(indexPath);
});

wss.on("connection", (socket) => {
  sendMessage(socket, buildSnapshotMessage());

  socket.on("message", (raw) => {
    void handleClientMessage(socket, raw.toString());
  });
});

server.listen(port, "0.0.0.0", async () => {
  console.log(`Server listening on http://localhost:${port}`);
  console.log(`Control center: http://localhost:${port}/control-center`);
  console.log(`Live odds: http://localhost:${port}/live-odds`);
  console.log(`GSI endpoint: http://localhost:${port}/gsi/input`);
  console.log(`WebSocket endpoint: ws://localhost:${port}/ws`);

  try {
    await refreshFixtures(true);

    if (configuredFixtureSlug) {
      const selectedFixture = fixtures.find((fixture) => fixture.slug === configuredFixtureSlug);
      if (selectedFixture) {
        state.selectedFixtureName = selectedFixture.name;
      }
    }

    broadcastSnapshot();
  } catch (error) {
    state.lastError = toErrorMessage(error);
    state.status = "Failed to load fixtures on startup.";
    broadcastSnapshot();
  }

  if (oddsRefreshIntervalMs !== null) {
    console.log(`Polling odds every ${oddsRefreshIntervalMs}ms.`);
    setInterval(() => {
      if (state.selectedFixtureSlug) {
        console.log(`[odds] scheduled refresh for ${state.selectedFixtureSlug}`);
        void refreshOdds(true);
      }
    }, oddsRefreshIntervalMs);
  }
});

async function handleClientMessage(socket: WebSocket, raw: string): Promise<void> {
  try {
    const parsed = JSON.parse(raw) as ClientMessage;

    switch (parsed.type) {
      case "toggleSwapSides":
        state.swapSides = !state.swapSides;
        state.lastError = null;
        state.status = state.swapSides ? "Swapped left and right display." : "Using default side order.";
        broadcastSnapshot();
        return;

      case "setSwapSides":
        state.swapSides = parsed.swap;
        state.lastError = null;
        state.status = state.swapSides ? "Swapped left and right display." : "Using default side order.";
        broadcastSnapshot();
        return;

      case "selectFixture":
        await selectFixture(parsed.slug);
        return;

      case "refreshOdds":
        await refreshOdds(true);
        return;

      case "refreshFixtures":
        await refreshFixtures(true);
        state.lastError = null;
        state.status = "Fixtures refreshed.";
        broadcastSnapshot();
        return;

      default:
        sendMessage(socket, {
          error: "Unsupported client message.",
          type: "error"
        });
    }
  } catch (error) {
    const message = toErrorMessage(error);
    state.lastError = message;
    state.status = "Command failed.";
    broadcastSnapshot();
    sendMessage(socket, {
      error: message,
      type: "error"
    });
  }
}

async function processGsiPayload(payload: unknown): Promise<void> {
  const now = Date.now();
  const wasShowing = state.showing;
  const previousVisibleRound = lastVisibleRound;

  state.lastPayloadAt = new Date(now).toISOString();
  state.currentPhase = extractPhase(payload);
  state.phaseEndsIn = extractPhaseEndsIn(payload);

  const round = extractRoundNumber(payload);

  if (round === null) {
    state.currentRound = null;
    state.isDisplayRound = false;
    state.showing = false;
    state.visibleUntil = null;
    state.lastError = null;
    state.status = "Received GSI but could not determine the current round.";
    resetVisibilityWindow();
    if (wasShowing) {
      console.log("[animation] end (round lost)");
    }
    broadcastSnapshot();
    return;
  }

  state.currentRound = round;
  state.isDisplayRound = shouldDisplayAtRound(round);
  updateVisibilityWindow(round, state.currentPhase, state.phaseEndsIn, now);

  if (!wasShowing && state.showing) {
    console.log(`[animation] start — round ${round}, phase: ${state.currentPhase}`);
  } else if (wasShowing && !state.showing) {
    console.log(`[animation] end — round ${round}, phase: ${state.currentPhase}`);
  }

  if (!state.isDisplayRound) {
    state.lastError = null;
    state.status = `Current round ${round}. Waiting for the next configured display round.`;
    broadcastSnapshot();
    return;
  }

  if (!state.showing) {
    state.lastError = null;
    state.status = buildWaitingStatus(round, state.currentPhase);
    broadcastSnapshot();
    return;
  }

  if (!state.selectedFixtureSlug) {
    state.lastError = null;
    state.status = `Round ${round} is in the display window, but no fixture is selected.`;
    broadcastSnapshot();
    return;
  }

  await refreshOdds(!wasShowing || previousVisibleRound !== round);
}

async function selectFixture(slug: string): Promise<void> {
  await refreshFixtures(false);

  const fixture = fixtures.find((entry) => entry.slug === slug);
  if (!fixture) {
    state.lastError = `Fixture slug not found: ${slug}`;
    state.status = "Failed to select fixture.";
    broadcastSnapshot();
    return;
  }

  state.selectedFixtureSlug = fixture.slug;
  state.selectedFixtureName = fixture.name;
  state.lastError = null;
  state.status = `Selected fixture ${fixture.name}.`;
  resetOddsCache();

  if (state.showing) {
    await refreshOdds(true);
    return;
  }

  broadcastSnapshot();
}

async function refreshFixtures(force: boolean): Promise<void> {
  const now = Date.now();

  if (!force && fixtures.length > 0 && fixturesCacheExpiresAt > now) {
    return;
  }

  const response = await fetch(fixturesUrl);
  if (!response.ok) {
    throw new Error(`Fixtures request failed with HTTP ${response.status}`);
  }

  const data = (await response.json()) as FixturesFeedResponse;
  fixtures = (data.fixtures ?? []).map((fixture) => ({
    competitors: fixture.competitors ?? [],
    name: fixture.name,
    slug: fixture.slug,
    startTime: fixture.startTime ? new Date(fixture.startTime).toISOString() : null,
    status: fixture.status ?? null
  }));

  fixturesCacheExpiresAt = now + fixturesCacheMs;
  state.tournament = data.tournament ?? null;

  if (state.selectedFixtureSlug) {
    const selected = fixtures.find((fixture) => fixture.slug === state.selectedFixtureSlug);
    state.selectedFixtureName = selected?.name ?? state.selectedFixtureName;
  }
}

async function refreshOdds(force: boolean): Promise<void> {
  const fixtureSlug = state.selectedFixtureSlug;

  if (!fixtureSlug) {
    state.lastError = "No fixture selected.";
    state.status = "Select a fixture before refreshing odds.";
    broadcastSnapshot();
    return;
  }

  const currentRound = state.currentRound;
  const needsFetch =
    force ||
    !state.market ||
    lastFetchedRound !== currentRound ||
    lastFetchedFixtureSlug !== fixtureSlug;

  if (!needsFetch) {
    state.lastError = null;
    state.status = `Displaying odds for ${state.selectedFixtureName ?? fixtureSlug}.`;
    broadcastSnapshot();
    return;
  }

  try {
    const market = await fetchMatchWinnerOdds(fixtureSlug);
    state.market = market;
    state.selectedFixtureName = market.fixtureName;
    state.lastError = null;
    state.lastUpdateAt = new Date().toISOString();
    state.status = `Loaded odds for ${market.fixtureName}.`;
    lastFetchedRound = currentRound;
    lastFetchedFixtureSlug = fixtureSlug;
  } catch (error) {
    state.lastError = toErrorMessage(error);
    state.status = "Failed to refresh odds.";
  }

  broadcastSnapshot();
}

async function fetchMatchWinnerOdds(fixtureSlug: string): Promise<MarketSnapshot> {
  const response = await fetch(`https://odds-data.stake.com/odds/${fixtureSlug}`);
  if (!response.ok) {
    throw new Error(`Odds request failed with HTTP ${response.status}`);
  }

  const data = (await response.json()) as OddsFeedResponse;
  const market = findMatchWinnerTwoWayMarket(data);

  if (!market) {
    throw new Error(`Could not find the Match Winner - Twoway market for ${fixtureSlug}`);
  }

  return {
    fetchedAt: new Date().toISOString(),
    fixtureName: data.fixture?.name ?? fixtureSlug,
    fixtureSlug,
    marketName: market.name,
    marketUpdatedAt: market.updatedAt ? new Date(market.updatedAt).toISOString() : null,
    outcomes: market.outcomes.map((outcome) => ({
      active: outcome.active,
      name: outcome.name,
      odds: outcome.odds
    }))
  };
}

function findMatchWinnerTwoWayMarket(data: OddsFeedResponse): OddsFeedMarket | null {
  for (const group of data.groups ?? []) {
    for (const bucket of group.markets ?? []) {
      for (const market of bucket) {
        if (market.name === "Match Winner - Twoway" && market.specifiers?.includes("way=two")) {
          return market;
        }
      }
    }
  }

  return null;
}

function shouldDisplayAtRound(round: number): boolean {
  if (regulationDisplayRounds.has(round)) {
    return true;
  }

  if (round >= overtimeStartRound) {
    return (round - overtimeStartRound) % overtimeCycleLength === 0;
  }

  return false;
}

function updateVisibilityWindow(
  round: number,
  phase: string | null,
  phaseEndsIn: number | null,
  now: number
): void {
  state.showing = false;
  state.visibleUntil = null;

  if (!state.isDisplayRound) {
    resetVisibilityWindow();
    return;
  }

  if (phase === "freezetime") {
    liveWindowStartedAtMs = null;

    if (phaseEndsIn !== null && phaseEndsIn <= finalFreezetimeSeconds) {
      visibleUntilMs = now + Math.max(0, phaseEndsIn) * 1000 + openingLiveSeconds * 1000;
      state.showing = true;
      state.visibleUntil = new Date(visibleUntilMs).toISOString();
      lastVisibleRound = round;
      return;
    }

    visibleUntilMs = null;
    return;
  }

  if (phase === "live") {
    if (liveWindowStartedAtMs === null || lastVisibleRound !== round) {
      liveWindowStartedAtMs = now;
    }

    visibleUntilMs = liveWindowStartedAtMs + openingLiveSeconds * 1000;

    if (now <= visibleUntilMs) {
      state.showing = true;
      state.visibleUntil = new Date(visibleUntilMs).toISOString();
      lastVisibleRound = round;
      return;
    }

    return;
  }

  resetVisibilityWindow();
}

function resetVisibilityWindow(): void {
  liveWindowStartedAtMs = null;
  visibleUntilMs = null;
}

function extractRoundNumber(payload: unknown): number | null {
  if (!isRecord(payload)) {
    return null;
  }

  const map = asRecord(payload.map);
  const teamCt = asRecord(map?.team_ct);
  const teamT = asRecord(map?.team_t);
  const round = asRecord(payload.round);

  const ctScore = parsePositiveInt(teamCt?.score);
  const tScore = parsePositiveInt(teamT?.score);
  if (ctScore !== null && tScore !== null) {
    return ctScore + tScore + 1;
  }

  const candidates = [
    payload.currentRound,
    map?.round,
    map?.current_round,
    round?.number,
    round?.round
  ];

  for (const candidate of candidates) {
    const parsed = parsePositiveInt(candidate);
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

function extractPhase(payload: unknown): string | null {
  if (!isRecord(payload)) {
    return null;
  }

  const phaseCountdowns = asRecord(payload.phase_countdowns);
  const round = asRecord(payload.round);

  return asNonEmptyString(phaseCountdowns?.phase) ?? asNonEmptyString(round?.phase) ?? null;
}

function extractPhaseEndsIn(payload: unknown): number | null {
  if (!isRecord(payload)) {
    return null;
  }

  const phaseCountdowns = asRecord(payload.phase_countdowns);
  const value = phaseCountdowns?.phase_ends_in;

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isNaN(parsed) ? null : parsed;
  }

  return null;
}

function buildWaitingStatus(round: number, phase: string | null): string {
  if (phase === "freezetime") {
    return `Round ${round} is a display round. Waiting for the final ${finalFreezetimeSeconds}s of freezetime.`;
  }

  if (phase === "live") {
    return `Round ${round} is a display round. The first ${openingLiveSeconds}s of live have passed.`;
  }

  if (phase) {
    return `Round ${round} is a display round. Current phase: ${phase}.`;
  }

  return `Round ${round} is a display round. Waiting for freezetime or live timing.`;
}

function getDisplayOutcomes(): DisplayOutcome[] {
  const base = state.market?.outcomes ?? [];
  if (base.length < 2) {
    return [];
  }

  const ordered = state.swapSides ? [...base].reverse() : base;

  return ordered.slice(0, 2).map((outcome, index) => ({
    active: outcome.active,
    label: index === 0 ? "Left" : "Right",
    name: outcome.name,
    odds: outcome.odds
  }));
}

function getPublicState(): PublicState {
  return {
    ...state,
    displayOutcomes: getDisplayOutcomes()
  };
}

function buildSnapshotMessage(): ServerMessage {
  return {
    payload: {
      fixtures,
      state: getPublicState()
    },
    type: "snapshot"
  };
}

function broadcastSnapshot(): void {
  const payload = JSON.stringify(buildSnapshotMessage());

  for (const client of wss.clients) {
    if (client.readyState !== WebSocket.OPEN) {
      continue;
    }

    client.send(payload);
  }
}

function sendMessage(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(JSON.stringify(message));
}

function resetOddsCache(): void {
  state.market = null;
  state.lastUpdateAt = null;
  lastFetchedFixtureSlug = null;
  lastFetchedRound = null;
}

function resolveServerAssetsDirectory(): string {
  return path.resolve(process.cwd(), "src", "assets");
}

function resolveFrontendDistDirectory(): string {
  return path.resolve(process.cwd(), "frontend", "dist");
}

function parsePositiveInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }

  if (typeof value === "string") {
    const match = value.match(/\d+/);
    if (!match) {
      return null;
    }

    const parsed = Number.parseInt(match[0], 10);
    return Number.isNaN(parsed) ? null : parsed;
  }

  return null;
}

function parseBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") {
      return true;
    }

    if (normalized === "false" || normalized === "0") {
      return false;
    }
  }

  return null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
