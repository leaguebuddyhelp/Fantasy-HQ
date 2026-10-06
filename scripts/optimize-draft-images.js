const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const imageRoot = path.resolve(process.argv[2] || path.join(__dirname, "..", "draft_class", "images"));
if (!fs.existsSync(imageRoot) || !fs.statSync(imageRoot).isDirectory()) {
  throw new Error("Usage: node scripts/optimize-draft-images.js [image-directory]");
}

function imageFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return imageFiles(entryPath);
    return entry.isFile() && path.extname(entry.name).toLowerCase() === ".png" ? [entryPath] : [];
  });
}

async function main() {
  const files = imageFiles(imageRoot);
  let converted = 0;
  let skipped = 0;
  let sourceBytes = 0;
  let outputBytes = 0;

  for (const file of files) {
    const output = file.replace(/\.png$/i, ".webp");
    const sourceStat = fs.statSync(file);
    sourceBytes += sourceStat.size;

    if (fs.existsSync(output) && fs.statSync(output).mtimeMs >= sourceStat.mtimeMs) {
      skipped += 1;
      outputBytes += fs.statSync(output).size;
      continue;
    }

    await sharp(file)
      .webp({ quality: 82, alphaQuality: 90, effort: 4, smartSubsample: true })
      .toFile(output);
    converted += 1;
    outputBytes += fs.statSync(output).size;
  }

  const percent = sourceBytes ? Math.round((1 - outputBytes / sourceBytes) * 100) : 0;
  console.log(`Optimized ${converted} images; skipped ${skipped} current images.`);
  console.log(`${(sourceBytes / 1024 / 1024).toFixed(1)} MB PNG -> ${(outputBytes / 1024 / 1024).toFixed(1)} MB WebP (${percent}% smaller).`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
