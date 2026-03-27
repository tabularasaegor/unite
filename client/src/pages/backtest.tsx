import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { KPICard, PageHeader } from "@/components/shared";
import { useToast } from "@/hooks/use-toast";
import {
  FlaskConical,
  Play,
  Trophy,
  TrendingUp,
  TrendingDown,
  BarChart3,
  Loader2,
  Target,
  Activity,
  Rocket,
  RefreshCw,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// ─── Types ───────────────────────────────────────────────────────

interface BacktestResult {
  id?: number;
  strategyName: string;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  avgPnl: number;
  maxDrawdown: number;
  sharpeRatio: number;
  avgConfidence: number;
  rollingWr50: number[];
  runAt?: string;
  batchId?: string;
}

interface BacktestResponse {
  results: BacktestResult[];
  bestModel: string | null;
  timestamp: string | null;
  batchId?: string | null;
}

// ─── Strategy Name Map ───────────────────────────────────────────

const strategyLabels: Record<string, string> = {
  contrarian: "Контрарная",
  momentum: "Моментум",
  meanReversion: "Возврат к среднему",
  orderBookImbalance: "Дисбаланс стакана",
  marketFollow: "Следование за рынком",
  majorityVote: "Голосование большинства",
  confidenceWeighted: "Взвеш. по уверенности",
  top2Thompson: "Топ-2 Томпсона",
  dynamicThreshold: "Динам. порог",
};

const strategyColors: Record<string, string> = {
  contrarian: "#f59e0b",
  momentum: "#3b82f6",
  meanReversion: "#8b5cf6",
  orderBookImbalance: "#06b6d4",
  marketFollow: "#22c55e",
  majorityVote: "#10b981",
  confidenceWeighted: "#ec4899",
  top2Thompson: "#f97316",
  dynamicThreshold: "#14b8a6",
};

function getWrColorClass(wr: number): string {
  if (wr >= 0.55) return "text-emerald-400";
  if (wr >= 0.50) return "text-yellow-400";
  return "text-red-400";
}

function getWrBgClass(wr: number): string {
  if (wr >= 0.55) return "bg-emerald-500/10 border-emerald-500/20";
  if (wr >= 0.50) return "bg-yellow-500/10 border-yellow-500/20";
  return "bg-red-500/10 border-red-500/20";
}

// ─── Component ───────────────────────────────────────────────────

export default function BacktestPage() {
  const { toast } = useToast();

  // Fetch cached results
  const {
    data: cachedData,
    isLoading: isCachedLoading,
  } = useQuery<BacktestResponse>({
    queryKey: ["/api/backtest/results"],
  });

  // Run backtest mutation
  const runMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/backtest/run", { windows: 2000 });
      return (await res.json()) as BacktestResponse;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/backtest/results"] });
      toast({
        title: "Бэктест завершён",
        description: "Результаты обновлены",
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Ошибка бэктеста",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const applyAndStartMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/backtest/apply-priors");
      await apiRequest("POST", "/api/micro/scheduler/start");
    },
    onSuccess: () => {
      toast({
        title: "Торговля запущена",
        description: `Лучшая модель из бэктеста применена, планировщик запущен`,
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Ошибка запуска",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const data = cachedData;
  const results = data?.results || [];
  const bestModel = data?.bestModel;
  const hasResults = results.length > 0;

  // Build chart data for top 3 rolling WR
  const top3 = results.slice(0, 3);
  const chartData = buildChartData(top3);

  // KPI summary
  const bestResult = hasResults ? results[0] : null;
  const avgWr = hasResults
    ? results.reduce((s, r) => s + r.winRate, 0) / results.length
    : 0;
  const bestPnl = hasResults
    ? results.reduce((best, r) => (r.totalPnl > best.totalPnl ? r : best), results[0])
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Бэктестинг"
        subtitle="Сравнение стратегий на синтетических данных (GBM + Орнштейна-Уленбека)"
        actions={
          <div className="flex gap-2">
            {hasResults && (
              <Button
                onClick={() => applyAndStartMutation.mutate()}
                disabled={applyAndStartMutation.isPending}
                variant="default"
                className="bg-emerald-600 hover:bg-emerald-700"
                data-testid="button-apply-and-start"
              >
                {applyAndStartMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Запуск...
                  </>
                ) : (
                  <>
                    <Rocket className="h-4 w-4 mr-2" />
                    Запустить лучшую модель
                  </>
                )}
              </Button>
            )}
            <Button
              onClick={() => runMutation.mutate()}
              disabled={runMutation.isPending}
              variant="outline"
              data-testid="button-run-backtest"
            >
              {runMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Выполняется...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  Запустить бэктест
                </>
              )}
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/backtest/results"] })}
              data-testid="button-refresh"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        }
      />

      {/* Loading overlay during backtest run */}
      {runMutation.isPending && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex items-center justify-center py-8 gap-3">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <span className="text-sm text-muted-foreground">
              Симуляция 2000 окон по 5 минут... Это может занять несколько секунд.
            </span>
          </CardContent>
        </Card>
      )}

      {/* KPIs */}
      {hasResults && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard
            title="Лучшая модель"
            value={strategyLabels[bestResult!.strategyName] || bestResult!.strategyName}
            subtitle={`WR: ${(bestResult!.winRate * 100).toFixed(1)}%`}
            icon={<Trophy className="h-4 w-4" />}
            trend="up"
          />
          <KPICard
            title="Лучший WR"
            value={`${(bestResult!.winRate * 100).toFixed(1)}%`}
            subtitle={`${bestResult!.wins}/${bestResult!.totalTrades} сделок`}
            icon={<Target className="h-4 w-4" />}
            trend={bestResult!.winRate >= 0.5 ? "up" : "down"}
          />
          <KPICard
            title="Макс. PnL"
            value={`$${bestPnl!.totalPnl.toFixed(2)}`}
            subtitle={strategyLabels[bestPnl!.strategyName] || bestPnl!.strategyName}
            icon={<TrendingUp className="h-4 w-4" />}
            trend={bestPnl!.totalPnl >= 0 ? "up" : "down"}
          />
          <KPICard
            title="Средний WR (все)"
            value={`${(avgWr * 100).toFixed(1)}%`}
            subtitle={`${results.length} стратегий протестировано`}
            icon={<Activity className="h-4 w-4" />}
            trend={avgWr >= 0.5 ? "up" : "down"}
          />
        </div>
      )}

      {/* Rolling WR chart for top 3 */}
      {hasResults && chartData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Скользящий WR (50 окон) — Топ 3 стратегии
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted/30" />
                  <XAxis
                    dataKey="index"
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    label={{ value: "Окно", position: "insideBottom", offset: -5, fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  />
                  <YAxis
                    domain={[0.3, 0.7]}
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
                    label={{ value: "WR %", angle: -90, position: "insideLeft", offset: 10, fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "6px",
                      fontSize: "12px",
                    }}
                    labelFormatter={(v: number) => `Окно ${v}`}
                    formatter={(value: number, name: string) => [
                      `${(value * 100).toFixed(1)}%`,
                      strategyLabels[name] || name,
                    ]}
                  />
                  <Legend
                    formatter={(value: string) => strategyLabels[value] || value}
                    wrapperStyle={{ fontSize: "11px" }}
                  />
                  {/* Reference line at 50% */}
                  <Line
                    type="monotone"
                    dataKey="baseline"
                    stroke="hsl(var(--muted-foreground))"
                    strokeDasharray="4 4"
                    strokeWidth={1}
                    dot={false}
                    name="baseline"
                    legendType="none"
                  />
                  {top3.map((r) => (
                    <Line
                      key={r.strategyName}
                      type="monotone"
                      dataKey={r.strategyName}
                      stroke={strategyColors[r.strategyName] || "#888"}
                      strokeWidth={2}
                      dot={false}
                      name={r.strategyName}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Results Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <FlaskConical className="h-4 w-4" />
            Результаты бэктеста
            {data?.timestamp && (
              <span className="text-xs text-muted-foreground font-normal ml-2">
                {formatTimestamp(data.timestamp)}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isCachedLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !hasResults ? (
            <div className="text-center py-12 text-muted-foreground">
              <FlaskConical className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Нет результатов бэктеста</p>
              <p className="text-xs mt-1">
                Нажмите «Запустить бэктест» для симуляции
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      #
                    </TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Стратегия
                    </TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider text-muted-foreground text-right">
                      Сделки
                    </TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider text-muted-foreground text-right">
                      Победы
                    </TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider text-muted-foreground text-right">
                      Поражения
                    </TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider text-muted-foreground text-right">
                      WR
                    </TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider text-muted-foreground text-right">
                      PnL
                    </TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider text-muted-foreground text-right">
                      Ср. PnL
                    </TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider text-muted-foreground text-right">
                      Макс. просадка
                    </TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider text-muted-foreground text-right">
                      Шарп
                    </TableHead>
                    <TableHead className="text-xs font-medium uppercase tracking-wider text-muted-foreground text-right">
                      Ср. увер.
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.map((r, idx) => {
                    const isBest = r.strategyName === bestModel;
                    return (
                      <TableRow
                        key={r.strategyName}
                        className={isBest ? "bg-emerald-500/5" : undefined}
                        data-testid={`row-backtest-${r.strategyName}`}
                      >
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {idx + 1}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{
                                backgroundColor: strategyColors[r.strategyName] || "#888",
                              }}
                            />
                            <span className="text-sm font-medium">
                              {strategyLabels[r.strategyName] || r.strategyName}
                            </span>
                            {isBest && (
                              <Badge
                                variant="outline"
                                className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px] px-1.5 py-0"
                                data-testid="badge-best-model"
                              >
                                <Trophy className="h-3 w-3 mr-0.5" />
                                Лучшая модель
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {r.totalTrades}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm text-emerald-400">
                          {r.wins}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm text-red-400">
                          {r.losses}
                        </TableCell>
                        <TableCell className="text-right">
                          <span
                            className={`font-mono text-sm font-semibold ${getWrColorClass(r.winRate)}`}
                          >
                            {(r.winRate * 100).toFixed(1)}%
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <span
                            className={`font-mono text-sm font-medium ${
                              r.totalPnl >= 0 ? "text-emerald-400" : "text-red-400"
                            }`}
                          >
                            {r.totalPnl >= 0 ? "+" : ""}${r.totalPnl.toFixed(2)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <span
                            className={`font-mono text-sm ${
                              r.avgPnl >= 0 ? "text-emerald-400" : "text-red-400"
                            }`}
                          >
                            ${r.avgPnl.toFixed(2)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm text-red-400">
                          ${r.maxDrawdown.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right">
                          <span
                            className={`font-mono text-sm ${
                              r.sharpeRatio >= 0
                                ? "text-emerald-400"
                                : "text-red-400"
                            }`}
                          >
                            {r.sharpeRatio.toFixed(2)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm text-muted-foreground">
                          {(r.avgConfidence * 100).toFixed(1)}%
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Strategy Type Legend */}
      {hasResults && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Описание стратегий</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {strategyDescriptions.map((sd) => {
                const result = results.find((r) => r.strategyName === sd.key);
                return (
                  <div
                    key={sd.key}
                    className={`p-3 rounded-lg border ${
                      result ? getWrBgClass(result.winRate) : "bg-muted/20 border-muted/30"
                    }`}
                    data-testid={`card-strategy-${sd.key}`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <div
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: strategyColors[sd.key] || "#888" }}
                      />
                      <span className="text-xs font-semibold">
                        {strategyLabels[sd.key] || sd.key}
                      </span>
                      {sd.isEnsemble && (
                        <Badge
                          variant="outline"
                          className="text-[9px] px-1 py-0 border-primary/30 text-primary"
                        >
                          Ансамбль
                        </Badge>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      {sd.description}
                    </p>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Chart Data Builder ──────────────────────────────────────────

function buildChartData(top3: BacktestResult[]): Record<string, number>[] {
  if (top3.length === 0) return [];

  // Find max length across all rolling WR arrays
  const maxLen = Math.max(...top3.map((r) => r.rollingWr50?.length || 0));
  if (maxLen === 0) return [];

  // Sample every Nth point to avoid chart clutter (max ~200 points)
  const step = Math.max(1, Math.floor(maxLen / 200));

  const data: Record<string, number>[] = [];
  for (let i = 0; i < maxLen; i += step) {
    const point: Record<string, number> = { index: i + 50, baseline: 0.5 };
    for (const r of top3) {
      if (r.rollingWr50 && r.rollingWr50[i] !== undefined) {
        point[r.strategyName] = r.rollingWr50[i];
      }
    }
    data.push(point);
  }

  return data;
}

// ─── Helpers ─────────────────────────────────────────────────────

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return ts;
  }
}

const strategyDescriptions = [
  {
    key: "contrarian",
    description: "Ставит против большинства, когда рынок отклоняется >3% от 50/50",
    isEnsemble: false,
  },
  {
    key: "momentum",
    description: "RSI(5) + пересечение EMA(5/15) для сигналов импульса",
    isEnsemble: false,
  },
  {
    key: "meanReversion",
    description: "RSI(14) — развороты при перепроданности/перекупленности",
    isEnsemble: false,
  },
  {
    key: "orderBookImbalance",
    description: "Дисбаланс книги ордеров (OBI > 0.15) для направленного сигнала",
    isEnsemble: false,
  },
  {
    key: "marketFollow",
    description: "Следует за большинством рынка — ставит в направлении доминирующего мнения",
    isEnsemble: false,
  },
  {
    key: "majorityVote",
    description: "Запускает все 5 стратегий и выбирает направление большинства",
    isEnsemble: true,
  },
  {
    key: "confidenceWeighted",
    description: "Взвешивает голоса стратегий по их уверенности",
    isEnsemble: true,
  },
  {
    key: "top2Thompson",
    description: "Выбирает 2 лучших стратегии по Томпсону на каждом окне",
    isEnsemble: true,
  },
  {
    key: "dynamicThreshold",
    description: "Адаптирует пороги уверенности по скользящему WR стратегии",
    isEnsemble: true,
  },
];
