import { describe, expect, it, vi, afterEach } from "vitest";
import { commitWebNavigation, hrefParts } from "./im-surface-nav";

describe("hrefParts", () => {
  it("splits pathname and query", () => {
    expect(hrefParts("/acme/im?chat=c1#x")).toEqual({ pathname: "/acme/im", search: "chat=c1" });
    expect(hrefParts("/acme/knowledge")).toEqual({ pathname: "/acme/knowledge", search: "" });
  });
});

describe("commitWebNavigation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes history between IM tabs and skips the App Router", () => {
    const router = { push: vi.fn(), replace: vi.fn() };
    const onLocal = vi.fn();
    const pushState = vi.spyOn(window.history, "pushState");

    commitWebNavigation("/acme/knowledge", "/acme/im", router, "push", onLocal);

    expect(router.push).not.toHaveBeenCalled();
    expect(pushState).toHaveBeenCalledWith(null, "", "/acme/knowledge");
    expect(onLocal).toHaveBeenCalledWith({ pathname: "/acme/knowledge", search: "" });
  });

  it("replaces a query on the same IM tab locally", () => {
    const router = { push: vi.fn(), replace: vi.fn() };
    const onLocal = vi.fn();
    const replaceState = vi.spyOn(window.history, "replaceState");

    commitWebNavigation("/acme/im?chat=c1", "/acme/im", router, "replace", onLocal);

    expect(router.replace).not.toHaveBeenCalled();
    expect(replaceState).toHaveBeenCalledWith(null, "", "/acme/im?chat=c1");
    expect(onLocal).toHaveBeenCalledWith({ pathname: "/acme/im", search: "chat=c1" });
  });

  it("asks Next when leaving the IM surface", () => {
    const router = { push: vi.fn(), replace: vi.fn() };
    const onLocal = vi.fn();
    const pushState = vi.spyOn(window.history, "pushState");

    commitWebNavigation("/acme/settings", "/acme/im", router, "push", onLocal);

    expect(router.push).toHaveBeenCalledWith("/acme/settings");
    expect(pushState).not.toHaveBeenCalled();
    expect(onLocal).not.toHaveBeenCalled();
  });
});
