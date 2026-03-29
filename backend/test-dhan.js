const { DhanMarketFeed } = require('dhanhq');
console.log('DhanMarketFeed export type:', typeof DhanMarketFeed);
try {
    const feed = new DhanMarketFeed({ client_id: '123', access_token: 'abc' });
    console.log('Successfully created feed instance');
    console.log('Methods:', Object.keys(feed));
} catch (e) {
    console.log('Failed to create instance:', e.message);
}
