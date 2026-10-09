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
  if (principal) Object.defineProperty(body,'authenticatedPrincipal',{value:principal.principal,enumerable:false});
  return body;
}
function websiteActor(request, context, { commissioner = false, operator } = {}) {
  const principal = websitePrincipal(request);
  if (!principal) throw Error('Staff authorization required.');
  const commissionerId = context.league.commissionerUserId;
  if ((commissioner || !principal.operator) && !commissionerId) throw Error('Configure the league commissioner Discord ID before using commissioner website controls.');
  if (commissioner && principal.operator && principal.operator !== commissionerId) throw Error('Commissioner website credentials required.');
  return { id: principal.operator || commissionerId, principal: principal.principal,
    operator: principal.operator || operator || 'Commissioner', authorized: true, staffAuthorized: true,
    commissionerUserId: commissionerId };
}
module.exports = { websitePrincipal, bindWebsiteOperator, websiteActor };
