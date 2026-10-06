function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function slugify(value) {
  return normalizeText(value).replace(/\s+/g, "-");
}

function activeMemberships(memberships, seasonId = null) {
  return (memberships || []).filter((membership) => {
    const seasonMatches = seasonId == null || String(membership.seasonId) === String(seasonId);
    const active = membership.active !== false && !membership.endedAt;
    return seasonMatches && active;
  });
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function stringOrNull(value) {
  const next = String(value || "").trim();
  return next || null;
}

function diffObject(before, after, fields) {
  const changes = [];
  for (const field of fields) {
    const left = before?.[field] ?? null;
    const right = after?.[field] ?? null;
    if (String(left ?? "") !== String(right ?? "")) {
      changes.push({ field, before: left, after: right });
    }
  }
  return changes;
}

module.exports = {
  activeMemberships,
  diffObject,
  normalizeText,
  numberOrNull,
  slugify,
  stringOrNull,
};
