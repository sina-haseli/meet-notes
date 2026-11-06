// Markdown -> HTML for the summary preview and the clipboard's text/html part. The Markdown comes
// from an LLM, so raw HTML is escaped, links keep only safe targets (and open in a new tab) and images become their alt
// text (a remote image would be fetched, sending a request to a third party).
import { Marked, type Tokens } from "marked";

const SAFE_HREF = /^(https?:|mailto:|#)/i;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const md = new Marked({ gfm: true, breaks: false, async: false });
md.use({
  // HTML is never tokenized, so `<` is always plain (escaped) text. Escaping only in the renderer
  // is not enough: an inline <pre>/<code>/<kbd> puts the lexer in raw-block mode and later tags
  // that its tag regex misses (e.g. `<img/src=…>`) would pass through unescaped.
  tokenizer: {
    html() {
      return undefined;
    },
    tag() {
      return undefined;
    },
  },
  renderer: {
    html(token: Tokens.HTML | Tokens.Tag): string {
      return escapeHtml(token.text);
    },
    link(token: Tokens.Link): string {
      const text = this.parser.parseInline(token.tokens);
      if (!SAFE_HREF.test(token.href.trim())) return text;
      let href: string;
      try {
        href = encodeURI(token.href).replace(/%25/g, "%"); // as marked's own cleanUrl
      } catch {
        return text;
      }
      const title = token.title ? ` title="${escapeHtml(token.title)}"` : "";
      // The page is an extension page: a link must never navigate it away or get window.opener.
      return `<a href="${escapeHtml(href)}"${title} target="_blank" rel="noopener noreferrer">${text}</a>`;
    },
    image(token: Tokens.Image): string {
      return escapeHtml(token.text);
    },
  },
});

export function renderMarkdownSafe(src: string): string {
  return md.parse(src) as string;
}

/** Direction of the first strong letter (Markdown punctuation and digits are skipped). */
function isRtl(text: string): boolean {
  const first = text.match(/\p{L}/u)?.[0];
  return first !== undefined && /[\p{Script=Arabic}\p{Script=Hebrew}]/u.test(first);
}

/** The text/html clipboard part: the sanitized HTML, in an RTL block for Persian text. */
export function clipboardHtml(src: string): string {
  const body = renderMarkdownSafe(src);
  return isRtl(src)
    ? `<div dir="rtl" style="direction:rtl;text-align:right">${body}</div>`
    : `<div dir="ltr">${body}</div>`;
}
