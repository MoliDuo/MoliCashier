import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import RootLayout, { metadata } from "@/app/layout";
import { metadataCopy } from "@/copy/app";
import { commonCopy } from "@/copy/common";

describe("root layout", () => {
  it("renders the document in Chinese", () => {
    const layout = RootLayout({ children: <div>Child page</div> });

    expect(layout).toMatchObject({ type: "html", props: { lang: "zh-CN" } });
  });

  it("offers a skip link to the main content", () => {
    const markup = renderToStaticMarkup(
      RootLayout({ children: <div>Child page</div> }) as React.ReactElement
    );

    expect(markup).toContain(`href="#main-content"`);
    expect(markup).toContain(commonCopy.skipToContent);
    expect(markup).toContain("Child page");
  });

  it("takes its title and description from the metadata copy", () => {
    expect(metadata).toMatchObject({
      title: metadataCopy.title,
      description: metadataCopy.description,
    });
  });
});
