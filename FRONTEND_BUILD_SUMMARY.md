# AlgoTrader v3 — Frontend Build Summary

## Files Created / Modified

### Core Files
- `client/src/index.css` — Dark trading theme (slate-900 base, sky-500 primary, green/red for P&L)
- `client/src/main.tsx` — Dark mode default, history.replaceState for hash routing
- `client/src/App.tsx` — Full routing with auth gate, 16 routes, SidebarProvider layout
- `client/src/lib/queryClient.ts` — staleTime: 30000, 401 handling with custom event dispatch
- `client/src/lib/auth-context.tsx` — React context auth (no localStorage), login/register/logout/checkAuth

### Components
- `client/src/components/AppSidebar.tsx` — Full sidebar with ПАЙПЛАЙН and КРИПТО 5-МИН sections, theme toggle, logout
- `client/src/components/shared.tsx` — KPICard, StatusBadge, PnLDisplay, DataTable, PageHeader, ModelLogPanel, formatDate

### Pages (16 total)
1. `pages/login.tsx` — Login/register with toggle, centered card, SVG logo
2. `pages/micro-dashboard.tsx` — 4 KPI cards, scheduler control, 2 charts (Recharts), asset stats table, model log
3. `pages/micro-positions.tsx` — Tabbed (open/closed/all) positions table
4. `pages/micro-trades.tsx` — Executions table with type/direction badges
5. `pages/micro-settlements.tsx` — Settlements with outcome/P&L/correct indicators
6. `pages/pipeline-dashboard.tsx` — 4 KPIs, pipeline flow visualization, recent opportunities
7. `pages/scanner.tsx` — Scan button with loading, results table
8. `pages/opportunities.tsx` — Full opportunities table with advance action
9. `pages/risk-console.tsx` — Risk KPIs, drawdown progress bar, open positions exposure
10. `pages/pipeline-positions.tsx` — Tabbed pipeline positions
11. `pages/pipeline-trades.tsx` — Pipeline executions table
12. `pages/pipeline-settlements.tsx` — Pipeline settlements table
13. `pages/postmortems.tsx` — Post-mortem analysis cards with sections
14. `pages/audit.tsx` — Searchable audit log table
15. `pages/settings.tsx` — 4 config sections with independent save per field
16. `pages/not-found.tsx` — Russian 404 page

## Design
- Dark mode default (class-based toggle)
- HSL color system: sky-500 primary, emerald-500 profits, red-500 losses
- Inter + JetBrains Mono (via Google Fonts CDN in index.html)
- All text in Russian
- Mobile responsive (grid-cols-1 → sm:2 → lg:4, table scroll, sidebar Sheet)

## Technical Notes
- TypeScript compiles cleanly (tsc --noEmit: 0 errors)
- Vite build succeeds
- All interactive elements have data-testid attributes
- Hash routing with useHashLocation on Router
- No localStorage/cookies used for auth state
- apiRequest used for all API calls
- React Query with 30s staleTime
