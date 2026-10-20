const fs = require('node:fs');
const path = require('node:path');

function prospectImageKey(name) {
    return String(name || '').normalize('NFD').replace(/\p{Diacritic}/gu, '')
        .toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^aronjimenez$/, 'aaronjimenez');
}

// Filename ranks are historical: a player's name must match after board reordering.
function prospectImageMap(draftClassDir, fileName) {
    const classId = String(fileName || '').replace(/\.json$/i, '')
        .replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
    const images = new Map();
    function collect(directory) {
        if (!fs.existsSync(directory)) return;
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const target = path.join(directory, entry.name);
            if (entry.isDirectory()) { collect(target); continue; }
            if (!entry.isFile()) continue;
            const match = entry.name.match(/^(?:\d{3}-)?(.+)\.(png|webp|jpe?g)$/i);
            if (!match) continue;
            const key = prospectImageKey(match[1]);
            const previous = images.get(key);
            if (!previous || match[2].toLowerCase() === 'png') images.set(key, target);
        }
    }
    collect(path.join(draftClassDir, 'images', classId));
    return images;
}

module.exports = { prospectImageKey, prospectImageMap };
