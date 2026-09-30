import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Sidebar, SidebarProvider } from "@multica/ui/components/ui/sidebar";
import { renderWithI18n } from "../test/i18n";
import { ImSidebarShell } from "./im-sidebar-shell";

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
});
