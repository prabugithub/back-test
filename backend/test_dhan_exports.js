const dhan = require('dhanhq');
console.log('Dhan Exports:', Object.keys(dhan));
if (dhan.DhanMarketFeed) {
    console.log('DhanMarketFeed exists');
}
