import { describe, expect, it } from "vitest";
import { clipboardHtml, renderMarkdownSafe } from "../src/lib/markdown";

describe("renderMarkdownSafe", () => {
  it("renders ordinary markdown", () => {
    const html = renderMarkdownSafe("# Title\n\n- **a**\n- [site](https://example.com)");
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<strong>a</strong>");
    expect(html).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">site</a>');
  });

  it("opens every link in a new tab without an opener", () => {
    const html = renderMarkdownSafe('[a](https://a.example "T") and [m](mailto:x@y.z) and <https://auto.example>');
    const anchors = html.match(/<a [^>]*>/g) ?? [];
    expect(anchors).toHaveLength(3);
    for (const a of anchors) {
      expect(a).toContain('target="_blank"');
      expect(a).toContain('rel="noopener noreferrer"');
    }
    expect(html).toContain('title="T"');
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

describe("renderMarkdownSafe raw-block bypass", () => {
  const payloads = [
    "Notes <pre><img/src=http&#58;//evil.example/x.png>",
    "a <kbd><input/name=p>",
    "<pre>\n<img/src=x onerror=alert(1)>\n</pre>",
    "x <code><img/src=y>",
  ];
  for (const p of payloads) {
    it(`emits no live tags for ${JSON.stringify(p)}`, () => {
      for (const html of [renderMarkdownSafe(p), clipboardHtml(p)]) {
        expect(html).not.toMatch(/<img/i);
        expect(html).not.toMatch(/<input/i);
        expect(html).not.toMatch(/<pre/i);
        expect(html).not.toMatch(/<kbd/i);
      }
    });
  }

  it("still renders inline code and bold", () => {
    const html = renderMarkdownSafe("use `a<b>` and **bold** <b>raw</b>");
    expect(html).toContain("<code>a&lt;b&gt;</code>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).not.toContain("<b>");
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
