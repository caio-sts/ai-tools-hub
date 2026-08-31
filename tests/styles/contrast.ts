/**
 * WCAG contrast over the tokens as they are DECLARED, so a ratio can be asserted without a
 * browser. oklch() is converted the way a browser paints it: OKLab -> linear sRGB -> gamut
 * clip -> gamma encode, and the luminance is taken from the clipped result rather than the
 * unclipped one, so an out-of-gamut colour scores what is actually shown.
 */
export interface Oklch {
  l: number;
  c: number;
  h: number;
}

/** Reads one token's oklch() triple out of a CSS block. Returns null when it is not declared. */
export function readOklch(block: string, token: string): Oklch | null {
  const match = block.match(new RegExp(`${token}\\s*:\\s*oklch\\(([^)]+)\\)`));
  if (!match) return null;
  const parts = match[1].trim().split(/[\s/]+/).filter(Boolean);
  const num = (raw: string): number => (raw.endsWith('%') ? Number.parseFloat(raw) / 100 : Number.parseFloat(raw));
  return { l: num(parts[0] ?? '0'), c: num(parts[1] ?? '0'), h: num(parts[2] ?? '0') };
}

function gammaEncode(channel: number): number {
  const clipped = Math.min(1, Math.max(0, channel));
  return clipped <= 0.0031308 ? 12.92 * clipped : 1.055 * clipped ** (1 / 2.4) - 0.055;
}

function gammaDecode(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

export function oklchToSrgb({ l, c, h }: Oklch): [number, number, number] {
  const rad = (h * Math.PI) / 180;
  const a = c * Math.cos(rad);
  const b = c * Math.sin(rad);

  const lc = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mc = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sc = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return [
    gammaEncode(4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc),
    gammaEncode(-1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc),
    gammaEncode(-0.0041960863 * lc - 0.7034186147 * mc + 1.707614701 * sc),
  ];
}

export function relativeLuminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map(gammaDecode) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio, rounded to two decimals so a failure message reads cleanly. */
export function contrastRatio(a: Oklch, b: Oklch): number {
  const la = relativeLuminance(oklchToSrgb(a));
  const lb = relativeLuminance(oklchToSrgb(b));
  const ratio = (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  return Math.round(ratio * 100) / 100;
}

/**
 * The two palettes as declared. Dark lives in `:root[data-theme="dark"]` and in a
 * prefers-color-scheme block that theme-theming.test.ts already proves identical, so reading the
 * explicit one is enough. Light is whatever is left once the dark blocks and every media region
 * are removed.
 */
export function themeBlocks(css: string): { light: string; dark: string } {
  // The build minifies the attribute selector's quotes away, so match both forms.
  const marker = /:root\[data-theme=["']?dark["']?\]/;
  let light = css;
  let dark = '';

  for (;;) {
    const found = marker.exec(light);
    if (found === null) break;
    const at = found.index;
    const open = light.indexOf('{', at);
    let depth = 1;
    let k = open + 1;
    while (k < light.length && depth > 0) {
      if (light[k] === '{') depth += 1;
      else if (light[k] === '}') depth -= 1;
      k += 1;
    }
    dark += light.slice(open + 1, k - 1);
    light = light.slice(0, at) + light.slice(k);
  }
  return { light, dark };
}
