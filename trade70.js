require('dotenv').config();
const Binance = require('node-binance-api');
const technicalindicators = require('technicalindicators');

const binance = new Binance().options({
  APIKEY: process.env.BINANCE_API_KEY,
  APISECRET: process.env.BINANCE_API_SECRET,
  useServerTime: true,
});

const symbols = ['DOGEUSDT', 'XRPUSDT', 'LINKUSDT', 'SUIUSDT', 'LTCUSDT', 'ADAUSDT'];
const interval = '5m';
const SL_PERCENT = 0.8;
const TP_PERCENT = 2.0;

async function getQuantityByBalance(symbol, price) {
  try {
    const account = await binance.futuresAccount();
    const balance = parseFloat(account.totalWalletBalance);
    const allocatedBalance = balance * 0.2;
    const quantity = (allocatedBalance / price).toFixed(1);
    return quantity;
  } catch (err) {
    console.error(`[${symbol}] ❌ Lỗi lấy số dư:`, err.message);
    return 0;
  }
}

async function placeOrder(symbol, direction, price) {
  const quantity = await getQuantityByBalance(symbol, price);
  if (quantity <= 0) return console.log(`[${symbol}] ❌ Không đủ số dư`);

  const stopLoss = direction === 'LONG'
    ? (price * (1 - SL_PERCENT / 100)).toFixed(4)
    : (price * (1 + SL_PERCENT / 100)).toFixed(4);

  const takeProfit = direction === 'LONG'
    ? (price * (1 + TP_PERCENT / 100)).toFixed(4)
    : (price * (1 - TP_PERCENT / 100)).toFixed(4);

  console.log(`🚀 [${symbol}] ${direction} | Entry: ${price} | SL: ${stopLoss} | TP: ${takeProfit} | Qty: ${quantity}`);

  try {
    if (direction === 'LONG') {
      await binance.futuresMarketBuy(symbol, quantity);
      await binance.futuresOrder('SELL', symbol, quantity, takeProfit, { reduceOnly: true, type: 'LIMIT', timeInForce: 'GTC' });
      await binance.futuresOrder('SELL', symbol, quantity, null, { stopPrice: stopLoss, reduceOnly: true, type: 'STOP_MARKET' });
    } else {
      await binance.futuresMarketSell(symbol, quantity);
      await binance.futuresOrder('BUY', symbol, quantity, takeProfit, { reduceOnly: true, type: 'LIMIT', timeInForce: 'GTC' });
      await binance.futuresOrder('BUY', symbol, quantity, null, { stopPrice: stopLoss, reduceOnly: true, type: 'STOP_MARKET' });
    }
  } catch (err) {
    console.error(`[${symbol}] ❌ Lỗi đặt lệnh:`, err.message);
  }
}

async function checkSignal(symbol) {
  try {
    const candles = await binance.futuresCandles(symbol, interval, { limit: 200 });
    const closes = candles.map(c => parseFloat(c.close));
    const highs = candles.map(c => parseFloat(c.high));
    const lows = candles.map(c => parseFloat(c.low));
    const volumes = candles.map(c => parseFloat(c.volume));

    const ema50 = technicalindicators.EMA.calculate({ period: 50, values: closes });
    const ema200 = technicalindicators.EMA.calculate({ period: 200, values: closes });
    const macd = technicalindicators.MACD.calculate({
      values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9,
      SimpleMAOscillator: false, SimpleMASignal: false
    });
    const rsi = technicalindicators.RSI.calculate({ period: 14, values: closes });
    const stoch = technicalindicators.Stochastic.calculate({
      high: highs, low: lows, close: closes, period: 14, signalPeriod: 3
    });
    const bb = technicalindicators.BollingerBands.calculate({
      period: 20, stdDev: 2, values: closes
    });

    const lastClose = closes.at(-1);
    const lastVolume = volumes.at(-1);
    const avgVolume = volumes.slice(-50).reduce((a, b) => a + b, 0) / 50;
    const isVolumeSpike = lastVolume > avgVolume * 1.8;

    const trendUp = ema50.at(-1) > ema200.at(-1);
    const trendDown = ema50.at(-1) < ema200.at(-1);
    const lastMACD = macd.at(-1);
    const lastRSI = rsi.at(-1);
    const lastStoch = stoch.at(-1);
    const lastBB = bb.at(-1);

    const closeNearLowerBand = lastClose <= lastBB.lower;
    const closeNearUpperBand = lastClose >= lastBB.upper;
    const bullishCandle = closes.at(-1) > closes.at(-2);
    const bearishCandle = closes.at(-1) < closes.at(-2);

    const longSignal = trendUp &&
                       lastMACD.MACD > lastMACD.signal &&
                       lastStoch.k < 30 && lastStoch.k > lastStoch.d &&
                       lastRSI < 40 &&
                       closeNearLowerBand &&
                       isVolumeSpike &&
                       bullishCandle;

    const shortSignal = trendDown &&
                        lastMACD.MACD < lastMACD.signal &&
                        lastStoch.k > 70 && lastStoch.k < lastStoch.d &&
                        lastRSI > 60 &&
                        closeNearUpperBand &&
                        isVolumeSpike &&
                        bearishCandle;

    console.log(`[${symbol}] EMA50: ${ema50.at(-1).toFixed(4)} | EMA200: ${ema200.at(-1).toFixed(4)} | MACD: ${lastMACD.MACD.toFixed(4)} | Signal: ${lastMACD.signal.toFixed(4)} | RSI: ${lastRSI.toFixed(2)} | BB: ${lastBB.lower.toFixed(4)}-${lastBB.upper.toFixed(4)} | Vol: ${lastVolume.toFixed(2)} | AvgVol: ${avgVolume.toFixed(2)}`);

    if (longSignal) {
      console.log(`[${symbol}] 📈 Tín hiệu LONG`);
      await placeOrder(symbol, 'LONG', lastClose);
    } else if (shortSignal) {
      console.log(`[${symbol}] 📉 Tín hiệu SHORT`);
      await placeOrder(symbol, 'SHORT', lastClose);
    } else {
      console.log(`[${symbol}] ⏳ Không có tín hiệu chất lượng`);
    }

  } catch (err) {
    console.error(`[${symbol}] ❌ Lỗi phân tích:`, err.message);
  }
}

// ✅ Khởi động bot cho nhiều coin
(async () => {
  try {
    const account = await binance.futuresAccount();
    console.log("✅ Kết nối thành công!");
    console.log(`💰 Số dư: ${account.totalWalletBalance}`);

    const runAll = () => symbols.forEach(symbol => checkSignal(symbol));
    runAll(); // chạy ngay lập tức
    setInterval(runAll, 5 * 60 * 1000); // chạy mỗi 5 phút
  } catch (err) {
    console.error("❌ Lỗi khởi động:", err.message);
  }
})();
