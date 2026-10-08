function cents(value) {
 const text = String(value).trim();
 if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw Error('Enter a dollar amount with at most two decimal places.');
 const [whole, fraction = ''] = text.split('.');
 const amount = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
 if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw Error('Amount exceeds the supported currency range.');
 return Number(amount);
}
function oddsRatio(odds) {
 if (!Number.isSafeInteger(odds) || Math.abs(odds) < 100) throw Error('Invalid American odds.');
 return odds > 0 ? [BigInt(odds) + 100n, 100n] : [-BigInt(odds) + 100n, -BigInt(odds)];
}
function payout(stake, odds) {
 if (!Number.isSafeInteger(stake) || stake < 0) throw Error('Invalid wager.');
 let numerator = BigInt(stake), denominator = 1n;
 for (const value of odds) {
  const [a, b] = oddsRatio(value); numerator *= a; denominator *= b;
  // Overflow is a numeric limit, not an artificial limit on the number of legs.
  if (numerator / denominator > BigInt(Number.MAX_SAFE_INTEGER)) throw Error('Potential payout exceeds the supported currency range.');
 }
 const result = (numerator + denominator / 2n) / denominator;
 if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw Error('Potential payout exceeds the supported currency range.');
 return Number(result);
}
function combinedAmericanOdds(odds) {
 let numerator=1n, denominator=1n;
 for(const value of odds){const [a,b]=oddsRatio(value);numerator*=a;denominator*=b;}
 if(numerator<=denominator)throw Error('Select at least one valid market.');
 const profit=numerator-denominator;
 const a=profit>=denominator?profit*100n:denominator*100n;
 const b=profit>=denominator?denominator:profit;
 const rounded=(a+b/2n)/b;
 if(rounded>BigInt(Number.MAX_SAFE_INTEGER))throw Error('Combined odds exceed the supported range.');
 return Number(rounded)*(profit>=denominator?1:-1);
}
module.exports = {cents, oddsRatio, payout, combinedAmericanOdds};
