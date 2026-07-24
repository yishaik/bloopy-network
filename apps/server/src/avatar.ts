import type { AvatarGenome } from "./types.js";

const escapeXml = (value: string) => value.replace(/[<>&'\"]/g, (char) => ({"<":"&lt;",">":"&gt;","&":"&amp;","'":"&apos;","\"":"&quot;"}[char] ?? char));

export function renderAvatar(genome: AvatarGenome, name: string): string {
  const bodyPath = genome.body === "pear"
    ? "M100 28 C148 28 166 72 158 126 C152 170 126 188 100 188 C74 188 48 170 42 126 C34 72 52 28 100 28Z"
    : genome.body === "cloud"
      ? "M45 145 C20 135 20 96 46 88 C38 57 71 38 94 55 C114 24 158 45 151 78 C184 83 185 130 156 142 C137 181 68 183 45 145Z"
      : "M100 28 C145 28 170 63 164 112 C158 160 137 185 100 185 C63 185 42 160 36 112 C30 63 55 28 100 28Z";
  const eyeY = genome.eyes === "sleepy" ? 94 : 88;
  const eye = genome.eyes === "spark"
    ? (x: number) => `<path d="M${x} ${eyeY-9} l4 8 8 4-8 4-4 8-4-8-8-4 8-4Z" fill="#1d2130"/>`
    : genome.eyes === "sleepy"
      ? (x: number) => `<path d="M${x-9} ${eyeY} Q${x} ${eyeY+8} ${x+9} ${eyeY}" fill="none" stroke="#1d2130" stroke-width="5" stroke-linecap="round"/>`
      : (x: number) => `<ellipse cx="${x}" cy="${eyeY}" rx="8" ry="11" fill="#1d2130"/><circle cx="${x-2}" cy="${eyeY-4}" r="2.5" fill="white"/>`;
  const mark = genome.mark === "moon" ? '<path d="M63 114 C74 105 78 119 69 126 C62 131 56 124 63 114Z" fill="var(--secondary)"/>' : genome.mark === "dot" ? '<circle cx="65" cy="120" r="8" fill="var(--secondary)"/>' : '<path d="M65 107 l4 9 10 1-8 7 3 10-9-5-9 5 3-10-8-7 10-1Z" fill="var(--secondary)"/>';
  const accessory = genome.accessory === "leaf" ? '<path d="M100 34 C112 12 137 14 139 19 C129 37 113 42 100 34Z" fill="#63b66c"/><path d="M101 34 Q117 26 133 20" stroke="#2f7d3c" stroke-width="3" fill="none"/>' : genome.accessory === "scarf" ? '<path d="M50 132 Q100 153 150 132 L145 151 Q100 169 55 151Z" fill="var(--secondary)"/><path d="M132 145 L151 177 L133 174 L119 151Z" fill="var(--secondary)"/>' : '<path d="M47 137 Q100 161 153 137" fill="none" stroke="#8d5a3a" stroke-width="9"/><rect x="116" y="132" width="35" height="37" rx="8" fill="#c98c54" stroke="#8d5a3a" stroke-width="4"/>';
  const glow = genome.evolution >= 3
    ? '<circle cx="100" cy="108" r="88" fill="none" stroke="var(--secondary)" stroke-opacity=".42" stroke-width="8"/><circle cx="100" cy="108" r="96" fill="none" stroke="var(--secondary)" stroke-opacity=".18" stroke-width="4"/>'
    : genome.evolution > 1 ? '<circle cx="100" cy="108" r="88" fill="none" stroke="var(--secondary)" stroke-opacity=".28" stroke-width="7"/>' : "";
  const crown = genome.evolution >= 3 ? '<path d="M82 26 L88 12 L96 22 L100 8 L104 22 L112 12 L118 26 Z" fill="var(--secondary)" stroke="#ffffff" stroke-opacity=".5" stroke-width="2"/>' : "";
  return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 200 210" role="img" aria-label="${escapeXml(name)}"><style>:root{--primary:${escapeXml(genome.primary)};--secondary:${escapeXml(genome.secondary)}}</style><defs><filter id="shadow"><feDropShadow dx="0" dy="7" stdDeviation="7" flood-opacity=".18"/></filter></defs>${glow}<g filter="url(#shadow)"><path d="${bodyPath}" fill="var(--primary)" stroke="#ffffff" stroke-opacity=".55" stroke-width="4"/>${mark}${eye(75)}${eye(125)}<path d="M86 118 Q100 130 114 118" fill="none" stroke="#1d2130" stroke-width="5" stroke-linecap="round"/>${accessory}${crown}</g></svg>`;
}
