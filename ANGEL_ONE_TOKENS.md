# Angel One Symbol Tokens Reference

This document contains symbol tokens for popular Indian stocks and indices that you can use with the Angel One API.

## How to Use

Enter the **Symbol Token** in the "Symbol Token" field when loading data in the backtesting application.

## Indices

| Index Name | Symbol | Token |
|------------|--------|-------|
| Nifty 50 | NIFTY | 99926000 |
| Bank Nifty | BANKNIFTY | 99926009 |
| Nifty IT | NIFTYIT | 99926017 |
| Nifty Pharma | NIFTYPHARMA | 99926023 |
| Nifty Financial Services | FINNIFTY | 99926037 |

## Top Large Cap Stocks

| Company | Symbol | Token | Sector |
|---------|--------|-------|--------|
| Reliance Industries | RELIANCE | 2885 | Conglomerate |
| TCS | TCS | 11536 | IT |
| HDFC Bank | HDFCBANK | 1333 | Banking |
| Infosys | INFY | 1594 | IT |
| ICICI Bank | ICICIBANK | 4963 | Banking |
| Hindustan Unilever | HINDUNILVR | 1394 | FMCG |
| ITC | ITC | 1660 | FMCG |
| State Bank of India | SBIN | 3045 | Banking |
| Bharti Airtel | BHARTIARTL | 10604 | Telecom |
| Kotak Mahindra Bank | KOTAKBANK | 1922 | Banking |
| Larsen & Toubro | LT | 11483 | Infrastructure |
| Axis Bank | AXISBANK | 5900 | Banking |
| Bajaj Finance | BAJFINANCE | 317 | NBFC |
| Asian Paints | ASIANPAINT | 236 | Paints |
| Maruti Suzuki | MARUTI | 10999 | Auto |
| HCL Technologies | HCLTECH | 7229 | IT |
| Wipro | WIPRO | 3787 | IT |
| Titan Company | TITAN | 3506 | Retail |
| Sun Pharma | SUNPHARMA | 3351 | Pharma |
| UltraTech Cement | ULTRACEMCO | 11532 | Cement |

## Popular Mid Cap Stocks

| Company | Symbol | Token | Sector |
|---------|--------|-------|--------|
| Adani Ports | ADANIPORTS | 15083 | Logistics |
| Tata Motors | TATAMOTORS | 3456 | Auto |
| IndusInd Bank | INDUSINDBK | 5258 | Banking |
| Tech Mahindra | TECHM | 13538 | IT |
| Power Grid | POWERGRID | 14977 | Power |
| NTPC | NTPC | 11630 | Power |
| Coal India | COALINDIA | 20374 | Mining |
| ONGC | ONGC | 2475 | Oil & Gas |
| Tata Steel | TATASTEEL | 3499 | Steel |
| Bajaj Auto | BAJAJ-AUTO | 16669 | Auto |

## How to Find Token for Other Stocks

If you need tokens for other stocks not listed here:

1. **Method 1: Angel One API**
   ```bash
   # Use the searchScrip API endpoint
   curl -X POST https://apiconnect.angelbroking.com/rest/secure/angelbroking/order/v1/searchScrip \
     -H "Authorization: Bearer YOUR_JWT_TOKEN" \
     -d '{"exchange":"NSE","searchscrip":"RELIANCE"}'
   ```

2. **Method 2: Angel One Mobile App**
   - Search for the stock in the app
   - The symbol token is usually visible in the stock details or URL

3. **Method 3: Angel One Website**
   - Visit: https://smartapi.angelbroking.com/
   - Look for the "Master Contract" download
   - The CSV file contains all symbol tokens

## Exchange Segments

When loading data, also select the correct exchange segment:

- **NSE_EQ** - NSE Equity (most common stocks)
- **BSE_EQ** - BSE Equity
- **NSE_FO** - NSE Futures & Options (for indices)
- **MCX_FO** - MCX Commodity Futures

## Instrument Types

- **EQUITY** - For stocks
- **INDEX** - For indices like Nifty, Bank Nifty
- **FUTIDX** - For index futures
- **FUTSTK** - For stock futures
- **OPTIDX** - For index options
- **OPTSTK** - For stock options

## Example Usage

To backtest **Reliance Industries** with **5-minute candles**:

1. Symbol Token: `2885`
2. Exchange Segment: `NSE_EQ`
3. Instrument Type: `EQUITY`
4. Interval: `5`
5. Date Range: Select your desired range

## Notes

- Symbol tokens may change occasionally. If you get an error, verify the token using the methods above.
- For intraday data (1min, 5min, 15min), you can fetch up to 30 days of data at a time.
- For daily/weekly data, you can fetch longer historical periods.
- Free Angel One API has rate limits - avoid making too many requests in quick succession.

## Need Help?

If you're unable to find a symbol token, check the Angel One SmartAPI documentation:
- https://smartapi.angelbroking.com/docs
- https://smartapi.angelbroking.com/enable-totp
