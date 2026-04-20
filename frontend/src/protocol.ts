export type FixtureSummary = {
  competitors: string[];
  name: string;
  slug: string;
  startTime: string | null;
  status: string | null;
};

export type OutcomeSnapshot = {
  active: boolean;
  name: string;
  odds: number;
};

export type MarketSnapshot = {
  fetchedAt: string;
  fixtureName: string;
  fixtureSlug: string;
  marketName: string;
  marketUpdatedAt: string | null;
  outcomes: OutcomeSnapshot[];
};

export type DisplayOutcome = {
  active: boolean;
  label: string;
  name: string;
  odds: number;
};

export type LiveOddsState = {
  show: boolean;
  oddLeft: number;
  oddRight: number;
};

export type PublicState = {
  currentPhase: string | null;
  currentRound: number | null;
  displayOutcomes: DisplayOutcome[];
  displayWindows: string;
  isDisplayRound: boolean;
  lastError: string | null;
  lastPayloadAt: string | null;
  lastUpdateAt: string | null;
  market: MarketSnapshot | null;
  phaseEndsIn: number | null;
  selectedFixtureName: string | null;
  selectedFixtureSlug: string | null;
  showing: boolean;
  status: string;
  swapSides: boolean;
  tournament: string | null;
  visibleUntil: string | null;
};

export type SnapshotMessage = {
  payload: {
    fixtures: FixtureSummary[];
    state: PublicState;
  };
  type: "snapshot";
};

export type ErrorMessage = {
  error: string;
  type: "error";
};

export type ServerMessage = SnapshotMessage | ErrorMessage;

export type ClientMessage =
  | { type: "refreshFixtures" }
  | { type: "refreshOdds" }
  | { slug: string; type: "selectFixture" }
  | { swap: boolean; type: "setSwapSides" }
  | { type: "toggleSwapSides" };
