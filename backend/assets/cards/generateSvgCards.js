const fs = require('fs');
const path = require('path');

// Output directory - the original hardcoded a Windows-specific absolute path
// (C:\Users\ryan_\transparent_poker\assets\cards). That's clearly
// machine-specific, so this converts it to a relative path alongside this
// script, matching the *intent* ("write into assets/cards") rather than the
// original developer's local machine path.
const outputDir = __dirname;
fs.mkdirSync(outputDir, { recursive: true });

// Card definitions
const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const suits = {
  C: ['\u2663', 'black'], // ♣
  D: ['\u2666', 'red'], // ♦
  H: ['\u2665', 'red'], // ♥
  S: ['\u2660', 'black'], // ♠
};

function svgTemplate(rank, symbol, color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300" viewBox="0 0 200 300">
  <rect width="200" height="300" rx="15" ry="15" fill="white" stroke="black" stroke-width="4"/>

  <text x="20" y="40" font-size="32" font-family="Arial" fill="${color}">${rank}</text>
  <text x="20" y="75" font-size="32" font-family="Arial" fill="${color}">${symbol}</text>

  <text x="100" y="170" text-anchor="middle" font-size="100" font-family="Arial" fill="${color}">
    ${symbol}
  </text>

  <g transform="rotate(180 100 150)">
    <text x="20" y="40" font-size="32" font-family="Arial" fill="${color}">${rank}</text>
    <text x="20" y="75" font-size="32" font-family="Arial" fill="${color}">${symbol}</text>
  </g>
</svg>
`;
}

// Generate all 52 cards
for (const rank of ranks) {
  for (const [suitCode, [symbol, color]] of Object.entries(suits)) {
    const filename = `${rank}${suitCode}.svg`;
    const filepath = path.join(outputDir, filename);
    fs.writeFileSync(filepath, svgTemplate(rank, symbol, color), 'utf-8');
  }
}

console.log(`Created 52 SVG card files in:\n${outputDir}`);
