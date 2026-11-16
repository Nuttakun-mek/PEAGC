import { describe, expect, it } from "vitest";

import { fetchAllRows } from "./fetch-all";

/** Fake table behind a server that returns at most `cap` rows per request, like PostgREST. */
function fakeTable(total: number, cap = 1000) {
  const rows = Array.from({ length: total }, (_, index) => ({ id: index }));
  const calls: Array<[number, number]> = [];
  const page = async (from: number, to: number) => {
    calls.push([from, to]);
    return { data: rows.slice(from, Math.min(to + 1, from + cap)), error: null };
  };
  return { calls, page, rows };
}

describe("fetchAllRows", () => {
  it("returns every row past the 1,000-row response cap", async () => {
    const table = fakeTable(2500);
    const result = await fetchAllRows(table.page);
    expect(result.error).toBeNull();
    expect(result.data).toEqual(table.rows);
    expect(table.calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("makes one request when everything fits in the first page", async () => {
    const table = fakeTable(7);
    expect((await fetchAllRows(table.page)).data).toHaveLength(7);
    expect(table.calls).toHaveLength(1);
  });

  it("asks once more after an exactly full page and stops on the empty one", async () => {
    const table = fakeTable(2000);
    expect((await fetchAllRows(table.page)).data).toHaveLength(2000);
    expect(table.calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("stops at maxRows", async () => {
    const table = fakeTable(5000);
    const result = await fetchAllRows(table.page, { maxRows: 1500 });
    expect(result.data).toHaveLength(1500);
    expect(table.calls).toEqual([[0, 999], [1000, 1499]]);
  });

  it("passes the error through instead of returning partial rows", async () => {
    let call = 0;
    const result = await fetchAllRows(async () => {
      call += 1;
      return call === 1
        ? { data: Array.from({ length: 1000 }, (_, id) => ({ id })), error: null }
        : { data: null, error: { code: "42501", details: "", hint: "", message: "permission denied" } as never };
    });
    expect(result.data).toBeNull();
    expect(result.error).toMatchObject({ message: "permission denied" });
  });
});
