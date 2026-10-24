// FontFace accepts bytes: preserve native fonts without browser URL fetches or
// weakening the host's font-src / local-network policy.
export function splitNativeFonts(css) {
  const fonts = [];
  const clean = css.replace(/@font-face\s*\{([^}]+)\}/g, (rule, body) => {
    const data = /url\(["']?(data:font\/woff2;base64,[A-Za-z0-9+/=]+)["']?\)/.exec(body)?.[1]
      ?? /url\(["']?(data:application\/(?:font-woff|x-font-woff);base64,[A-Za-z0-9+/=]+)["']?\)/.exec(body)?.[1];
    if (!data) return rule;
    const family = /font-family\s*:\s*([^;]+)/.exec(body)?.[1]?.trim().replace(/^["']|["']$/g, '');
    const weight = /font-weight\s*:\s*([^;]+)/.exec(body)?.[1]?.trim() ?? 'normal';
    const style = /font-style\s*:\s*([^;]+)/.exec(body)?.[1]?.trim() ?? 'normal';
    if (family) fonts.push({ family, weight, style, bytes: data.slice(data.indexOf(',') + 1) });
    return '';
  });
  return { css: clean, fonts };
}
export async function installNativeFonts(fonts, doc = document) {
  for (const font of fonts) {
    const bytes = Uint8Array.from(atob(font.bytes), c => c.charCodeAt(0));
    const face = new FontFace(font.family, bytes, { weight: font.weight, style: font.style });
    await face.load(); doc.fonts.add(face);
  }
}
