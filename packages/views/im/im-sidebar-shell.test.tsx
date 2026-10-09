import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Sidebar, SidebarProvider } from "@multica/ui/components/ui/sidebar";
import { renderWithI18n } from "../test/i18n";
import { ImSidebarHeader, ImSidebarShell } from "./im-sidebar-shell";

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

  it("keeps a phone header action on the left and the title centered", () => {
    const previous = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    renderWithI18n(
      <ImSidebarHeader title="Chats" leading={<a href="/acme/reminder">Reminders</a>}>
        <button type="button">New chat</button>
      </ImSidebarHeader>,
    );
    const title = screen.getByRole("heading", { name: "Chats" });
    const entry = screen.getByRole("link", { name: "Reminders" });
    expect(title.compareDocumentPosition(entry) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    expect(title.parentElement?.className).toContain("grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]");
    Object.defineProperty(window, "innerWidth", { configurable: true, value: previous });
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
