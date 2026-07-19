import { env } from "../config.js";

export interface MatchSnapshot {
  txlineMatchId: string;
  homeTeam: string;
  awayTeam: string;
  phase: string; // TxLINE statusSoccerId values: NS | H1 | HT | H2 | ET1 | ET2 | P | PE | F | FET | FPE | END | ...
  clockSeconds: number;
  status: string;
}

interface TrackedState {
  half: 1 | 2 | null;
  inBreak: boolean;
  breakStartedAtClockSeconds: number | null;
  lastEventId: string | null;
  // Clock value (the SAME continuous, never-resetting match clock used in
  // MatchSnapshot.clockSeconds) observed at the moment this half began.
  // Needed because clockSeconds does NOT reset to 0 at the start of the
  // second half — it just keeps counting up from wherever H1 stoppage
  // time left off. Without this baseline, "minutes into the half" for H2
  // would be computed from the raw total match clock (e.g. ~47 minutes
  // right at H2 kickoff), which would already be past
  // BREAK_MINUTE_THRESHOLD and fire breakStarted immediately at kickoff
  // instead of near an actual mid-half stoppage.
  halfStartClockSeconds: number | null;
}

export const trackedMatches = new Map<string, TrackedState>();

const STOPPAGE_EVENT_TYPES = new Set([
  "foul",
  "offside",
  "throw_in",
  "goal_kick",
  "corner",
  "free_kick",
  "injury",
  "var_check",
  "substitution",
]);

export interface DetectResult {
  breakStarted: boolean;
  breakEnded: boolean;
  half: 1 | 2 | null;
}

const FALLBACK_GRACE_MINUTES = 5;

export function detectBreak(snapshot: MatchSnapshot, events: any[]): DetectResult {
  const half = phaseToHalf(snapshot.phase);
  const state = trackedMatches.get(snapshot.txlineMatchId) ?? {
    half: null,
    inBreak: false,
    breakStartedAtClockSeconds: null,
    lastEventId: null,
    halfStartClockSeconds: null,
  };

  const result: DetectResult = { breakStarted: false, breakEnded: false, half };

  if (half === null) {
    trackedMatches.set(snapshot.txlineMatchId, state);
    return result;
  }

  if (state.half !== half) {
    state.half = half;
    state.inBreak = false;
    state.breakStartedAtClockSeconds = null;
    // Baseline this half's "elapsed" measurement off the clock value we're
    // seeing right now, since clockSeconds is a continuous match-total
    // clock, not a per-half clock that resets to 0.
    state.halfStartClockSeconds = snapshot.clockSeconds;
  }

  const halfStartClockSeconds = state.halfStartClockSeconds ?? 0;
  const minutesIntoHalf = (snapshot.clockSeconds - halfStartClockSeconds) / 60;
  const newEvents = latestUnseenEvents(events, state.lastEventId);
  if (newEvents.length > 0) {
    state.lastEventId = String(newEvents[newEvents.length - 1].id ?? state.lastEventId);
  }

  if (!state.inBreak) {
    if (minutesIntoHalf >= env.BREAK_MINUTE_THRESHOLD) {
      const stoppage = newEvents.find((e) => STOPPAGE_EVENT_TYPES.has(String(e.action)));
      const fallbackDue = minutesIntoHalf >= env.BREAK_MINUTE_THRESHOLD + FALLBACK_GRACE_MINUTES;
      if (stoppage || fallbackDue) {
        state.inBreak = true;
        state.breakStartedAtClockSeconds = snapshot.clockSeconds;
        result.breakStarted = true;
      }
    }
  } else {
    const maxBreakSeconds = 3 * 60 + 30;
    const elapsed = snapshot.clockSeconds - (state.breakStartedAtClockSeconds ?? snapshot.clockSeconds);
    const resumed = newEvents.some((e) => String(e.action) === "kickoff" || String(e.action) === "restart");

    if (resumed || elapsed >= maxBreakSeconds) {
      state.inBreak = false;
      state.breakStartedAtClockSeconds = null;
      result.breakEnded = true;
    }
  }

  trackedMatches.set(snapshot.txlineMatchId, state);
  return result;
}

function phaseToHalf(phase: string): 1 | 2 | null {
  if (phase === "H1") return 1;
  if (phase === "H2") return 2;
  return null;
}

function latestUnseenEvents(events: any[], lastSeenId: string | null): any[] {
  if (!lastSeenId) return events;
  const idx = events.findIndex((e) => String(e.id) === lastSeenId);
  return idx === -1 ? events : events.slice(idx + 1);
}