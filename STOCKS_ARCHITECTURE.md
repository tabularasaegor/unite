# AlgoTrader — T-Investments Stock Trading Extension Architecture

## Overview
Extend AlgoTrader with stock trading via T-Investments (Tinkoff Invest) API v2.
Features: multi-strategy engine (scalping, momentum, mean-reversion), portfolio optimization (Markowitz, risk parity), advanced risk management.

## T-Investments API Details

### SDK: `tinkoff-invest-api` (npm)
```ts
import { TinkoffInvestApi } from 'tinkoff-invest-api';
const api = new TinkoffInvestApi({ token: '<token>' });

// Accounts
const { accounts } = await api.users.getAccounts({});

// Portfolio
const portfolio = await api.operations.getPortfolio({
  accountId: accounts[0].id,
  currency: PortfolioRequest_CurrencyRequest.RUB
});

// Instruments search
const { instruments } = await api.instruments.shares({
  instrumentStatus: InstrumentStatus.INSTRUMENT_STATUS_BASE
});

// Candles
const { candles } = await api.marketdata.getCandles({
  instrumentId: '<uid>',
  interval: CandleInterval.CANDLE_INTERVAL_1_MIN,
  ...api.helpers.fromTo('-5m'),
});

// Place order
const order = await account.postOrder({
  figi: '<figi>',
  quantity: 1,
  price: api.helpers.toQuotation(100),
  direction: OrderDirection.ORDER_DIRECTION_BUY,
  orderType: OrderType.ORDER_TYPE_LIMIT,
  orderId: '<random-id>',
});

// Streams
api.stream.market.candles({ instruments: [...] }, candle => {});
api.stream.market.trades({ instruments: [...] }, trade => {});
api.stream.market.orderBook({ instruments: [...] }, ob => {});
api.stream.market.lastPrice({ instruments: [...] }, lp => {});
```

### Helpers
- `Helpers.toQuotation(number)` — e.g. 123.4 -> { units: 123, nano: 400000000 }
- `Helpers.toNumber(quotation)` — reverse
- `Helpers.toMoneyValue(number, currency)` — with currency
- `Helpers.fromTo(offset)` — time interval helper

### WebSocket
- URL: `wss://invest-public-api.tinkoff.ru/ws/`
- Auth: `Authorization: Bearer <token>` header
- Channels: subscribeCandlesRequest, subscribeOrderBookRequest, subscribeTradesRequest, subscribeLastPriceRequest
- Price format: `{ units: string, nano: number }` — Quotation type

### Sandbox
- `new SandboxAccount(api, sandboxAccountId)` — same interface as real
- Use for paper trading

### Environment Variables
- `TINVEST_TOKEN` — main API token
- `TINVEST_ACCOUNT_ID` — optional account ID
- `TINVEST_SANDBOX` — "true" for sandbox mode

## New Schema (add to shared/schema.ts)

### stockInstruments table
Caches instrument metadata from T-Investments
- id, figi, instrumentId (uid), ticker, name, currency, lot, minPriceIncrement, sector, exchange, classCode, isin, instrumentType (share/etf/bond), tradingStatus

### stockCandles table  
Historical candle data for strategies
- id, instrumentId, interval (1min/5min/15min/1h/day), open, high, low, close, volume, timestamp

### stockPortfolios table
Portfolio optimization results
- id, name, strategy (markowitz/riskParity/equalWeight/custom), instruments (JSON text), weights (JSON text), expectedReturn, expectedRisk, sharpeRatio, lastOptimizedAt

### stockStrategies table
Active trading strategies
- id, name, type (scalping/momentum/meanReversion/aiEnsemble), status (active/paused/stopped), instruments (JSON text), params (JSON text — strategy-specific params), pnl, tradesCount, winRate, createdAt, updatedAt

### stockSignals table
Trading signals from strategies
- id, strategyId, instrumentId, ticker, action (buy/sell/hold), price, targetPrice, stopLoss, confidence, reasoning, executedAt, createdAt

## Backend Services

### 1. server/services/tInvestments.ts
T-Investments API client wrapper:
- `initClient()` — create TinkoffInvestApi with token
- `getAccounts()` — list accounts
- `getPortfolio(accountId)` — get positions
- `searchInstruments(query)` — find stocks
- `getShares()` — list all available shares
- `getCandles(instrumentId, interval, from, to)` — historical data
- `getOrderbook(instrumentId, depth)` — L2 data
- `getLastPrices(instrumentIds)` — batch last prices
- `postLimitOrder(accountId, instrumentId, lots, price, direction)` — limit order
- `postMarketOrder(accountId, instrumentId, lots, direction)` — market order
- `cancelOrder(accountId, orderId)` — cancel
- `getOrders(accountId)` — active orders
- `getPositions(accountId)` — current positions
- `subscribeCandles(instruments, callback)` — stream
- `subscribeTrades(instruments, callback)` — stream
- `subscribeOrderBook(instruments, callback)` — stream
- `getCapabilities()` — check what's available

### 2. server/services/portfolioOptimizer.ts
Portfolio optimization engine:
- `calculateReturns(candles)` — log returns from candle data
- `covarianceMatrix(returns)` — NxN covariance matrix
- `correlationMatrix(returns)` — correlation matrix
- `markowitzOptimize(returns, targetReturn?)` — mean-variance optimization
  - Minimize: w'Σw (portfolio variance)
  - Subject to: w'μ = targetReturn, Σw = 1, w >= 0
  - Use quadratic programming (iterative gradient descent)
