const { timingSafeEqual } = require('crypto');
function same(a, b) { const left = Buffer.from(a), right = Buffer.from(b); return left.length === right.length && timingSafeEqual(left, right); }
function websitePrincipal(request) {
  const key = String(request.headers?.['x-leaguebuddy-admin-key'] || '').trim();
  if (!key) return null;
  if (process.env.WEBSITE_ADMIN_KEYS) {
    let credentials;
    try { credentials = JSON.parse(process.env.WEBSITE_ADMIN_KEYS); } catch { return null; }
    if (!credentials || Array.isArray(credentials) || typeof credentials !== 'object') return null;
    const entries = Object.entries(credentials);
    if (entries.some(([name, secret]) => !name.trim() || name.length > 100 || typeof secret !== 'string' || !secret.trim()) || new Set(entries.map(([,secret]) => secret)).size !== entries.length) return null;
    const match = entries.find(([,secret]) => same(key, secret));
    return match ? { operator: match[0], principal: `website-staff:${match[0]}` } : null;
  }
  const configured = String(process.env.WEBSITE_ADMIN_KEY || '').trim();
  return configured && same(key, configured) ? { operator: null, principal: 'website-commissioner-key' } : null;
}
function bindWebsiteOperator(request, body) {
  const principal = websitePrincipal(request);
  if (principal?.operator) body.operator = principal.operator;
  return body;
}
module.exports = { websitePrincipal, bindWebsiteOperator };
