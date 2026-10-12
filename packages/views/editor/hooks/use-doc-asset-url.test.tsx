import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { __resetDocAssetUrlCacheForTests, useDocAssetObjectUrl } from "./use-doc-asset-url";

const getDocAsset = vi.hoisted(() => vi.fn());

vi.mock("@multica/core/docs", () => ({
  docAssetOptions: (path: string) => ({
    queryKey: ["docs", "asset", path],
    queryFn: () => getDocAsset(path),
    staleTime: Infinity,
    retry: false,
  }),
}));

function View({ path }: { path: string | null }) {
  const asset = useDocAssetObjectUrl(path);
  return <img alt="图" src={asset.url || undefined} data-pending={String(asset.pending)} />;
}

function renderView(path: string | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <View path={path} />
    </QueryClientProvider>,
  );
}

describe("useDocAssetObjectUrl", () => {
  afterEach(() => {
    getDocAsset.mockReset();
    __resetDocAssetUrlCacheForTests();
  });

  it("puts the asset address on the img once the file bytes arrive", async () => {
    getDocAsset.mockResolvedValue({
      path: "mbp/Images/图03.jpg",
      name: "图03.jpg",
      content_type: "image/jpeg",
      data: "aGVsbG8=\n",
    });
    renderView("mbp/Images/图03.jpg");
    await waitFor(() => expect(screen.getByRole("img")).toHaveAttribute("src"));
    expect(screen.getByRole("img").getAttribute("src")).toMatch(/^blob:/);
    expect(screen.getByRole("img")).toHaveAttribute("data-pending", "false");
  });

  it("uses an attachment address in the asset payload as the img src", async () => {
    const address = "https://cdn.example.test/api/attachments/att-1/download";
    getDocAsset.mockResolvedValue({
      path: "mbp/Images/图03.jpg",
      name: "图03.jpg",
      content_type: "image/jpeg",
      data: address,
    });
    renderView("mbp/Images/图03.jpg");
    await waitFor(() => expect(screen.getByRole("img")).toHaveAttribute("src", address));
  });

  it("leaves a normal image alone", () => {
    renderView(null);
    expect(getDocAsset).not.toHaveBeenCalled();
    expect(screen.getByRole("img")).not.toHaveAttribute("src");
  });
});
