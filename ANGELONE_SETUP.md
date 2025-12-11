# Angel One API Setup Guide

The backtesting system now uses **Angel One SmartAPI** (FREE) instead of Dhan API.

## Why Angel One?

- ✅ **Completely FREE** - No subscription required
- ✅ **Easy Registration** - Simple API access approval
- ✅ **Comprehensive Data** - Historical candle data for all NSE/BSE stocks
- ✅ **Well Documented** - Official Node.js SDK available

## Step 1: Create Angel One Account

1. If you don't have one, create a trading account at [Angel One](https://www.angelone.in/)
2. Complete KYC verification

## Step 2: Register for SmartAPI Access

1. Go to [SmartAPI Portal](https://smartapi.angelbroking.com/)
2. Click on **"Register"** or **"Create App"**
3. Fill in the application form:
   - App Name: "Backtesting System" (or any name)
   - Description: "Personal backtesting application"
   - Redirect URL: http://localhost:3001 (or leave default)
4. Submit and wait for approval (usually instant or within 24 hours)

## Step 3: Get Your API Credentials

Once approved, you'll receive:

### 1. API Key
- Found in SmartAPI dashboard under "My Apps"
- Example: `XYZ12345`

### 2. Client Code
- This is your Angel One trading account ID
- Example: `A123456`

### 3. Password
- Your Angel One login password
- The same password you use to login to the Angel One app/website

### 4. TOTP Secret (Two-Factor Authentication)

**Enable TOTP for API access:**

1. Login to Angel One web/app
2. Go to **Profile** → **Security** → **Two-Factor Authentication**
3. Enable **"App-based Authenticator"** (Google Authenticator/Authy)
4. **IMPORTANT**: When setting up, you'll see a QR code and a **secret key**
5. **Save this secret key** - this is your TOTP secret
6. Example secret: `JBSWY3DPEHPK3PXP`

**Note**: The TOTP secret is different from the 6-digit code shown in your authenticator app. You need the underlying secret key.

## Step 4: Configure Backend

Update `backend/.env` file:

```env
# Angel One API Credentials
ANGELONE_API_KEY=your_api_key_here
ANGELONE_CLIENT_CODE=your_client_code_here
ANGELONE_PASSWORD=your_password_here
ANGELONE_TOTP=your_totp_secret_here

# Server Configuration
PORT=3001
NODE_ENV=development
```

## Step 5: Understanding Symbol Tokens

Angel One uses **Symbol Tokens** instead of Security IDs.

### Common Symbol Tokens:

| Stock/Index | Symbol Token |
|-------------|--------------|
| RELIANCE    | 2885         |
| INFY        | 1594         |
| TCS         | 11536        |
| SBIN        | 3045         |
| HDFCBANK    | 1333         |
| NIFTY 50    | 99926000     |
| BANK NIFTY  | 99926009     |

### How to Find Symbol Tokens:

1. **Download Instrument Master File**:
   ```bash
   # Available at:
   https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json
   ```

2. **Search in the JSON file** for your desired stock:
   ```json
   {
     "token": "2885",
     "symbol": "RELIANCE-EQ",
     "name": "RELIANCE INDUSTRIES LTD",
     "expiry": "",
     "strike": "-1.000000",
     "lotsize": "1",
     "instrumenttype": "",
     "exch_seg": "NSE",
     "tick_size": "5.000000"
   }
   ```

3. Use the `token` value as the Symbol Token

## API Response Format

### Angel One getCandleData Response:

```json
{
  "status": true,
  "message": "SUCCESS",
  "data": [
    [
      "2024-01-15T09:15:00+05:30",  // ISO timestamp
      2450.50,                        // open
      2458.75,                        // high
      2445.00,                        // low
      2455.80,                        // close
      125000                          // volume
    ],
    ...
  ]
}
```

### Our Internal Format (after transformation):

```typescript
{
  timestamp: 1705296900,  // Unix timestamp (seconds)
  open: 2450.50,
  high: 2458.75,
  low: 2445.00,
  close: 2455.80,
  volume: 125000
}
```

## Interval Mapping

| UI Value | Angel One API Value |
|----------|---------------------|
| 1        | ONE_MINUTE          |
| 5        | FIVE_MINUTE         |
| 15       | FIFTEEN_MINUTE      |
| 30       | THIRTY_MINUTE       |
| 60       | ONE_HOUR            |
| 1D       | ONE_DAY            |

## Date Format

Angel One expects dates in format: `YYYY-MM-DD HH:MM`

Example:
- From: `2024-01-01 09:15`
- To: `2024-01-31 15:30`

The backend automatically converts your selected dates to this format.

## Testing Your Setup

1. **Start the backend**:
   ```bash
   cd backend
   npm run dev
   ```

2. **Check logs** for successful login:
   ```
   Angel One login successful
   Angel One API client initialized and logged in
   ```

3. **Test with sample data**:
   - Symbol Token: `2885` (RELIANCE)
   - Exchange: NSE_EQ
   - Interval: 5 Minutes
   - Date Range: Last 7 days

## Troubleshooting

### Error: "Login failed"
- Verify your Client Code and Password are correct
- Check TOTP secret is the actual secret key, not the 6-digit code

### Error: "Invalid API Key"
- Ensure API access is approved in SmartAPI portal
- Check API Key is copied correctly (no extra spaces)

### Error: "No data received"
- Verify Symbol Token is correct
- Check dates fall on trading days (Mon-Fri, not holidays)
- Ensure exchange is correct (NSE vs BSE)

### Error: "TOTP validation failed"
- TOTP secret must be the base32 secret key
- Not the 6-digit OTP code from authenticator app
- Re-enable TOTP and save the new secret

## Rate Limits

Angel One SmartAPI limits:
- **Historical Data**: ~3 requests per second
- **Daily Limit**: No strict limit for historical data
- **Session Duration**: JWT token valid for 24 hours

The backend automatically handles these limits with retry logic.

## Security Best Practices

1. **Never commit `.env` file** to git
2. **Keep TOTP secret secure** - it's like a password
3. **Use strong trading account password**
4. **Enable IP whitelisting** in SmartAPI dashboard (optional)

## Additional Resources

- [SmartAPI Documentation](https://smartapi.angelbroking.com/docs)
- [SmartAPI JavaScript SDK](https://github.com/angelbroking-github/smartapi-javascript)
- [Instrument Master File](https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json)

## Support

For Angel One API issues:
- Email: smartapi@angelbroking.com
- SmartAPI Portal: https://smartapi.angelbroking.com/

---

**Ready to backtest with FREE historical data! 📈**
