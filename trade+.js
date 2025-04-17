require('dotenv').config();
const Binance = require('node-binance-api');
const technicalindicators = require('technicalindicators');

const binance = new Binance().options({
  APIKEY: process.env.BINANCE_API_KEY,
  APISECRET: process.env.BINANCE_API_SECRET,
  useServerTime: true,
});

const symbol = 'XRPUSDT';
const interval = '5m';
const SL_PERCENT = 0.8;  // Stop Loss
const TP_PERCENT = 1.5;  // Take Profit

// ✅ Lấy số lượng theo 50% vốn
async function getQuantityByBalance(price) {
  try {
    const account = await binance.futuresAccount();
    const balance = parseFloat(account.totalWalletBalance);
    const tradeValue = balance * 0.5;
    const quantity = (tradeValue / price).toFixed(1);
    return quantity;
  } catch (err) {
    console.error("❌ Lỗi khi lấy số dư:", err.message);
    return 0;
  }
}

// ✅ Đặt lệnh LONG/SHORT
async function placeOrder(direction, price) {
  const quantity = await getQuantityByBalance(price);
  if (quantity <= 0) return console.log("❌ Không đủ số dư để vào lệnh");

  const stopLoss = (direction === 'LONG')
    ? (price * (1 - SL_PERCENT / 100)).toFixed(4)
    : (price * (1 + SL_PERCENT / 100)).toFixed(4);

  const takeProfit = (direction === 'LONG')
    ? (price * (1 + TP_PERCENT / 100)).toFixed(4)
    : (price * (1 - TP_PERCENT / 100)).toFixed(4);

  console.log(`🚀 Vào lệnh ${direction} tại ${price} | SL: ${stopLoss} | TP: ${takeProfit} | Số lượng: ${quantity}`);

  try {
    if (direction === 'LONG') {
      await binance.futuresMarketBuy(symbol, quantity);
      await binance.futuresOrder('SELL', symbol, quantity, takeProfit, {
        reduceOnly: true, type: 'LIMIT', timeInForce: 'GTC'
      });
      await binance.futuresOrder('SELL', symbol, quantity, null, {
        stopPrice: stopLoss, reduceOnly: true, type: 'STOP_MARKET'
      });
    } else {
      await binance.futuresMarketSell(symbol, quantity);
      await binance.futuresOrder('BUY', symbol, quantity, takeProfit, {
        reduceOnly: true, type: 'LIMIT', timeInForce: 'GTC'
      });
      await binance.futuresOrder('BUY', symbol, quantity, null, {
        stopPrice: stopLoss, reduceOnly: true, type: 'STOP_MARKET'
      });
    }
  } catch (err) {
    console.error("❌ Lỗi khi đặt lệnh:", err.message);
  }
}

// ✅ Phân tích kỹ thuật và kiểm tra tín hiệu
async function checkSignal() {
  try {
    const candles = await binance.futuresCandles(symbol, interval, { limit: 200 });
    const closes = candles.map(c => parseFloat(c.close));
    const highs = candles.map(c => parseFloat(c.high));
    const lows = candles.map(c => parseFloat(c.low));
    const volumes = candles.map(c => parseFloat(c.volume));

    const ema50 = technicalindicators.EMA.calculate({ period: 50, values: closes });
    const ema200 = technicalindicators.EMA.calculate({ period: 200, values: closes });

    const stoch = technicalindicators.Stochastic.calculate({
      high: highs, low: lows, close: closes, period: 14, signalPeriod: 3
    });

    const macd = technicalindicators.MACD.calculate({
      values: closes,
      fastPeriod: 12, slowPeriod: 26, signalPeriod: 9,
      SimpleMAOscillator: false, SimpleMASignal: false
    });

    const rsi = technicalindicators.RSI.calculate({ period: 14, values: closes });

    // Tính trung bình volume (average volume)
    const averageVolume = volumes.slice(-50).reduce((acc, val) => acc + val, 0) / 50;

    const lastClose = closes.at(-1);
    const lastEMA50 = ema50.at(-1);
    const lastEMA200 = ema200.at(-1);
    const lastStoch = stoch.at(-1);
    const lastMACD = macd.at(-1);
    const lastRSI = rsi.at(-1);
    const lastVolume = volumes.at(-1);

    // ✅ Hiển thị tất cả chỉ số trên 1 dòng
    console.log(`[${new Date().toLocaleTimeString()}] EMA50: ${lastEMA50.toFixed(4)} | EMA200: ${lastEMA200.toFixed(4)} | Stoch K: ${lastStoch.k.toFixed(2)} D: ${lastStoch.d.toFixed(2)} | MACD: ${lastMACD.MACD.toFixed(4)} Signal: ${lastMACD.signal.toFixed(4)} | RSI: ${lastRSI.toFixed(2)} | Volume: ${lastVolume.toFixed(2)} | Avg Volume: ${averageVolume.toFixed(2)} | Close: ${lastClose}`);

    // Kiểm tra có phải là volume spike hay không (volume hiện tại vượt qua trung bình 2 lần)
    const isVolumeSpike = lastVolume > averageVolume * 2;

    const longSignal = lastEMA50 > lastEMA200 &&
                       lastStoch.k < 20 && lastStoch.k > lastStoch.d &&
                       lastMACD.MACD > lastMACD.signal &&
                       lastRSI < 30 && isVolumeSpike;  // RSI < 30 và volume spike

    const shortSignal = lastEMA50 < lastEMA200 &&
                        lastStoch.k > 80 && lastStoch.k < lastStoch.d &&
                        lastMACD.MACD < lastMACD.signal &&
                        lastRSI > 70 && isVolumeSpike;  // RSI > 70 và volume spike

    if (longSignal) {
      console.log("📈 Tín hiệu LONG ✅");
      await placeOrder('LONG', lastClose);
    } else if (shortSignal) {
      console.log("📉 Tín hiệu SHORT ✅");
      await placeOrder('SHORT', lastClose);
    } else {
      console.log("⏳ Không có tín hiệu giao dịch");
    }

  } catch (err) {
    console.error("❌ Lỗi phân tích kỹ thuật:", err.message);
  }
}

// ✅ Kiểm tra kết nối API và khởi chạy bot
(async () => {
  try {
    const account = await binance.futuresAccount();
    const usdt = account.totalWalletBalance;
    console.log("✅ Đã kết nối API thành công!");
    console.log(`💰 Số dư USDT: ${usdt}`);
    await checkSignal(); // chạy lần đầu khi khởi động
    setInterval(checkSignal, 5 * 60 * 1000); // chạy định kỳ 5 phút
  } catch (err) {
    console.error("❌ Lỗi kết nối Binance API:", err.message);
  }
})();
