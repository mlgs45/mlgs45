// Generative "activity landscape" from a GitHub contribution calendar.
// Renders abstract ridgelines (texture, not numbers) in the VoxM palette,
// so the exact daily counts can't be read off — only the overall shape.
//
//   node scripts/gen-contrib-art.mjs <outDir> <login>
//
// Data source order: GraphQL (if GH_TOKEN set) -> public API fallback -> stdin.
import { writeFileSync } from "node:fs";

const outDir = process.argv[2] || ".";
const login = process.argv[3] || "mlgs45";

// --- data layer: always returns grid[weekday 0..6][weekIndex] ---
async function fromGraphQL() {
  const q = `query($l:String!){user(login:$l){contributionsCollection{contributionCalendar{weeks{contributionDays{contributionCount weekday}}}}}}`;
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${process.env.GH_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "contrib-art",
    },
    body: JSON.stringify({ query: q, variables: { l: login } }),
  });
  const j = await res.json();
  if (j.errors || !j.data?.user) throw new Error("graphql: " + JSON.stringify(j.errors || j));
  return weeksToGrid(j.data.user.contributionsCollection.contributionCalendar.weeks);
}

async function fromPublicApi() {
  const res = await fetch(`https://github-contributions-api.jogruber.de/v4/${login}?y=last`, {
    headers: { "User-Agent": "contrib-art" },
  });
  const j = await res.json();
  const days = j.contributions || [];
  if (!days.length) throw new Error("public api: empty");
  const first = new Date(days[0].date);
  const firstSunday = new Date(first);
  firstSunday.setDate(first.getDate() - first.getDay());
  const nW = Math.ceil((new Date(days[days.length - 1].date) - firstSunday) / (7 * 864e5)) + 1;
  const grid = Array.from({ length: 7 }, () => new Array(nW).fill(0));
  for (const d of days) {
    const dt = new Date(d.date);
    const wi = Math.floor((dt - firstSunday) / (7 * 864e5));
    if (wi >= 0 && wi < nW) grid[dt.getDay()][wi] = d.count;
  }
  return grid;
}

function weeksToGrid(weeks) {
  const grid = Array.from({ length: 7 }, () => new Array(weeks.length).fill(0));
  weeks.forEach((wk, wi) => {
    for (const d of wk.contributionDays) grid[d.weekday][wi] = d.contributionCount;
  });
  return grid;
}

async function fromStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const j = JSON.parse(Buffer.concat(chunks).toString());
  return weeksToGrid(j.data.user.contributionsCollection.contributionCalendar.weeks);
}

async function getGrid() {
  if (process.env.GH_TOKEN) {
    try { return await fromGraphQL(); }
    catch (e) { console.error("graphql failed, falling back:", e.message); }
  }
  if (process.stdin.isTTY !== false || process.env.GH_TOKEN) {
    try { return await fromPublicApi(); }
    catch (e) { console.error("public api failed:", e.message); }
  }
  return await fromStdin();
}

// --- geometry ---
const grid = await getGrid();
const nW = grid[0].length;
let maxV = 0;
for (const row of grid) for (const v of row) maxV = Math.max(maxV, v);
maxV = maxV || 1;

const W = 820, H = 250;
const padX = 46, padTop = 40, padBot = 30;
const drawW = W - padX * 2;
const drawH = H - padTop - padBot;
const R = 15;
const SAMP = nW * 4;
const rowGap = drawH / (R - 1);
const scale = rowGap * 2.15;

function weekValue(fy, w) {
  const wd = fy * 6;
  const a = Math.floor(wd), b = Math.min(6, a + 1), t = wd - a;
  return grid[a][w] * (1 - t) + grid[b][w] * t;
}
function sampleWeeks(fy) {
  const vals = [];
  for (let w = 0; w < nW; w++) vals.push(weekValue(fy, w));
  const out = [];
  for (let s = 0; s < SAMP; s++) {
    const x = (s / (SAMP - 1)) * (nW - 1);
    const i = Math.floor(x), t = x - i;
    const p0 = vals[Math.max(0, i - 1)], p1 = vals[i];
    const p2 = vals[Math.min(nW - 1, i + 1)], p3 = vals[Math.min(nW - 1, i + 2)];
    const v = 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
    out.push(Math.max(0, v));
  }
  return out;
}
function ridgePath(i) {
  const fy = i / (R - 1);
  const yBase = padTop + i * rowGap;
  const vals = sampleWeeks(fy);
  const pts = vals.map((v, s) => {
    const x = padX + (s / (SAMP - 1)) * drawW;
    const base = Math.sin((s / (SAMP - 1)) * Math.PI * 5 + i * 0.9) * 2.2;
    const y = yBase - (v / maxV) * scale - base;
    return [x, y];
  });
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let k = 1; k < pts.length; k++) d += ` L ${pts[k][0].toFixed(1)} ${pts[k][1].toFixed(1)}`;
  d += ` L ${padX + drawW} ${yBase.toFixed(1)} L ${padX} ${yBase.toFixed(1)} Z`;
  return d;
}
function svg({ bg, fill, accent, edge }) {
  let ridges = "";
  for (let i = 0; i < R; i++) {
    const depth = i / (R - 1);
    const strokeOp = (0.35 + 0.65 * depth).toFixed(2);
    const col = depth > 0.55 ? accent : edge;
    ridges += `\n  <path d="${ridgePath(i)}" fill="${fill}" stroke="${col}" stroke-width="1.5" stroke-opacity="${strokeOp}" stroke-linejoin="round"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="contribution activity landscape">
  <rect width="${W}" height="${H}" rx="16" fill="${bg}"/>
  <rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="15" fill="none" stroke="${edge}" stroke-opacity="0.35" stroke-width="1"/>${ridges}
  <text x="${W - 58}" y="${H - 14}" text-anchor="end" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="11" letter-spacing="1" fill="${edge}" opacity="0.75">a year of building</text>
</svg>
`;
}

const dark = svg({ bg: "#0B1220", fill: "#0B1220", accent: "#FF5A36", edge: "#3C4E6B" });
const light = svg({ bg: "#F4F7FB", fill: "#F4F7FB", accent: "#FF5A36", edge: "#9BADC2" });
writeFileSync(`${outDir}/contrib-art-dark.svg`, dark);
writeFileSync(`${outDir}/contrib-art-light.svg`, light);
console.log(`wrote contrib-art-{dark,light}.svg  (maxV=${maxV}, weeks=${nW})`);
