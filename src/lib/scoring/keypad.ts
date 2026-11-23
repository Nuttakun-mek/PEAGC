// State for the one-hand, hole-by-hole score keypad (used on phones in the scoring page).
// Pure reducer so the behaviour is testable without a browser.

import { HOLES } from "./engine";

export type KeypadValue = number | "X" | null;

export type KeypadState = {
  /** 0-17 */
  hole: number;
  /** "high" shows 10-15 after the 10+ key. */
  page: "low" | "high";
  values: KeypadValue[];
};

export type KeypadAction =
  | { type: "digit"; value: number }
  | { type: "pickup" }
  | { type: "clear" }
  | { type: "toggleHigh" }
  | { type: "goto"; hole: number }
  | { type: "prev" }
  | { type: "next" };

export const HIGH_VALUES = [10, 11, 12, 13, 14, 15];

/** Start state from what is already on the card; begins at the first empty hole from `startHole`. */
export function initialKeypadState(values: (string | number | null | undefined)[], startHole = 1): KeypadState {
  const parsed: KeypadValue[] = Array.from({ length: HOLES }, (_, i) => {
    const raw = values[i];
    if (raw === null || raw === undefined || raw === "") return null;
    if (typeof raw === "string" && raw.trim().toUpperCase() === "X") return "X";
    const number = Number(raw);
    return Number.isInteger(number) && number >= 1 && number <= 20 ? number : null;
  });
  const start = Math.min(HOLES, Math.max(1, Math.trunc(startHole))) - 1;
  // Play order from the starting hole (shotgun / 10th-tee starts wrap around).
  const order = Array.from({ length: HOLES }, (_, i) => (start + i) % HOLES);
  const firstEmpty = order.find((index) => parsed[index] === null);
  return { hole: firstEmpty ?? start, page: "low", values: parsed };
}

function advance(state: KeypadState, values: KeypadValue[]): KeypadState {
  return { hole: (state.hole + 1) % HOLES, page: "low", values };
}

function setCurrent(state: KeypadState, value: KeypadValue) {
  const values = [...state.values];
  values[state.hole] = value;
  return values;
}

export function keypadReducer(state: KeypadState, action: KeypadAction): KeypadState {
  switch (action.type) {
    case "digit": {
      const value = Math.trunc(action.value);
      const allowed = state.page === "high" ? HIGH_VALUES.includes(value) : value >= 1 && value <= 9;
      if (!allowed) return state;
      return advance(state, setCurrent(state, value));
    }
    case "pickup":
      return advance(state, setCurrent(state, "X"));
    case "clear":
      return { ...state, page: "low", values: setCurrent(state, null) };
    case "toggleHigh":
      return { ...state, page: state.page === "high" ? "low" : "high" };
    case "goto":
      return Number.isInteger(action.hole) && action.hole >= 0 && action.hole < HOLES ? { ...state, hole: action.hole, page: "low" } : state;
    case "prev":
      return { ...state, hole: (state.hole + HOLES - 1) % HOLES, page: "low" };
    case "next":
      return { ...state, hole: (state.hole + 1) % HOLES, page: "low" };
    default:
      return state;
  }
}

export type NineTotal = { filled: number; pickups: number; strokes: number };

/** Running OUT / IN / TOTAL: strokes so far and how many holes are filled. */
export function keypadTotals(values: KeypadValue[]) {
  const nine = (from: number): NineTotal =>
    values.slice(from, from + 9).reduce<NineTotal>(
      (total, value) => ({
        filled: total.filled + (value === null ? 0 : 1),
        pickups: total.pickups + (value === "X" ? 1 : 0),
        strokes: total.strokes + (typeof value === "number" ? value : 0),
      }),
      { filled: 0, pickups: 0, strokes: 0 },
    );
  const out = nine(0);
  const back = nine(9);
  return {
    in: back,
    out,
    total: { filled: out.filled + back.filled, pickups: out.pickups + back.pickups, strokes: out.strokes + back.strokes },
  };
}

/** Values for the h1..h18 form fields the score actions read. */
export function keypadFieldValues(values: KeypadValue[]) {
  return values.map((value) => (value === null ? "" : String(value)));
}
