import { describe, expect, it } from "vitest";
import { clipboardHtml, renderMarkdownSafe } from "../src/lib/markdown";

describe("renderMarkdownSafe", () => {
  it("renders ordinary markdown", () => {
    const html = renderMarkdownSafe("# Title\n\n- **a**\n- [site](https://example.com)");
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<strong>a</strong>");
    expect(html).toContain('<a href="https://example.com">site</a>');
  });

  it("escapes raw HTML blocks and inline tags", () => {
    const html = renderMarkdownSafe('<script>alert(1)</script>\n\nhi <img src=x onerror="alert(1)"> there');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).toContain("&lt;script&gt;");
  });

  it("drops unsafe link targets and all images", () => {
    const html = renderMarkdownSafe("[x](javascript:alert(1)) ![pic](https://tracker.example/a.png)");
    expect(html).not.toContain("javascript:");
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toContain("tracker.example");
    expect(html).toContain("x");
    expect(html).toContain("pic");
  });
});

describe("clipboardHtml", () => {
  it("wraps Persian text in an RTL block", () => {
    const html = clipboardHtml("## خلاصه\n- API **endpoint** جدید");
    expect(html.startsWith('<div dir="rtl" style="direction:rtl;text-align:right">')).toBe(true);
    expect(html).toContain("<strong>endpoint</strong>");
  });

  it("leaves English text left-to-right", () => {
    expect(clipboardHtml("# Notes\n\nخلاصه later").startsWith('<div dir="ltr">')).toBe(true);
  });
});
