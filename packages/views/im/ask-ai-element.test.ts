// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { describeElement, elementLabel } from "./ask-ai-element";

const here = { pathname: "/acme/knowledge", searchParams: new URLSearchParams("file=a.md&view=read") };

function mount(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body;
}

describe("describeElement", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("locates the node from its nearest id and carries the page path and params", () => {
    mount(`<main id="app"><div data-slot="card"><p>one</p><p class="x" data-k="v">two</p></div></main>`);
    const el = document.querySelectorAll("p")[1]!;
    const e = describeElement(el, here);
    expect(e).toMatchObject({
      path: "/acme/knowledge",
      params: { file: "a.md", view: "read" },
      tag: "p",
      selector: 'main#app > div[data-slot="card"] > p:nth-of-type(2)',
      attributes: { class: "x", "data-k": "v" },
      html: '<p class="x" data-k="v">two</p>',
      text: "two",
      images: [],
      truncated: false,
    });
    expect(document.querySelector(e.selector)).toBe(el);
  });

  it("keeps remote images and only the alt text of device-local ones", () => {
    mount(
      `<figure><img src="https://cdn.test/a.png" alt="chart"><img src="data:image/png;base64,AAAA" alt="inline"><img src="blob:x"></figure>`,
    );
    expect(describeElement(document.querySelector("figure")!, here).images).toEqual([
      { src: "https://cdn.test/a.png", alt: "chart" },
      { src: "", alt: "inline" },
    ]);
    expect(describeElement(document.querySelector("img")!, here).images).toEqual([{ src: "https://cdn.test/a.png", alt: "chart" }]);
  });

  it("cuts long markup and text and says so", () => {
    mount(`<div>${"字".repeat(9000)}</div>`);
    const e = describeElement(document.querySelector("div")!, here);
    expect(Array.from(e.text)).toHaveLength(8000);
    expect(Array.from(e.html)).toHaveLength(8000);
    expect(e.truncated).toBe(true);
  });
});

describe("elementLabel", () => {
  it("names the node by its text, then image alt, then aria-label, then selector", () => {
    const base = describeElement(mount(""), here);
    expect(elementLabel({ ...base, tag: "button", text: "  Deploy\n now " })).toBe("<button> Deploy now");
    expect(elementLabel({ ...base, tag: "img", text: "", images: [{ src: "", alt: "logo" }] })).toBe("<img> logo");
    expect(elementLabel({ ...base, tag: "svg", text: "", attributes: { "aria-label": "Close" } })).toBe("<svg> Close");
    expect(elementLabel({ ...base, text: "", attributes: {}, selector: "body > div" })).toBe("body > div");
  });
});
