const fs = require("fs");
const path = require("path");

const [topTenArgument, imageRootArgument, outputArgument, targetArgument = "75"] = process.argv.slice(2);
if (!topTenArgument || !imageRootArgument || !outputArgument) {
  throw new Error("Usage: node scripts/seed-staged-big-board.js <top-ten.json> <image-root> <output.json>");
}

const topTenPath = path.resolve(topTenArgument);
const imageRoot = path.resolve(imageRootArgument);
const outputPath = path.resolve(outputArgument);
const targetSize = Number(targetArgument);
if (!Number.isInteger(targetSize) || targetSize < 1) throw new Error("Target size must be a positive integer.");
const draftClassDirectory = path.dirname(outputPath);
const topTen = Object.values(JSON.parse(fs.readFileSync(topTenPath, "utf8")));

function nameKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function displayName(slug) {
  return slug.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

const topTenByName = new Map(topTen.map((prospect) => [nameKey(prospect.name), prospect]));
const portraits = [];
for (const position of fs.readdirSync(imageRoot, { withFileTypes: true })) {
  if (!position.isDirectory()) continue;
  const positionDirectory = path.join(imageRoot, position.name);
  for (const file of fs.readdirSync(positionDirectory).sort()) {
    if (!file.toLowerCase().endsWith(".webp")) continue;
    const slug = file.replace(/^(?:\d{3}-)?/, "").replace(/\.webp$/i, "");
    portraits.push({
      file,
      name: displayName(slug),
      key: nameKey(slug),
      position: position.name.toUpperCase(),
      path: path.relative(draftClassDirectory, path.join(positionDirectory, file)).replaceAll(path.sep, "/"),
    });
  }
}

const board = {};
const usedPortraits = new Set();
for (const prospect of topTen.sort((a, b) => Number(a.id_number) - Number(b.id_number))) {
  const portrait = portraits.find((item) => item.key === nameKey(prospect.name));
  if (!portrait) continue;
  const rank = Number(prospect.id_number);
  const row = { ...prospect, board_number: rank, image: portrait.path };
  delete row.id_number;
  board[String(rank)] = row;
  usedPortraits.add(portrait.path);
}

let nextRank = Math.max(0, ...Object.keys(board).map(Number)) + 1;
for (const portrait of portraits.filter((item) => !usedPortraits.has(item.path))) {
  board[String(nextRank)] = {
    board_number: nextRank,
    position_1: portrait.position,
    position_2: "",
    name: portrait.name,
    team: "",
    nationality: "",
    class: "",
    image: portrait.path,
  };
  nextRank += 1;
}

while (nextRank <= targetSize) {
  board[String(nextRank)] = {
    board_number: nextRank,
    position_1: "",
    position_2: "",
    name: "",
    team: "",
    nationality: "",
    class: "",
    image: "",
  };
  nextRank += 1;
}

fs.writeFileSync(outputPath, `${JSON.stringify(board, null, 2)}\n`);
console.log(`Seeded ${Object.keys(board).length} staged prospects in ${path.basename(outputPath)}.`);
