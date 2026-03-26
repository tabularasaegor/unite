# Backend Services — Build Status

## Files Created/Modified

### 1. server/routes.ts — Complete API Routes (558 lines)
All routes from ARCHITECTURE.md implemented:

**Auth (3 routes):**
- POST /api/auth/register — SHA-256 password hashing, auto-login, cookie token
- POST /api/auth/login — Validates credentials, returns cookie token
- GET /api/auth/check — Token validation from cookie header

**Config (2 routes):**
- GET /api/config — Returns all config with 12 defaults
- PUT /api/config/:key — Updates config value

**Micro (9 routes):**
- GET /api/micro/dashboard — Full KPIs + asset breakdown + scheduler status
- GET /api/micro/positions?status=open|closed|all
- GET /api/micro/trades — Executions filtered to micro positions
- GET /api/micro/settlements — Settlements for micro positions
- GET /api/micro/model-log?asset= — Model decision log
- GET /api/micro/strategy-performance — Thompson Sampling stats
- POST /api/micro/scheduler/start — Starts 30s tick loop
- POST /api/micro/scheduler/stop — Stops scheduler
- GET /api/micro/scheduler/status — Running state + window timing

**Pipeline (6 routes):**
- GET /api/pipeline/dashboard — Stage breakdown + P&L
- GET /api/pipeline/opportunities — With stage/category/status filters
- POST /api/pipeline/scan — Triggers Gamma API scan
- GET /api/pipeline/positions, /trades, /settlements, /postmortems

**Other (2 routes):**
- GET /api/audit?limit=200
- GET /api/performance-snapshots?source=micro|pipeline

### 2. server/services/polymarketApi.ts (318 lines)
- `getUpcomingSlug(asset, windowsAhead)` — Slug computation
- `fetchEventBySlug(slug)` — Gamma API integration with full parsing
- `getMidpoints(tokenIds)` — Batch CLOB midpoints
- `getMidpoint(tokenId)` — Single midpoint
- `getOrderBook(tokenId)` — Full orderbook
- `getPriceHistory(tokenId, interval, fidelity)` — Price history for TA
- `fetchResolvedEvent(slug)` — Resolution check
- `getActiveWindows(assets)` — Current + next windows
- `computeOBI(book, levels)` — Order Book Imbalance calculation

### 3. server/services/microEngine.ts (874 lines)
Full adaptive multi-strategy engine:
- 5 strategies: Contrarian, Momentum (RSI+EMA), Mean Reversion (RSI14), OBI, Alternating
- Thompson Sampling with Beta distribution sampling (Marsaglia & Tsang gamma method)
- Quality control: 95% CI lower bound check, auto-disable/re-enable
- Adaptive bet sizing: edge-based + multiplier + drawdown brake
- Asset cooldowns: WR<30% over last 5 → 10min cooldown
- Discounting: λ=0.995 per trade
- Settlement: auto-settle with 20s delay, force-settle after 2min
- Calibration from history on startup
- Scheduler: 30s interval, window-aware trading

### 4. server/services/pipelineEngine.ts (263 lines)
- `scanMarkets()` — Gamma API pagination with category detection + filters
- `runResearch(opportunityId)` — Placeholder for AI research
- `getPipelineDashboard()` — Stage breakdown + P&L stats

## Key Design Decisions
- ensureSchema() called in registerRoutes() (since index.ts is read-only)
- Auth via cookie-based tokens stored in memory_store
- 60-minute sliding window session TTL
- All user-facing API messages in Russian
- Express 5 compatibility (string|string[] params)

## TypeScript: 0 server-side errors
