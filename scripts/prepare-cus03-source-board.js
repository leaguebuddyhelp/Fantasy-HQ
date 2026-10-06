const fs = require("fs");
const path = require("path");

const boardPath = path.resolve(process.argv[2] || "");
if (!process.argv[2] || !fs.existsSync(boardPath)) {
  throw new Error("Usage: node scripts/prepare-cus03-source-board.js <big-board.json>");
}

const board = JSON.parse(fs.readFileSync(boardPath, "utf8"));
const primaryPositions = { 1: "PG", 2: "SG", 3: "SF", 4: "PF", 5: "C" };
const originalInternationalTeams = new Map([
  ["Nathan Essome", "France"],
  ["Jokūbas Kanapinskas", "Lithuania"],
]);

const sourceOnlyBlankFields = [
  "build", "athl_grde", "about", "strength_1", "strength_2", "strength_3",
  "weakness_1", "weakness_2", "weakness_3", "pro_comp", "pts", "rbs",
  "ast", "stls", "blks",
];
const pendingPositionFields = [
  "nationality", "age", "handle", "jersey_#", "height", "wingspan", "weight",
];

for (const prospect of Object.values(board)) {
  const primary = primaryPositions[Number(prospect["pos_#"])] || prospect.position_1 || "";
  const isCompletedCenter = primary === "C";
  prospect.position_1 = primary;

  // The unfinished document stores each pending player's primary position in
  // position_2. Only completed centers currently include a true secondary.
  if (!isCompletedCenter) {
    prospect.position_2 = "";
    for (const field of pendingPositionFields) prospect[field] = field === "weight" || field === "age" ? null : "";
    if (originalInternationalTeams.has(prospect.name)) prospect.team = originalInternationalTeams.get(prospect.name);
  }

  for (const field of sourceOnlyBlankFields) {
    prospect[field] = ["pts", "rbs", "ast", "stls", "blks"].includes(field) ? null : "";
  }
}

fs.writeFileSync(boardPath, `${JSON.stringify(board, null, 2)}\n`);
console.log(`Prepared ${Object.keys(board).length} source-only prospects in ${path.basename(boardPath)}.`);
