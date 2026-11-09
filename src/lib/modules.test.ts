import { describe, expect, it } from "vitest";

import { defaultModuleState, modulesForPath, resolveModules } from "./modules";

describe("modules", () => {
  it("launches with only lessons open", () => {
    expect(defaultModuleState).toEqual({ events: false, lessons: true, news: false, scores: false });
  });

  it("applies stored switches over defaults and ignores unknown keys", () => {
    expect(
      resolveModules([
        { enabled: true, module_key: "events" },
        { enabled: false, module_key: "lessons" },
        { enabled: true, module_key: "legacy" },
      ]),
    ).toEqual({ events: true, lessons: false, news: false, scores: false });
    expect(resolveModules(null)).toEqual(defaultModuleState);
  });

  it("maps admin pages to modules", () => {
    expect(modulesForPath("/admin/payments")).toEqual(["events"]);
    expect(modulesForPath("/admin/content")).toEqual(["scores", "news"]);
    expect(modulesForPath("/admin/members")).toEqual([]);
  });
});
