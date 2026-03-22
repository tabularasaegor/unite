import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import KpiCard from "@/components/KpiCard";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";
import {
  DollarSign,
  TrendingUp,
  Target,
  BarChart3,
  Crosshair,
  Zap,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts";
import type { PerformanceSnapshot, Position, Prediction } from "@shared/schema";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useQuery<{
    totalPnl: number;
    portfolioValue: number;
    winRate: number;
    totalTrades: number;
    openPositions: number;
    avgEdge: number;
  }>({ queryKey: ["/api/stats"], refetchInterval: 10000 });

  const { data: performance, isLoading: perfLoading } = useQuery<PerformanceSnapshot[]>({
    queryKey: ["/api/performance"],
  });

  const { data: positions } = useQuery<Position[]>({
    queryKey: ["/api/positions"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/positions?status=open");
      return res.json();
    },
  });

  const { data: predictions } = useQuery<Prediction[]>({
    queryKey: ["/api/predictions"],
  });

  const seedMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/seed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/performance"] });
      queryClient.invalidateQueries({ queryKey: ["/api/positions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/predictions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/markets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trades"] });
    },
  });

  const chartData = performance
    ?.slice()
    .reverse()
    .map((s) => ({
      date: new Date(s.timestamp).toLocaleDateString("en", { month: "short", day: "numeric" }),
      pnl: s.totalPnl,
      value: s.portfolioValue,
      winRate: Math.round(s.winRate * 10) / 10,
    }));

  const needsSeed = !statsLoading && stats && stats.totalTrades === 0;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-6 max-w-[1400px] mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Dashboard</h1>
            <p className="text-sm text-muted-foreground mt-0.5">AI Ensemble Trading Bot Overview</p>
          </div>
          <div className="flex items-center gap-3">
            {needsSeed && (
              <button
                onClick={() => seedMutation.mutate()}
                disabled={seedMutation.isPending}
                className="px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
                data-testid="button-seed"
              >
                {seedMutation.isPending ? "Loading..." : "Load Demo Data"}
              </button>
            )}
            <Badge
              variant="outline"
              className="gap-1.5 text-xs font-medium border-[hsl(var(--profit))]/30 text-profit bg-profit\/10"
              data-testid="badge-bot-status"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-profit animate-pulse" />
              Bot Running
            </Badge>
          </div>
        </div>

        {/* KPI Cards */}
        {statsLoading ? (
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-lg" />
            ))}
          </div>
        ) : stats ? (
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            <KpiCard
              label="Total P&L"
              value={`$${stats.totalPnl.toFixed(2)}`}
              change={`${stats.totalPnl >= 0 ? "+" : ""}${((stats.totalPnl / 1000) * 100).toFixed(1)}%`}
              isPositive={stats.totalPnl >= 0}
              icon={DollarSign}
              testId="kpi-total-pnl"
            />
            <KpiCard
              label="Portfolio"
              value={`$${stats.portfolioValue.toFixed(2)}`}
              icon={TrendingUp}
              testId="kpi-portfolio"
            />
            <KpiCard
              label="Win Rate"
              value={`${stats.winRate}%`}
              isPositive={stats.winRate >= 50}
              icon={Target}
              testId="kpi-win-rate"
            />
            <KpiCard
              label="Total Trades"
              value={String(stats.totalTrades)}
              icon={BarChart3}
              testId="kpi-total-trades"
            />
            <KpiCard
              label="Open Positions"
              value={String(stats.openPositions)}
              icon={Crosshair}
              testId="kpi-open-positions"
            />
            <KpiCard
              label="Avg Edge"
              value={`${(stats.avgEdge * 100).toFixed(1)}%`}
              isPositive={stats.avgEdge > 0}
              icon={Zap}
              testId="kpi-avg-edge"
            />
          </div>
        ) : null}

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Portfolio Value Chart */}
          <div className="bg-card border border-card-border rounded-lg p-4">
            <h3 className="text-sm font-medium text-foreground mb-3">Portfolio Value</h3>
            {perfLoading ? (
              <Skeleton className="h-52" />
            ) : chartData && chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={210}>
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="portfolioGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(210, 100%, 55%)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(210, 100%, 55%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "6px",
                      fontSize: "12px",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke="hsl(210, 100%, 55%)"
                    fill="url(#portfolioGrad)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-52 flex items-center justify-center text-sm text-muted-foreground">No data yet</div>
            )}
          </div>

          {/* P&L Chart */}
          <div className="bg-card border border-card-border rounded-lg p-4">
            <h3 className="text-sm font-medium text-foreground mb-3">Cumulative P&L</h3>
            {perfLoading ? (
              <Skeleton className="h-52" />
            ) : chartData && chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={210}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "6px",
                      fontSize: "12px",
                    }}
                  />
                  <Line type="monotone" dataKey="pnl" stroke="hsl(160, 65%, 50%)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-52 flex items-center justify-center text-sm text-muted-foreground">No data yet</div>
            )}
          </div>
        </div>

        {/* Bottom Row: Open Positions & Latest Predictions */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Open Positions */}
          <div className="bg-card border border-card-border rounded-lg p-4">
            <h3 className="text-sm font-medium text-foreground mb-3">Open Positions</h3>
            {positions && positions.length > 0 ? (
              <div className="space-y-2">
                {positions.filter(p => p.status === "open").slice(0, 5).map((pos) => (
                  <div key={pos.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{pos.marketName}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant="outline" className="text-[10px] h-5">{pos.side}</Badge>
                        <span className="text-xs text-muted-foreground">{pos.platform}</span>
                      </div>
                    </div>
                    <div className="text-right ml-3">
                      <p className={`text-sm font-medium tabular-nums ${(pos.pnl || 0) >= 0 ? "text-profit" : "text-loss"}`}>
                        {(pos.pnl || 0) >= 0 ? "+" : ""}{(pos.pnl || 0).toFixed(2)} USDC
                      </p>
                      <p className={`text-xs tabular-nums ${(pos.pnlPercent || 0) >= 0 ? "text-profit" : "text-loss"}`}>
                        {(pos.pnlPercent || 0) >= 0 ? "+" : ""}{(pos.pnlPercent || 0).toFixed(1)}%
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-8 text-center text-sm text-muted-foreground">No open positions</div>
            )}
          </div>

          {/* Latest AI Predictions */}
          <div className="bg-card border border-card-border rounded-lg p-4">
            <h3 className="text-sm font-medium text-foreground mb-3">Latest AI Predictions</h3>
            {predictions && predictions.length > 0 ? (
              <div className="space-y-2">
                {predictions.slice(0, 4).map((pred) => (
                  <div key={pred.id} className="py-2 border-b border-border last:border-0">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm font-medium text-foreground truncate flex-1">{pred.marketName}</p>
                      <Badge
                        variant="outline"
                        className={`text-[10px] h-5 ml-2 ${
                          pred.confidence === "high" ? "border-[hsl(var(--profit))]/30 text-profit" :
                          pred.confidence === "medium" ? "border-[hsl(var(--chart-4))]/30 text-[hsl(var(--chart-4))]" :
                          "border-muted-foreground/30"
                        }`}
                      >
                        {pred.confidence}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="tabular-nums">Ensemble: {((pred.ensembleProbability || 0) * 100).toFixed(0)}%</span>
                      <span className="tabular-nums">Market: {((pred.marketPrice || 0) * 100).toFixed(0)}%</span>
                      <span className={`font-medium tabular-nums ${(pred.edge || 0) > 0 ? "text-profit" : "text-loss"}`}>
                        Edge: {((pred.edge || 0) * 100).toFixed(1)}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-8 text-center text-sm text-muted-foreground">No predictions yet</div>
            )}
          </div>
        </div>

        <PerplexityAttribution />
      </div>
    </div>
  );
}
