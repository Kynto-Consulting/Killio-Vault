import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';

import { colors } from '../theme/theme';
import { fonts } from '../theme/fonts';

/**
 * KaTeX renderer for RN — same library the web RichText uses, surfaced through
 * a tiny offscreen WebView so the rendered math matches the web 1:1.
 *
 * The HTML imports KaTeX from a CDN once; the inner `\katexrender` call runs
 * client-side and reports the natural height back to RN so the WebView wraps
 * the rendered SVG without dead space.
 */
interface MathRendererProps {
  formula: string;
  /** display=true renders the block (centered) form, false the inline form. */
  display?: boolean;
  /** Inherited text color (px applies to both SVG glyphs and selection). */
  color?: string;
  /** Inherited font size in px. */
  size?: number;
}

const KATEX_VERSION = '0.16.21';

export function MathRenderer({
  formula,
  display = false,
  color = colors.foreground,
  size = 16,
}: MathRendererProps) {
  const [height, setHeight] = useState<number>(display ? 40 : Math.round(size * 1.2));

  const html = useMemo(
    () => buildHtml({ formula, display, color, size }),
    [formula, display, color, size],
  );

  return (
    <View
      style={{
        height,
        alignSelf: display ? 'stretch' : 'flex-start',
        marginVertical: display ? 6 : 0,
      }}
    >
      <WebView
        originWhitelist={['*']}
        source={{ html }}
        style={{ backgroundColor: 'transparent' }}
        scrollEnabled={false}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        androidLayerType="software"
        onMessage={(event) => {
          const next = Number(event.nativeEvent.data);
          if (Number.isFinite(next) && next > 0) {
            setHeight(Math.min(800, Math.ceil(next) + 2));
          }
        }}
      />
    </View>
  );
}

function buildHtml({
  formula,
  display,
  color,
  size,
}: {
  formula: string;
  display: boolean;
  color: string;
  size: number;
}): string {
  const safeFormula = formula.replace(/<\/script>/gi, '<\\/script>');
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist/katex.min.css" />
  <style>
    html, body { margin: 0; padding: 0; background: transparent; color: ${color}; font-size: ${size}px; overflow: hidden; }
    body { font-family: -apple-system, system-ui, sans-serif; }
    #math { padding: 0; ${display ? 'text-align: center;' : ''} }
    .katex { color: ${color} !important; }
  </style>
</head>
<body>
  <div id="math"></div>
  <script src="https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist/katex.min.js"></script>
  <script>
    (function() {
      try {
        katex.render(${JSON.stringify(safeFormula)}, document.getElementById('math'), {
          displayMode: ${display ? 'true' : 'false'},
          throwOnError: false,
          output: 'html',
        });
      } catch (err) {
        document.getElementById('math').textContent = ${JSON.stringify(safeFormula)};
      }
      requestAnimationFrame(function() {
        var h = document.body.scrollHeight || document.documentElement.scrollHeight;
        if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(String(h));
      });
    })();
  </script>
</body>
</html>`;
}

void fonts;