- `riskParityWeights(covariance)` — equal risk contribution
  - Each asset contributes equally to portfolio risk
  - w_i * (Σw)_i / (w'Σw) = 1/N
- `equalWeightPortfolio(n)` — 1/N allocation
- `efficientFrontier(returns, points)` — generate frontier curve
- `calculateVaR(returns, confidence, horizon)` — Value at Risk
- `calculateCVaR(returns, confidence)` — Conditional VaR
- `sharpeRatio(returns, riskFreeRate)` — risk-adjusted return
- `maxDrawdown(equityCurve)` — maximum drawdown
- `rebalancePortfolio(current, target)` — generate rebalance orders

### 3. server/services/stockStrategies.ts
Multi-strategy engine:

#### Scalping Strategy
- Parameters: tickerList, timeframe (1min), profitTarget (0.1-0.3%), stopLoss (0.15%), maxHoldTime (5min), minVolume, spreadFilter
- Signals: VWAP cross, orderbook imbalance, momentum burst
- Entry: price crosses VWAP with volume confirmation
- Exit: target hit, stop hit, or time expiry

#### Momentum Strategy  
- Parameters: lookback (20 bars), timeframe (15min/1h), momentumThreshold (2%), trailingStop (1.5%)
- Signals: RSI breakout (>70 buy, <30 sell), MACD crossover, price breaking N-period high/low
- Position sizing: ATR-based

#### Mean Reversion Strategy
- Parameters: lookback (20), timeframe (1h/4h), deviationThreshold (2σ), meanType (SMA/EMA)
- Signals: Bollinger Band touch, RSI oversold/overbought, z-score > 2
- Entry: price > 2σ from mean → sell, price < 2σ → buy
- Exit: return to mean

#### AI Ensemble (reuse existing)
- Feed stock data to AI models for sentiment + fundamental analysis

### 4. server/services/riskManager.ts
Risk management module:
- `positionSize(capital, risk%, stopDistance)` — Kelly/fixed fractional
- `checkDrawdownLimit(equity, maxDrawdown%)` — circuit breaker
- `checkDailyLossLimit(dayPnl, limit)` — daily stop
- `checkCorrelation(newTrade, existingPositions)` — concentration risk
- `checkMaxPositions(current, max)` — position count limit
- `checkMaxExposure(totalExposure, maxExposure)` — gross exposure
- `calculatePortfolioVaR(positions, confidence)` — portfolio-level VaR
- `checkSectorExposure(positions, maxSectorPct)` — sector limits
- `generateRiskReport()` — summary metrics

## API Routes (add to routes.ts)

### Stock Instruments
- `GET /api/stocks/instruments` — list cached instruments (with filters)
- `GET /api/stocks/instruments/search?q=` — search by ticker/name
- `POST /api/stocks/instruments/sync` — sync from T-Investments

### Stock Market Data
- `GET /api/stocks/candles/:instrumentId` — get candles (query: interval, from, to)
- `GET /api/stocks/orderbook/:instrumentId` — get orderbook
- `GET /api/stocks/prices` — batch last prices

### Stock Trading
- `POST /api/stocks/orders` — place order (body: instrumentId, lots, price?, direction, type)
- `DELETE /api/stocks/orders/:orderId` — cancel order
- `GET /api/stocks/orders` — list active orders
- `GET /api/stocks/positions` — get T-Investments positions

### Portfolio Optimization
- `GET /api/stocks/portfolio` — current portfolio with analytics
- `POST /api/stocks/portfolio/optimize` — run optimization (body: instruments[], strategy, constraints)
- `GET /api/stocks/portfolio/frontier` — efficient frontier data
- `GET /api/stocks/portfolio/risk` — risk metrics (VaR, CVaR, drawdown, correlation matrix)
- `POST /api/stocks/portfolio/rebalance` — generate rebalance orders

### Strategies
- `GET /api/stocks/strategies` — list strategies
- `POST /api/stocks/strategies` — create strategy
- `PATCH /api/stocks/strategies/:id` — update strategy params
- `POST /api/stocks/strategies/:id/start` — activate strategy
- `POST /api/stocks/strategies/:id/stop` — deactivate
- `GET /api/stocks/signals` — recent signals
- `POST /api/stocks/signals/:id/execute` — manually execute signal

### Risk
- `GET /api/stocks/risk/report` — risk dashboard metrics
- `GET /api/stocks/risk/correlation` — correlation matrix

## Frontend Pages

### Stocks Dashboard (new page /stocks)
- Stock search + watchlist
- Real-time prices (streaming)
- Quick order panel
- Active signals from strategies

### Portfolio (new page /portfolio)
- Pie chart of current allocation
- Efficient frontier visualization
- Optimization controls (strategy selector, run button)
- Risk metrics cards (VaR, Sharpe, Max Drawdown)
- Correlation matrix heatmap
- Rebalance suggestions

### Strategies (new page /strategies)  
- Strategy cards with status, P&L, win rate
- Create/edit strategy modal
- Strategy-specific parameter forms
- Signal log with execute buttons
- Performance chart per strategy

## Technical Notes
- Price type: Quotation { units: string, nano: number } — use helpers
- Lot size varies by instrument
- Min price increment matters for order placement
- T-Investments rate limits: ~200 req/min for unary, streams are separate
- Moscow Exchange hours: 06:50-23:50 MSK (pre-market 06:50-09:59, main 10:00-18:39, post-market 19:05-23:50)
- Candle intervals: 1min, 2min, 3min, 5min, 10min, 15min, 30min, hour, 2hour, 4hour, day, week, month
