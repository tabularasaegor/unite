# AlgoTrader v3 — Architecture

## Trading Engine: Adaptive Multi-Strategy with Thompson Sampling

### Strategy Pool (5 strategies)
1. **Contrarian** — bet against crowd when market deviates >3% from 50/50
2. **Momentum** — use RSI(5) + EMA(5,15) crossover on 1-min candles
3. **Mean Reversion** — RSI(14) oversold/overbought on 5-min candles
4. **OBI (Order Book Imbalance)** — bid/ask volume ratio from CLOB orderbook
5. **Alternating** — parity-based fallback to avoid bias

### Strategy Selection: Thompson Sampling (MAB)
- Each strategy+asset combo has Beta(α, β) posterior
- On each window: sample from each strategy's posterior, pick highest
- Win → α += 1; Loss → β += 1
- Discounting: λ=0.995 per trade (forget stale data)
- "Skip" arm included — if Skip wins, no trade placed

### Confidence Gating
- Each strategy outputs confidence [0, 1]
- Trade only if confidence > 0.52 (configurable)
- AI validation: short prompt, agree/disagree affects bet size not direction

### Adaptive Bet Sizing
- Base: % of max_bet by edge (<2%→25%, 2-5%→50%, 5-10%→75%, >10%→100%)
- betSizeMultiplier: 0.3x–1.5x, adjusted per window outcome
- Drawdown brake: cap 0.5x if loss >30% from session peak
- Min bet: $3

### Quality Control (Bayesian)
- Per-strategy Beta-Binomial posterior tracking
- If 95% CI lower bound < 0.48 → disable strategy for that asset
- Re-enable after 30 minutes cooldown
- CALIBRATION_AUDIT logged on every startup

### Asset Cooldown
- WR < 30% over last 5 trades → 10 min cooldown per asset

### Settlement
- Force-settle after 2 min if CLOB unresponsive
- Check resolved events via Gamma API ~20s after window end

## Polymarket Integration
- Gamma API: slug pattern `{asset}-updown-5m-{unix_end}`
- CLOB API: /midpoint, /book, /price endpoints
- Pre-fetch next window token IDs before current closes
- Paper mode: simulate at midpoint prices

## API Routes
- POST /api/auth/login, /api/auth/register, GET /api/auth/check
- GET /api/config, PUT /api/config/:key
- GET /api/micro/dashboard — KPIs, P&L, strategy stats
- GET /api/micro/positions?status=open|closed|all
- GET /api/micro/trades
- GET /api/micro/settlements  
- GET /api/micro/model-log
- GET /api/micro/strategy-performance
- POST /api/micro/scheduler/start, /api/micro/scheduler/stop
- GET /api/micro/scheduler/status
- GET /api/pipeline/dashboard
- GET /api/pipeline/opportunities
- POST /api/pipeline/scan
- GET /api/pipeline/positions, /trades, /settlements, /postmortems
- GET /api/audit
- GET /api/performance-snapshots

## UI Pages (Russian)
### Sidebar sections:
ПАЙПЛАЙН: Дашборд, Сканер, Возможности, Риск-консоль, Позиции, Сделки, Расчёты, Пост-мортем
КРИПТО 5-МИН: Панель управления, Позиции, Сделки, Расчёты
Общее: Аудит, Настройки
