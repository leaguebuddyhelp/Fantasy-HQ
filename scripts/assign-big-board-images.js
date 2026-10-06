const fs = require("fs");
const path = require("path");

const boardPath = path.resolve(process.argv[2] || "");
const imageDirectory = path.resolve(process.argv[3] || "");
if (!process.argv[2] || !process.argv[3] || !fs.existsSync(boardPath) || !fs.existsSync(imageDirectory)) {
  throw new Error("Usage: node scripts/assign-big-board-images.js <big-board.json> <image-directory>");
}

const board = JSON.parse(fs.readFileSync(boardPath, "utf8"));
const draftClassDirectory = path.dirname(boardPath);
const prospects = Object.values(board);
let assigned = 0;

function nameKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

const prospectsByName = new Map(prospects.map((prospect) => [nameKey(prospect.name), prospect]));
const moves = [];

for (const file of fs.readdirSync(imageDirectory).sort()) {
  // Portraits may be staged before the board rankings exist. In that case the
  // filename contains only the player's slug; once data is available this
  // script adds the correct three-digit rank prefix automatically.
  const match = file.match(/^(?:\d{3}-)?(.+)(\.[^.]+)$/);
  if (!match) continue;
  const absoluteImagePath = path.join(imageDirectory, file);
  if (!fs.statSync(absoluteImagePath).isFile()) continue;

  const prospect = prospectsByName.get(nameKey(match[1]));
  if (!prospect) {
    console.warn(`Skipped unmatched image: ${file}`);
    continue;
  }

  const rank = String(Number(prospect.board_number || prospect.id_number));
  const targetFile = `${rank.padStart(3, "0")}-${match[1]}${match[2]}`;
  moves.push({ file, targetFile, prospect });
}

// Stage every changed filename first so rank swaps cannot overwrite another portrait.
for (const [index, move] of moves.entries()) {
  if (move.file === move.targetFile) continue;
  move.temporaryFile = `.rank-sync-${process.pid}-${index}-${move.file}`;
  fs.renameSync(path.join(imageDirectory, move.file), path.join(imageDirectory, move.temporaryFile));
}

for (const move of moves) {
  const sourceFile = move.temporaryFile || move.file;
  if (move.temporaryFile) {
    fs.renameSync(path.join(imageDirectory, sourceFile), path.join(imageDirectory, move.targetFile));
  }
  const absoluteImagePath = path.join(imageDirectory, move.targetFile);
  move.prospect.image = path.relative(draftClassDirectory, absoluteImagePath).replaceAll(path.sep, "/");
  assigned += 1;
}

fs.writeFileSync(boardPath, `${JSON.stringify(board, null, 2)}\n`);
console.log(`Assigned ${assigned} images in ${path.basename(boardPath)}.`);
