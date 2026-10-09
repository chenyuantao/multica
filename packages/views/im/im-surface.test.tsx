// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithI18n } from "../test/i18n";
import { NavigationProvider, type NavigationAdapter } from "../navigation";

vi.mock("./im-page", () => ({
  ImPage: ({ view }: { view?: string }) => <div>surface-im:{view ?? "chats"}</div>,
}));
vi.mock("./knowledge-page", () => ({ KnowledgePage: () => <div>surface-knowledge</div> }));
vi.mock("./collect-page", () => ({ CollectPage: () => <div>surface-collect</div> }));
vi.mock("./reminder-page", () => ({ ReminderPage: () => <div>surface-reminder</div> }));
vi.mock("../modals/registry", () => ({ ModalRegistry: () => <div>modals</div> }));

import { ImSurface } from "./im-surface";

function renderAt(pathname: string) {
  const navigation: NavigationAdapter = {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    pathname,
    searchParams: new URLSearchParams(),
    hash: "",
    getShareableUrl: (path) => path,
  };
  return renderWithI18n(
    <NavigationProvider value={navigation}>
      <ImSurface />
    </NavigationProvider>,
  );
}

describe("ImSurface", () => {
  it("renders chats, contacts, notes, reminders, and favorites from the path", () => {
    const first = renderAt("/acme/im");
    expect(screen.getByText("surface-im:chats")).toBeInTheDocument();
    first.unmount();

    const contacts = renderAt("/acme/member");
    expect(screen.getByText("surface-im:contacts")).toBeInTheDocument();
    contacts.unmount();

    const notes = renderAt("/acme/knowledge");
    expect(screen.getByText("surface-knowledge")).toBeInTheDocument();
    notes.unmount();

    const reminder = renderAt("/acme/reminder");
    expect(screen.getByText("surface-reminder")).toBeInTheDocument();
    reminder.unmount();

    renderAt("/acme/collect");
    expect(screen.getByText("surface-collect")).toBeInTheDocument();
  });
});
