const dhanhq = require('dhanhq');
console.log('dhanhq exports:', Object.keys(dhanhq));
for (const key in dhanhq) {
    console.log(`Key: ${key}, Type: ${typeof dhanhq[key]}`);
}
