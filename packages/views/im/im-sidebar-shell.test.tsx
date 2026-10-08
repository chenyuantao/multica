import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Sidebar, SidebarProvider } from "@multica/ui/components/ui/sidebar";
import { renderWithI18n } from "../test/i18n";
import { ImSidebarHeader, ImSidebarShell } from "./im-sidebar-shell";

function box(width: number, left: number): DOMRect {
  return {
    x: left,
    y: 0,
    width,
    height: 800,
    top: 0,
    bottom: 800,
    left,
    right: left + width,
    toJSON: () => ({}),
  };
}

describe("ImSidebarShell", () => {
  afterEach(() => localStorage.clear());

  it("shares one width across every section list and the dashboard nav", () => {
    localStorage.setItem("sidebar_width", "300");
    const { container } = renderWithI18n(
      <>
        <ImSidebarShell>chats</ImSidebarShell>
        <ImSidebarShell>knowledge</ImSidebarShell>
        <SidebarProvider>
          <Sidebar />
        </SidebarProvider>
      </>,
    );
    const [chats, knowledge] = screen.getAllByRole("complementary");
    const wrapper = container.querySelector<HTMLElement>("[data-slot='sidebar-wrapper']")!;
    expect(chats).toHaveStyle({ width: "300px" });

    fireEvent.keyDown(screen.getAllByRole("separator")[0]!, { key: "ArrowRight" });
    expect(chats).toHaveStyle({ width: "316px" });
    expect(knowledge).toHaveStyle({ width: "316px" });
    expect(wrapper.style.getPropertyValue("--sidebar-width")).toBe("316px");
    expect(localStorage.getItem("sidebar_width")).toBe("316");
  });

  it("keeps the list between 3:7 and 7:3 of the row beside the rail", () => {
    localStorage.setItem("sidebar_width", "100");
    const rects = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.dataset.testid === "row") return box(1060, 0);
      if (this.tagName === "ASIDE") return box(256, 60);
      return box(0, 0);
    });
    renderWithI18n(
      <div data-testid="row">
        <ImSidebarShell>chats</ImSidebarShell>
      </div>,
    );
    const list = screen.getByRole("complementary");
    expect(list).toHaveStyle({ width: "300px" });
    expect(localStorage.getItem("sidebar_width")).toBe("100");

    fireEvent.keyDown(screen.getByRole("separator"), { key: "End" });
    expect(list).toHaveStyle({ width: "700px" });
    expect(localStorage.getItem("sidebar_width")).toBe("700");
    fireEvent.keyDown(screen.getByRole("separator"), { key: "Home" });
    expect(list).toHaveStyle({ width: "300px" });

    rects.mockRestore();
  });

  it("centers one Search label on a phone and opens the search page", () => {
    const previous = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    const onOpenSearch = vi.fn();
    renderWithI18n(
      <ImSidebarHeader title="Contacts" onOpenSearch={onOpenSearch} />,
    );
    const button = screen.getByRole("button", { name: "Search" });
    expect(button.className).toContain("justify-center");
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(button);
    expect(onOpenSearch).toHaveBeenCalledOnce();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: previous });
  });
});
