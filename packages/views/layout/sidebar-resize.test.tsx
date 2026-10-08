import { fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  Sidebar,
  SidebarProvider,
  SidebarRail,
  useSidebar,
} from "@multica/ui/components/ui/sidebar";
import { sidebarSplitWidth } from "@multica/ui/hooks/use-sidebar-width";
import { renderWithI18n } from "../test/i18n";

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

describe("left sidebar resizing", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-sidebar-resizing");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("previews width directly and commits only when the pointer is released", () => {
    const stableConsumerRender = vi.fn();

    function StableSidebarConsumer() {
      useSidebar();
      stableConsumerRender();
      return null;
    }

    const { container } = renderWithI18n(
      <SidebarProvider>
        <Sidebar>
          <StableSidebarConsumer />
          <SidebarRail />
        </Sidebar>
        <div data-sidebar-resize-consumer />
      </SidebarProvider>,
    );

    const wrapper = container.querySelector<HTMLElement>("[data-slot='sidebar-wrapper']")!;
    const sidebarContainer = container.querySelector<HTMLElement>("[data-slot='sidebar-container']")!;
    const sidebarGap = container.querySelector<HTMLElement>("[data-slot='sidebar-gap']")!;
    const sidebar = container.querySelector<HTMLElement>("[data-slot='sidebar']")!;
    const liveWidthConsumer = container.querySelector<HTMLElement>(
      "[data-sidebar-resize-consumer]",
    )!;
    const rail = container.querySelector<HTMLButtonElement>("[data-slot='sidebar-rail']")!;
    const setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();
    rail.setPointerCapture = setPointerCapture;
    rail.hasPointerCapture = vi.fn(() => true);
    rail.releasePointerCapture = releasePointerCapture;

    vi.spyOn(sidebarContainer, "getBoundingClientRect").mockReturnValue({
      bottom: 0,
      height: 0,
      left: 0,
      right: 256,
      top: 0,
      width: 256,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(rail, {
      button: 0,
      clientX: 256,
      isPrimary: true,
      pointerId: 7,
    });

    expect(setPointerCapture).toHaveBeenCalledWith(7);
    expect(rail).toHaveClass("cursor-ew-resize");
    expect(wrapper).toHaveAttribute("data-sidebar-resizing", "true");
    expect(document.documentElement).toHaveAttribute("data-sidebar-resizing", "true");

    fireEvent.pointerMove(document, { buttons: 1, clientX: 280, pointerId: 7 });
    fireEvent.pointerMove(document, { buttons: 1, clientX: 300, pointerId: 7 });

    expect(sidebarGap.style.width).toBe("300px");
    expect(sidebarContainer.style.width).toBe("300px");
    expect(
      liveWidthConsumer.style.getPropertyValue("--sidebar-live-width"),
    ).toBe("300px");
    expect(wrapper.style.getPropertyValue("--sidebar-width")).toBe("256px");
    expect(localStorage.getItem("sidebar_width")).toBeNull();
    expect(stableConsumerRender).toHaveBeenCalledTimes(1);

    fireEvent.pointerUp(document, { pointerId: 7 });

    expect(sidebarGap.style.width).toBe("");
    expect(sidebarContainer.style.width).toBe("");
    expect(
      liveWidthConsumer.style.getPropertyValue("--sidebar-live-width"),
    ).toBe("");
    expect(wrapper.style.getPropertyValue("--sidebar-width")).toBe("300px");
    expect(localStorage.getItem("sidebar_width")).toBe("300");
    expect(releasePointerCapture).toHaveBeenCalledWith(7);
    expect(wrapper).not.toHaveAttribute("data-sidebar-resizing");
    expect(document.documentElement).not.toHaveAttribute("data-sidebar-resizing");
    expect(stableConsumerRender).toHaveBeenCalledTimes(1);

    fireEvent.click(rail);
    expect(sidebar).toHaveAttribute("data-state", "expanded");
  });

  it("stops a drag at 3:7 and 7:3 of the shell, ignoring a leading rail", () => {
    localStorage.setItem("sidebar_width", "900");
    let containerWidth = 256;
    const rects = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.dataset.slot === "sidebar-wrapper") return box(1060, 0);
      if (this.dataset.slot === "sidebar-gap") return box(containerWidth, 60);
      if (this.dataset.slot === "sidebar-container") return box(containerWidth, 60);
      return box(0, 0);
    });

    const { container } = renderWithI18n(
      <SidebarProvider>
        <Sidebar>
          <SidebarRail />
        </Sidebar>
      </SidebarProvider>,
    );
    const wrapper = container.querySelector<HTMLElement>("[data-slot='sidebar-wrapper']")!;
    const sidebarGap = container.querySelector<HTMLElement>("[data-slot='sidebar-gap']")!;
    const rail = container.querySelector<HTMLButtonElement>("[data-slot='sidebar-rail']")!;
    rail.setPointerCapture = vi.fn();
    rail.hasPointerCapture = vi.fn(() => true);
    rail.releasePointerCapture = vi.fn();

    expect(sidebarSplitWidth(sidebarGap, wrapper)).toBe(1000);
    expect(wrapper.style.getPropertyValue("--sidebar-width")).toBe("700px");
    expect(localStorage.getItem("sidebar_width")).toBe("900");

    fireEvent.pointerDown(rail, { button: 0, clientX: 256, isPrimary: true, pointerId: 9 });
    fireEvent.pointerMove(document, { buttons: 1, clientX: 2000, pointerId: 9 });
    expect(sidebarGap.style.width).toBe("700px");
    fireEvent.pointerUp(document, { pointerId: 9 });
    expect(wrapper.style.getPropertyValue("--sidebar-width")).toBe("700px");
    expect(localStorage.getItem("sidebar_width")).toBe("700");

    containerWidth = 700;
    fireEvent.pointerDown(rail, { button: 0, clientX: 700, isPrimary: true, pointerId: 10 });
    fireEvent.pointerMove(document, { buttons: 1, clientX: -400, pointerId: 10 });
    expect(sidebarGap.style.width).toBe("300px");
    fireEvent.pointerUp(document, { pointerId: 10 });
    expect(localStorage.getItem("sidebar_width")).toBe("300");

    rects.mockRestore();
  });

  it("restores the committed width and cursor state when pointer capture is cancelled", () => {
    const { container } = renderWithI18n(
      <SidebarProvider>
        <Sidebar>
          <SidebarRail />
        </Sidebar>
        <div data-sidebar-resize-consumer />
      </SidebarProvider>,
    );

    const wrapper = container.querySelector<HTMLElement>("[data-slot='sidebar-wrapper']")!;
    const sidebarContainer = container.querySelector<HTMLElement>("[data-slot='sidebar-container']")!;
    const sidebarGap = container.querySelector<HTMLElement>("[data-slot='sidebar-gap']")!;
    const liveWidthConsumer = container.querySelector<HTMLElement>(
      "[data-sidebar-resize-consumer]",
    )!;
    const rail = container.querySelector<HTMLButtonElement>("[data-slot='sidebar-rail']")!;
    rail.setPointerCapture = vi.fn();
    rail.hasPointerCapture = vi.fn(() => true);
    rail.releasePointerCapture = vi.fn();

    vi.spyOn(sidebarContainer, "getBoundingClientRect").mockReturnValue({
      bottom: 0,
      height: 0,
      left: 0,
      right: 256,
      top: 0,
      width: 256,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(rail, {
      button: 0,
      clientX: 256,
      isPrimary: true,
      pointerId: 8,
    });
    fireEvent.pointerMove(document, { buttons: 1, clientX: 320, pointerId: 8 });
    expect(
      liveWidthConsumer.style.getPropertyValue("--sidebar-live-width"),
    ).toBe("320px");
    fireEvent.pointerCancel(document, { pointerId: 8 });

    expect(sidebarGap.style.width).toBe("");
    expect(sidebarContainer.style.width).toBe("");
    expect(
      liveWidthConsumer.style.getPropertyValue("--sidebar-live-width"),
    ).toBe("");
    expect(wrapper.style.getPropertyValue("--sidebar-width")).toBe("256px");
    expect(localStorage.getItem("sidebar_width")).toBeNull();
    expect(wrapper).not.toHaveAttribute("data-sidebar-resizing");
    expect(document.documentElement).not.toHaveAttribute("data-sidebar-resizing");
  });
});
