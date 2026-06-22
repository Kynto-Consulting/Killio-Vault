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
// Inlined into the sandbox: resolves `asset:<name>` refs to data: URIs from the
// embedded map, AFTER the widget renders (so args are evaluated and dynamically
// built markup is covered too), then keeps watching the DOM for new nodes.
const ASSET_RUNTIME = `
(function(){
  var MAP = window.__KA__ || {};
  function base(v){ return String(v).replace(/^asset:/i,'').split(/[\\\\/]/).pop(); }
  function res(v){ if(!v) return v; var i=v.indexOf('asset:'); if(i<0) return v;
    return v.replace(/asset:[A-Za-z0-9_\\-.\\/]+/g, function(m){ var d=MAP[base(m)]; return d||m; }); }
  window.kasset = function(n){ return MAP[base(n)] || n; };
  function sweep(rootEl){
    if(!rootEl||!rootEl.querySelectorAll) return;
    var els = rootEl.querySelectorAll('[src],[href],[poster],[style]');
    for(var i=0;i<els.length;i++){ var el=els[i];
      ['src','href','poster'].forEach(function(a){ var v=el.getAttribute&&el.getAttribute(a);
        if(v&&v.indexOf('asset:')===0){ var d=MAP[base(v)]; if(d) el.setAttribute(a,d); } });
      var st=el.getAttribute&&el.getAttribute('style'); if(st&&st.indexOf('asset:')>-1) el.setAttribute('style',res(st));
    }
  }
  window.__ksweep__ = sweep;
  function go(){ sweep(document.body);
    try{ new MutationObserver(function(ms){ for(var i=0;i<ms.length;i++){ var an=ms[i].addedNodes; for(var j=0;j<an.length;j++) sweep(an[j]); if(ms[i].type==='attributes') sweep(ms[i].target); } })
      .observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['src','href','poster','style']}); }catch(e){}
  }
  if(document.body) go(); else document.addEventListener('DOMContentLoaded', go);
})();`;

export function buildWidgetSrcdoc(opts: {
  lang: WidgetLang;
  code: string;
  args?: Record<string, unknown> | null;
  /** name → data: URI map for local-workspace assets referenced by the widget. */
  assets?: Record<string, string> | null;
  /** background: "transparent" (default) or a CSS color for the widget canvas. */
  background?: string;
}): string {
  const { lang, code, args, assets, background = "transparent" } = opts;
  const assetsJson = escapeForScript(JSON.stringify(assets ?? {}));

  // Pure HTML widgets need no toolchain — host the source directly, but still
  // run the asset runtime so `asset:` refs in the HTML resolve.
  if (lang === "html") {
    return `<!doctype html><html><head><meta charset="utf-8">
<script>window.__KA__=JSON.parse(${assetsJson});</script></head><body>${code}
<script>${ASSET_RUNTIME}</script></body></html>`;
  }

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
<script>window.__KA__=JSON.parse(${assetsJson});</script>
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
${ASSET_RUNTIME}
</script></body></html>`;
}

// ── Local asset resolution ────────────────────────────────────────────────
// A widget runs in a null-origin sandboxed iframe, so it can't load files from
// the user's local workspace by name (`<img src="hola.png">` resolves to nothing).
// We rewrite any asset reference — `asset:hola.png` or a bare `hola.png` /
// `./img/hola.png` with a known media extension — to an inline data: URI before
// injecting, so local textures "just work" both online and offline.
const ASSET_EXT = "png|jpe?g|gif|webp|avif|bmp|ico|svg|mp3|wav|ogg|m4a|mp4|webm|glb|gltf";
const ASSET_TOKEN_RE = new RegExp(
  `asset:([A-Za-z0-9_\\-./]+)|([A-Za-z0-9_\\-./]+\\.(?:${ASSET_EXT}))`,
  "gi",
);

/** The flat asset filename for a token (basename, prefix/path stripped). */
const assetBasename = (raw: string) => raw.replace(/^asset:/i, "").split(/[\\/]/).pop() || raw;

/** Collect the distinct asset filenames referenced in a widget's code/args. */
export function collectWidgetAssetNames(text: string): string[] {
  const out = new Set<string>();
  if (!text) return [];
  for (const m of text.matchAll(ASSET_TOKEN_RE)) {
    out.add(assetBasename(m[1] ?? m[2] ?? ""));
  }
  return [...out].filter(Boolean);
}

/** Replace every asset token with its resolved URL (data: URI) from the map. */
export function applyWidgetAssetMap(text: string, map: Record<string, string>): string {
  if (!text) return text;
  return text.replace(ASSET_TOKEN_RE, (full, a?: string, b?: string) => {
    const name = assetBasename(a ?? b ?? "");
    return map[name] || full;
  });
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
