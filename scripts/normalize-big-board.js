const fs = require("fs");
const path = require("path");

const filePath = path.resolve(process.argv[2] || "");
if (!process.argv[2] || !fs.existsSync(filePath)) {
  throw new Error("Usage: node scripts/normalize-big-board.js <big-board.json>");
}

const source = JSON.parse(fs.readFileSync(filePath, "utf8"));
const entries = Object.entries(source).sort(([aKey, a], [bKey, b]) =>
  Number(a.board_number || a.id_number || aKey || 0) - Number(b.board_number || b.id_number || bKey || 0));

const stringFields = [
  "position_2", "nationality", "class", "build", "handle", "jersey_#",
  "athl_grde", "image", "height", "wingspan", "about", "strength_1",
  "strength_2", "strength_3", "weakness_1", "weakness_2", "weakness_3",
  "pro_comp",
];
const numberFields = [
  "pos_#", "age", "three_pt", "weight", "pts", "rbs", "ast", "stls", "blks",
];

const normalized = {};
for (const [key, prospect] of entries) {
  const rank = Number(prospect.board_number || key);
  const row = {
    board_number: rank,
    position_1: prospect.position_1 || "",
    name: prospect.name || "",
    team: prospect.team || "",
    overall: prospect.overall ?? null,
    potential: prospect.potential ?? null,
    "draft score": prospect["draft score"] ?? null,
  };
  for (const field of stringFields) row[field] = prospect[field] ?? "";
  // Some source sheets use the legacy misspelling `wingspain`.
  row.wingspan = prospect.wingspan ?? prospect.wingspain ?? "";
  for (const field of numberFields) row[field] = prospect[field] ?? null;
  normalized[String(rank)] = row;
}

fs.writeFileSync(filePath, `${JSON.stringify(normalized, null, 2)}\n`);
console.log(`Normalized ${entries.length} prospects in ${path.basename(filePath)}.`);
