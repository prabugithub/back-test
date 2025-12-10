# Features Documentation

## Overview

This manual backtesting system allows you to replay historical market data candle-by-candle and practice your trading strategies with a comprehensive set of charting tools and technical indicators.

## 🎯 Core Features

### 1. **Historical Data Playback**
- Load historical candle data from Angel One API (FREE)
- Multiple timeframes: 1min, 5min, 15min, 30min, 60min, Daily
- Step through candles one at a time or use auto-play
- Adjustable playback speed (0.5x to 10x)
- Keyboard shortcuts for quick navigation

### 2. **Advanced Charting**

#### **Chart Display**
- Professional candlestick charts with TradingView Lightweight Charts
- Volume histogram overlay
- Smooth scrolling and zooming
- Responsive design

#### **Technical Indicators** ✨ NEW
Add popular technical indicators to your chart:

- **SMA 20** (Simple Moving Average - 20 period) - Blue line
- **SMA 50** (Simple Moving Average - 50 period) - Orange line
- **EMA 20** (Exponential Moving Average - 20 period) - Teal line
- **EMA 50** (Exponential Moving Average - 50 period) - Pink line

**How to use:**
1. Click the "Indicators" button in the chart toolbar
2. Select/deselect the indicators you want to display
3. Indicators will automatically calculate and display on the chart

#### **Drawing Tools** ✨ NEW
Professional drawing tools for chart analysis:

1. **Trend Line** 📈
   - Draw trend lines to identify support/resistance
   - Click to place start point, click again for end point

2. **Horizontal Line** ➖
   - Mark key price levels
   - Perfect for support/resistance levels

3. **Rectangle** ⬜
   - Highlight consolidation zones or breakout areas
   - Draw boxes around price ranges

4. **Fibonacci Retracement** 🔄
   - Automatic Fibonacci levels: 0%, 23.6%, 38.2%, 50%, 61.8%, 78.6%, 100%
   - Click high and low points to generate levels

5. **Risk/Reward Tool** 🎯
   - Visualize your risk-to-reward ratio
   - Set entry, stop loss, and target levels
   - See R:R ratio automatically calculated

**How to use drawing tools:**
1. Click on the desired tool in the toolbar
2. Click on the chart to place points (tool-specific)
3. Click "Clear All" to remove all drawings
4. Click the active tool again to deactivate it

### 3. **Manual Trading**

Execute trades while backtesting:
- **BUY**: Enter long positions
- **SELL**: Close positions or go short
- Specify custom quantity
- See real-time P&L updates
- FIFO (First In First Out) position tracking

### 4. **Session Statistics**

Track your performance in real-time:
- **Current Position**: Quantity, average price, unrealized P&L
- **Realized P&L**: Profit/loss from closed trades
- **Total P&L**: Combined realized + unrealized
- **Win Rate**: Percentage of profitable trades
- **Trade History**: Detailed log of all executions
- **Performance Metrics**: Winning trades vs losing trades

### 5. **Playback Controls**

Navigate through historical data easily:
- ⏮️ **Step Backward**: Previous candle
- ▶️ **Play**: Auto-advance candles
- ⏸️ **Pause**: Stop auto-play
- ⏭️ **Step Forward**: Next candle
- **Speed Control**: 0.5x, 1x, 2x, 5x, 10x
- **Progress Bar**: Visual indicator of current position

**Keyboard Shortcuts:**
- `Space` - Play/Pause
- `←` - Step backward
- `→` - Step forward

## 🔧 Technical Details

### Indicators Implementation

All indicators are calculated client-side for performance:

**Simple Moving Average (SMA)**
```
SMA = (Sum of closing prices over N periods) / N
```

**Exponential Moving Average (EMA)**
```
EMA = (Close - Previous EMA) × Multiplier + Previous EMA
Multiplier = 2 / (Period + 1)
```

**Fibonacci Levels**
```
Level = Low + (High - Low) × Fibonacci Ratio
Ratios: 0%, 23.6%, 38.2%, 50%, 61.8%, 78.6%, 100%
```

