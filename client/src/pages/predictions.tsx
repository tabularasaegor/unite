import { useQuery } from "@tanstack/react-query";
import type { Prediction } from "@shared/schema";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

export default function Predictions() {
  const { data: predictions, isLoading } = useQuery<Prediction[]>({
    queryKey: ["/api/predictions"],
  });

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-6 max-w-[1400px] mx-auto space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground">AI Predictions</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Multi-model ensemble analysis: GPT-4o (40%) + Claude 3.5 (35%) + Gemini 1.5 (25%)</p>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-48 rounded-lg" />)}
          </div>
        ) : predictions && predictions.length > 0 ? (
          <div className="space-y-4">
            {predictions.map((pred) => {
              const models = [
                { name: "GPT-4o", prob: pred.gptProbability || 0, weight: "40%", color: "hsl(210, 100%, 55%)" },
                { name: "Claude 3.5", prob: pred.claudeProbability || 0, weight: "35%", color: "hsl(262, 60%, 55%)" },
                { name: "Gemini 1.5", prob: pred.geminiProbability || 0, weight: "25%", color: "hsl(160, 65%, 48%)" },
              ];
              const barData = models.map(m => ({
                name: m.name,
                probability: Math.round(m.prob * 100),
                color: m.color,
              }));

              return (
                <div key={pred.id} className="bg-card border border-card-border rounded-lg p-5" data-testid={`prediction-card-${pred.id}`}>
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-semibold text-foreground">{pred.marketName}</h3>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {new Date(pred.createdAt).toLocaleString("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 ml-3">
                      <Badge
                        variant="outline"
                        className={`text-[10px] h-5 ${
                          pred.action?.startsWith("buy") ? "border-[hsl(var(--profit))]/30 text-profit" : "border-[hsl(var(--loss))]/30 text-loss"
                        }`}
                      >
                        {pred.action?.replace("_", " ").toUpperCase()}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={`text-[10px] h-5 ${
                          pred.confidence === "high" ? "border-[hsl(var(--profit))]/30 text-profit" :
                          pred.confidence === "medium" ? "border-[hsl(var(--chart-4))]/30 text-[hsl(var(--chart-4))]" :
                          ""
                        }`}
                      >
                        {pred.confidence}
                      </Badge>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
                    {/* Model comparison */}
                    <div>
                      <div className="grid grid-cols-3 gap-3 mb-3">
                        {models.map((m) => (
                          <div key={m.name} className="text-center p-2 rounded-md bg-muted/30">
                            <div className="text-xs text-muted-foreground mb-0.5">{m.name} ({m.weight})</div>
                            <div className="text-lg font-semibold tabular-nums text-foreground">{(m.prob * 100).toFixed(0)}%</div>
                          </div>
                        ))}
                      </div>

                      <div className="flex items-center gap-4 text-sm mt-3">
                        <div className="flex items-center gap-1.5">
                          <span className="text-muted-foreground">Ensemble:</span>
                          <span className="font-semibold tabular-nums text-foreground">{((pred.ensembleProbability || 0) * 100).toFixed(0)}%</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-muted-foreground">Market:</span>
                          <span className="tabular-nums text-foreground">{((pred.marketPrice || 0) * 100).toFixed(0)}%</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-muted-foreground">Edge:</span>
                          <span className={`font-semibold tabular-nums ${(pred.edge || 0) > 0 ? "text-profit" : "text-loss"}`}>
                            {((pred.edge || 0) * 100).toFixed(1)}%
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Mini bar chart */}
                    <div>
                      <ResponsiveContainer width="100%" height={100}>
                        <BarChart data={barData} layout="vertical">
                          <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                          <YAxis dataKey="name" type="category" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" width={70} />
                          <Tooltip
                            contentStyle={{
                              background: "hsl(var(--card))",
                              border: "1px solid hsl(var(--border))",
                              borderRadius: "6px",
                              fontSize: "12px",
                            }}
                            formatter={(value: number) => [`${value}%`, "Probability"]}
                          />
                          <Bar dataKey="probability" radius={[0, 4, 4, 0]}>
                            {barData.map((entry, i) => (
                              <Cell key={i} fill={entry.color} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* Reasoning */}
                  {pred.reasoning && (
                    <div className="mt-3 pt-3 border-t border-border">
                      <p className="text-xs text-muted-foreground leading-relaxed">{pred.reasoning}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="bg-card border border-card-border rounded-lg py-12 text-center text-sm text-muted-foreground">
            No AI predictions yet. Load demo data from the Dashboard.
          </div>
        )}
      </div>
    </div>
  );
}
