import { describe, expect, it } from "vitest";

import { initialKeypadState, keypadFieldValues, keypadReducer, keypadTotals } from "./keypad";

describe("score keypad", () => {
  it("starts at the first empty hole from the starting tee", () => {
    expect(initialKeypadState([]).hole).toBe(0);
    expect(initialKeypadState(["5", "4"]).hole).toBe(2);
    // 10th-tee start: holes 10.. first
    expect(initialKeypadState([], 10).hole).toBe(9);
    expect(initialKeypadState(["5", "X", "", "4"]).values.slice(0, 4)).toEqual([5, "X", null, 4]);
  });

  it("a digit fills the hole and moves on; wraps after 18", () => {
    let state = initialKeypadState([]);
    state = keypadReducer(state, { type: "digit", value: 5 });
    expect(state.values[0]).toBe(5);
    expect(state.hole).toBe(1);
    state = keypadReducer({ ...state, hole: 17 }, { type: "digit", value: 4 });
    expect(state.hole).toBe(0);
  });

  it("10+ opens 10-15; low digits are ignored there and 10+ closes after one value", () => {
    let state = keypadReducer(initialKeypadState([]), { type: "toggleHigh" });
    expect(state.page).toBe("high");
    expect(keypadReducer(state, { type: "digit", value: 5 })).toBe(state);
    state = keypadReducer(state, { type: "digit", value: 12 });
    expect(state.values[0]).toBe(12);
    expect(state.page).toBe("low");
    expect(keypadReducer(state, { type: "digit", value: 12 })).toBe(state);
  });

  it("pickup, clear and navigation", () => {
    let state = keypadReducer(initialKeypadState([]), { type: "pickup" });
    expect(state.values[0]).toBe("X");
    state = keypadReducer(state, { type: "prev" });
    expect(state.hole).toBe(0);
    state = keypadReducer(state, { type: "clear" });
    expect(state.values[0]).toBeNull();
    expect(state.hole).toBe(0);
    expect(keypadReducer(state, { type: "goto", hole: 12 }).hole).toBe(12);
    expect(keypadReducer(state, { type: "goto", hole: 18 })).toBe(state);
    expect(keypadReducer(state, { type: "prev" }).hole).toBe(17);
  });

  it("running OUT / IN / TOTAL and form values", () => {
    const values = initialKeypadState(["5", "4", "X", "", "", "", "", "", "", "6"]).values;
    const totals = keypadTotals(values);
    expect(totals.out).toEqual({ filled: 3, pickups: 1, strokes: 9 });
    expect(totals.in).toEqual({ filled: 1, pickups: 0, strokes: 6 });
    expect(totals.total.strokes).toBe(15);
    expect(keypadFieldValues(values).slice(0, 4)).toEqual(["5", "4", "X", ""]);
  });
});