### Drawing Tools Architecture

- **Canvas Overlay**: Drawings are rendered on a separate layer above the chart
- **Persistent State**: Drawings remain visible as you navigate through candles
- **Interactive**: Click to create, drag to adjust (future enhancement)
- **Export/Import**: Save and load your analysis (future enhancement)

## 📊 Supported Markets

### Indices
- Nifty 50
- Bank Nifty
- Nifty IT
- Nifty Pharma
- Finn Nifty

### Stocks
- All NSE & BSE listed stocks
- Large Cap, Mid Cap, Small Cap
- See `ANGEL_ONE_TOKENS.md` for popular stock tokens

## 🎨 UI/UX Features

- **Clean Interface**: Minimalist design focused on charting
- **Responsive**: Works on desktop and tablet screens
- **Dark Mode Ready**: Prepared for dark theme (future)
- **Color-Coded**: Green for bullish, Red for bearish
- **Tooltips**: Helpful hints throughout the interface
- **Real-time Updates**: All stats update instantly

## 🚀 Performance

- **Efficient Rendering**: Leverages TradingView Lightweight Charts
- **Smart Caching**: Historical data cached in SQLite
- **Optimized Calculations**: Indicators calculated once and cached
- **Smooth Playback**: 60fps chart updates
- **Memory Efficient**: Only visible candles rendered

## 🔐 Data & Privacy

- **Local Storage**: All data stored locally in SQLite
- **No Cloud**: Session data never leaves your machine
- **Free API**: Uses Angel One's free tier
- **Session-Only**: Data cleared on reset (no persistence by default)

## 📈 Future Enhancements

Planned features for future versions:

1. **More Indicators**
   - RSI (Relative Strength Index)
   - MACD (Moving Average Convergence Divergence)
   - Bollinger Bands
   - Stochastic Oscillator
   - ATR (Average True Range)

2. **Advanced Drawing Tools**
   - Trend channels
   - Elliott Wave patterns
   - Gann angles
   - Custom shapes

3. **Strategy Testing**
   - Automated strategy execution
   - Backtesting with predefined rules
   - Strategy optimization
   - Performance reports

4. **Data Export**
   - Export trade history to CSV
   - Generate PDF reports
   - Save chart screenshots
   - Export indicator values

5. **Collaboration**
   - Share charts and analysis
   - Import/export drawings
   - Save workspace layouts

## 💡 Tips for Best Results

1. **Start with a plan**: Define your entry, stop loss, and target before backtesting
2. **Use multiple timeframes**: Analyze higher timeframes for context
3. **Combine indicators**: Use 2-3 complementary indicators (e.g., SMA + EMA)
4. **Draw before trading**: Mark key levels with drawing tools first
5. **Review your trades**: Use the trade history to learn from mistakes
6. **Practice discipline**: Only take trades that meet your criteria
7. **Track win rate**: Aim for consistency, not just profits
8. **Use Risk/Reward tool**: Ensure minimum 1:2 R:R ratio

## 🐛 Known Limitations

1. **Drawing Tools**: Basic implementation, no drag-to-edit yet
2. **No Multi-timeframe**: Can't view multiple timeframes simultaneously
3. **Single Position**: Currently supports one position at a time
4. **No Order Types**: Only market orders (no limit/stop orders)
5. **Lightweight Charts API**: Some advanced features not yet available in v5

## 📞 Support

For issues, questions, or feature requests:
- Check `README.md` for setup instructions
- Check `ANGEL_ONE_TOKENS.md` for symbol tokens
- Check `ANGELONE_SETUP.md` for API configuration
- Report bugs via GitHub issues

## 🎓 Learning Resources

- **Technical Analysis**: Study common chart patterns and indicators
- **Risk Management**: Learn position sizing and stop loss placement
- **Trading Psychology**: Practice emotional discipline
- **Angel One API**: https://smartapi.angelbroking.com/docs

---

**Version**: 2.0
**Last Updated**: December 2025
**License**: MIT
