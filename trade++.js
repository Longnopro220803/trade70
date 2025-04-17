require('dotenv').config();
const Binance = require('node-binance-api');
const { EMA, BollingerBands, RSI } = require('technicalindicators');

const binance = new Binance().options({
  APIKEY: process.env.BINANCE_API_KEY,
  APISECRET: process.env.BINANCE_API_SECRET,
  useServerTime: true,
});

const SYMBOL = 'DOGEUSDT';
const INTERVAL = '5m';
const QUANTITY = 20;
const TP_PERCENT = 1.5;
const SL_PERCENT = 0.8;

async function testAPIConnection() {
  try {
    const accountInfo = await binance.futuresAccount();
    console.log("✅ Đã kết nối API thành công!");
    console.log(`💰 Số dư USDT: ${accountInfo.totalWalletBalance}`);
  } catch (error) {
    console.error("❌ Lỗi kết nối API:", error.body || error.message);
  }
}

// Lấy toàn bộ dữ liệu nến ngay khi khởi động bot
async function getKlines(limit = 500) {
  const candles = await binance.futuresCandles(SYMBOL, INTERVAL, { limit });
  return candles.map(c => ({
    time: c.openTime,
    open: parseFloat(c.open),
    high: parseFloat(c.high),
    low: parseFloat(c.low),
    close: parseFloat(c.close),
    volume: parseFloat(c.volume),
  }));
}

async function analyzeAndTrade() {
  console.log(`\n[${new Date().toLocaleTimeString()}] 🔍 Đang phân tích thị trường...`);

  let data;
  try {
    // Lấy toàn bộ dữ liệu nến và phân tích ngay
    data = await getKlines();
  } catch (err) {
    console.error("❌ Lỗi khi lấy dữ liệu nến:", err.message);
    return;
  }

  const closes = data.map(c => c.close);
  if (closes.length < 50) {
    console.log("⚠️ Thiếu dữ liệu chỉ báo.");
    return;
  }

  const ema9 = EMA.calculate({ period: 9, values: closes });
  const ema21 = EMA.calculate({ period: 21, values: closes });
  const bb = BollingerBands.calculate({ period: 20, stdDev: 2, values: closes });
  const rsi = RSI.calculate({ period: 14, values: closes });

  const lastClose = closes[closes.length - 1];
  const ema9Last = ema9[ema9.length - 1];
  const ema21Last = ema21[ema21.length - 1];
  const bbLast = bb[bb.length - 1];
  const rsiLast = rsi[rsi.length - 1];

  if (!ema9Last || !ema21Last || !bbLast || !bbLast.lower || !bbLast.upper || !rsiLast) {
    console.log("⚠️ Chỉ báo chưa đủ dữ liệu. Bỏ qua lượt này.");
    return;
  }

  console.log(`📊 Close: ${lastClose.toFixed(4)}, EMA9: ${ema9Last.toFixed(4)}, EMA21: ${ema21Last.toFixed(4)}`);
  console.log(`📉 BB Lower: ${bbLast.lower.toFixed(4)}, Upper: ${bbLast.upper.toFixed(4)} | RSI: ${rsiLast.toFixed(2)}`);

  // Tín hiệu LONG
  if (ema9Last > ema21Last && lastClose < bbLast.lower && rsiLast < 40) {
    console.log('📈 Tín hiệu LONG');
    await openPosition('BUY', lastClose);
  }

  // Tín hiệu SHORT
  else if (ema9Last < ema21Last && lastClose > bbLast.upper && rsiLast > 60) {
    console.log('📉 Tín hiệu SHORT');
    await openPosition('SELL', lastClose);
  } else {
    console.log("⏸ Không có tín hiệu giao dịch.");
  }

  console.log('==============================');
  console.log(`⏰ Time: ${new Date().toLocaleString()}`);
}

async function openPosition(side, entryPrice) {
  try {
    const isLong = side === 'BUY';
    const stopLossPrice = isLong
      ? entryPrice * (1 - SL_PERCENT / 100)
      : entryPrice * (1 + SL_PERCENT / 100);
    const takeProfitPrice = isLong
      ? entryPrice * (1 + TP_PERCENT / 100)
      : entryPrice * (1 - TP_PERCENT / 100);

    const order = isLong
      ? await binance.futuresMarketBuy(SYMBOL, QUANTITY)
      : await binance.futuresMarketSell(SYMBOL, QUANTITY);

    console.log(`${side} Market Order Executed`, order);

    await binance.futuresOrder(
      isLong ? 'SELL' : 'BUY',
      SYMBOL,
      QUANTITY,
      takeProfitPrice.toFixed(4),
      {
        reduceOnly: true,
        type: 'TAKE_PROFIT_MARKET',
        stopPrice: takeProfitPrice.toFixed(4),
        timeInForce: 'GTC',
      }
    );

    await binance.futuresOrder(
      isLong ? 'SELL' : 'BUY',
      SYMBOL,
      QUANTITY,
      stopLossPrice.toFixed(4),
      {
        reduceOnly: true,
        type: 'STOP_MARKET',
        stopPrice: stopLossPrice.toFixed(4),
        timeInForce: 'GTC',
      }
    );

    console.log(`🎯 TP Price: ${takeProfitPrice.toFixed(4)} | 🛑 SL Price: ${stopLossPrice.toFixed(4)}`);
  } catch (err) {
    console.error('❌ Lỗi khi đặt lệnh:', err.body || err.message);
  }
}

// Chạy ngay khi khởi động bot
testAPIConnection();
analyzeAndTrade(); // Phân tích và mở lệnh ngay khi bot khởi động

// Sau mỗi 5 phút, bot sẽ phân tích và giao dịch
setInterval(analyzeAndTrade, 5 * 60 * 1000);
