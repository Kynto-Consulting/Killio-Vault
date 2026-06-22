// Widget asset sandbox — turn an HTML / JS / TS / TSX source into a self-contained
// HTML document that runs INSIDE a sandboxed iframe.
//
// Contract (per the user's design):
//   - html  → rendered verbatim.
//   - js/ts → the module's default export is a function `(args) => htmlString`.
//             We call it with `args` and inject the returned string.
//   - tsx/jsx → default export is `(args) => ReactElement` (or an html string);
//               React + ReactDOM are loaded so a returned element is rendered.
//
// SECURITY: the produced document is meant to be hosted in an iframe with
// `sandbox="allow-scripts"` and WITHOUT `allow-same-origin`, so the widget can
// run scripts but cannot read Killio's cookies, tokens, localStorage, or DOM.
// TS/TSX are transpiled by @babel/standalone loaded from a CDN *inside* the
// sandbox — no build step and no app-bundle weight. (Offline local workspaces
// therefore can run pure HTML widgets but need connectivity for TS/TSX/JSX.)

export type WidgetLang = "html" | "js" | "ts" | "jsx" | "tsx";

const EXT_LANG: Record<string, WidgetLang> = {
  html: "html", htm: "html",
  js: "js", mjs: "js", cjs: "js",
  ts: "ts",
  jsx: "jsx",
  tsx: "tsx",
};

/** Detect a widget language from an explicit value, a filename/url, or a mime. */
export function widgetLangFrom(
  explicit?: string | null,
  url?: string | null,
  mime?: string | null,
): WidgetLang | null {
  const e = (explicit || "").toLowerCase();
  if (e && EXT_LANG[e]) return EXT_LANG[e];
  if (e === "javascript") return "js";
  if (e === "typescript") return "ts";
  const m = /\.([a-z0-9]{1,4})(\?|#|$)/i.exec(url || "");
  if (m && EXT_LANG[m[1].toLowerCase()]) return EXT_LANG[m[1].toLowerCase()];
  if ((mime || "").toLowerCase() === "text/html") return "html";
  return null;
}

/** True when this brick should render as a code widget rather than plain media. */
export function isWidgetUrl(
  url?: string | null,
  mime?: string | null,
  mediaType?: string | null,
  kind?: string,
  hasInlineCode?: boolean,
): boolean {
  if (kind === "widget" || mediaType === "widget") return true;
  if (hasInlineCode) return true;
  // An uploaded source file (asset:/uploads), NOT an external http bookmark link.
  const isExternalLink = /^https?:\/\//i.test(url || "");
  if (isExternalLink) return false;
  return /\.(html?|jsx?|tsx?|mjs|cjs)(\?|#|$)/i.test(url || "");
}

const escapeForScript = (s: string) => JSON.stringify(s ?? "");

/**
 * Build the full HTML document to drop into an iframe's `srcdoc`.
 * Pure + deterministic (no Date/Math.random) so it's safe in any environment.
 */
export function buildWidgetSrcdoc(opts: {
  lang: WidgetLang;
  code: string;
  args?: Record<string, unknown> | null;
  /** background: "transparent" (default) or a CSS color for the widget canvas. */
  background?: string;
}): string {
  const { lang, code, args, background = "transparent" } = opts;

  // Pure HTML widgets need no toolchain — host the source directly.
  if (lang === "html") return code;

  const needsReact = lang === "tsx" || lang === "jsx";
  const presets = needsReact ? "['typescript','react']" : "['typescript']";
  const reactTags = needsReact
    ? `<script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>` +
      `<script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>`
    : "";

  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;padding:0;background:${background};font-family:system-ui,-apple-system,sans-serif;color:#111}
.k-werr{color:#b00020;background:#fff0f0;padding:12px;margin:0;white-space:pre-wrap;font:12px/1.5 ui-monospace,monospace}</style>
<script src="https://unpkg.com/@babel/standalone@7/babel.min.js"></script>
${reactTags}
</head><body><div id="root"></div>
<script>
(function(){
  var ARGS = ${escapeForScript(JSON.stringify(args ?? {}))};
  try { ARGS = JSON.parse(ARGS); } catch (e) { ARGS = {}; }
  var SRC = ${escapeForScript(code)};
  var root = document.getElementById('root');
  function fail(e){ document.body.innerHTML = '<pre class="k-werr">'+String((e&&e.stack)||e)+'</pre>'; }
  try {
    if (!window.Babel) { fail('Code widgets need a connection to load the compiler.'); return; }
    var compiled = window.Babel.transform(SRC, { presets: ${presets}, plugins: ['transform-modules-commonjs'], filename: 'widget.${lang}' }).code;
    var mod = { exports: {} };
    var run = new Function('module','exports','React','ReactDOM', compiled + '\\n;return (module.exports.default !== undefined ? module.exports.default : module.exports);');
    var widget = run(mod, mod.exports, window.React, window.ReactDOM);
    var out = (typeof widget === 'function') ? widget(ARGS) : widget;
    ${needsReact
      ? `if (out && typeof out === 'object' && out.$$typeof) { ReactDOM.createRoot(root).render(out); }
         else { root.innerHTML = (out == null ? '' : String(out)); }`
      : `root.innerHTML = (out == null ? '' : String(out));`}
  } catch (e) { fail(e); }
})();
</script></body></html>`;
}

/** Starter snippets shown when a new widget brick is created, per language. */
export function widgetStarter(lang: WidgetLang): string {
  switch (lang) {
    case "html":
      return `<div style="padding:24px;font:16px system-ui">\n  <h2>Hello from HTML</h2>\n  <p>Edit this widget.</p>\n</div>`;
    case "js":
      return `export default (args) => {\n  return \`<h2>Hello, \${args.name || "world"}</h2>\`;\n};`;
    case "ts":
      return `type Args = { name?: string };\nexport default (args: Args): string => {\n  return \`<h2>Hello, \${args.name ?? "world"}</h2>\`;\n};`;
    case "jsx":
    case "tsx":
      return `export default (args${lang === "tsx" ? ": { name?: string }" : ""}) => {\n  return <h2 style={{ padding: 24, fontFamily: "system-ui" }}>Hello, {args.name || "world"}</h2>;\n};`;
  }
}
