# Quick Start Guide

Get your backtesting system running in 5 minutes!

## Prerequisites

- Node.js v18+ installed
- Dhan account with API access

## Step 1: Get Dhan API Credentials (2 minutes)

1. Go to https://web.dhan.co and login
2. Click on your profile → **Access DhanHQ APIs**
3. Click **Generate Access Token**
4. Copy your **Client ID** and **Access Token**

⚠️ **Note:** Access tokens expire after 24 hours. You'll need to regenerate daily.

## Step 2: Backend Setup (1 minute)

```bash
cd backend
npm install

# Create .env file and add your credentials
# Edit backend/.env:
# DHAN_CLIENT_ID=your_client_id
# DHAN_ACCESS_TOKEN=your_token
```

## Step 3: Frontend Setup (1 minute)

```bash
cd frontend
npm install
```

## Step 4: Run the Application (1 minute)

Open **TWO terminals:**

### Terminal 1 - Backend
```bash
cd backend
npm run dev
```

Wait for: `Server running on http://localhost:3001`

### Terminal 2 - Frontend
```bash
cd frontend
npm run dev
```

Wait for: `Local: http://localhost:5173`

## Step 5: Start Backtesting!

1. Open browser: `http://localhost:5173`
2. Enter Security ID: `1333` (RELIANCE)
3. Select dates: Last month
4. Click **Fetch Data**
5. Click **Play** to start!

## Keyboard Shortcuts

- **Space** - Play/Pause
- **←** - Previous candle
- **→** - Next candle

## Common Security IDs

| Stock    | Security ID |
|----------|-------------|
| RELIANCE | 1333        |
| INFOSYS  | 1594        |
| TCS      | 11536       |
| WIPRO    | 3787        |
| HDFC BANK| 1330        |

## Troubleshooting

**Backend won't start?**
- Check if `.env` file exists in `backend/` folder
- Verify credentials are correct
- Ensure port 3001 is not in use

**Frontend won't start?**
- Check if backend is running first
- Ensure port 5173 is not in use

**No data fetched?**
- Verify Dhan token is not expired
- Check if dates fall on market open days
- Try RELIANCE (1333) first to test

## Next Steps

- Read the full [README.md](README.md) for detailed documentation
- Experiment with different stocks and timeframes
- Start manual backtesting!

**Happy Trading! 🚀**
