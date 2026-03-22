import { useQuery } from "@tanstack/react-query";
import type { Market } from "@shared/schema";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart3, ExternalLink } from "lucide-react";

export default function Markets() {
  const { data: markets, isLoading } = useQuery<Market[]>({
    queryKey: ["/api/markets"],
  });

  const polymarkets = markets?.filter(m => m.platform === "polymarket") || [];
  const exchanges = markets?.filter(m => m.platform !== "polymarket") || [];

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-6 max-w-[1400px] mx-auto space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Markets</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Monitored prediction markets and crypto pairs</p>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
          </div>
        ) : (
          <>
            {/* Polymarket Section */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2 h-2 rounded-full bg-primary" />
                <h2 className="text-sm font-medium text-foreground">Polymarket — Prediction Markets</h2>
                <Badge variant="outline" className="text-[10px] h-5">{polymarkets.length}</Badge>
              </div>
              <div className="bg-card border border-card-border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">Market</th>
                      <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">Market Price</th>
                      <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">AI Prediction</th>
                      <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">Edge</th>
                      <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">Volume 24h</th>
                      <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {polymarkets.map((m) => (
                      <tr key={m.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors" data-testid={`market-row-${m.id}`}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-foreground">{m.name}</span>
                            <Badge variant="outline" className="text-[10px] h-4">{m.category}</Badge>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-foreground">
                          {m.marketProbability !== null ? `${(m.marketProbability * 100).toFixed(0)}%` : "—"}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums font-medium text-foreground">
                          {m.aiProbability !== null ? `${(m.aiProbability * 100).toFixed(0)}%` : "—"}
                        </td>
                        <td className={`px-4 py-3 text-right tabular-nums font-medium ${
                          m.edge !== null ? ((m.edge || 0) > 0 ? "text-profit" : (m.edge || 0) < 0 ? "text-loss" : "text-muted-foreground") : "text-muted-foreground"
                        }`}>
                          {m.edge !== null ? `${(m.edge * 100).toFixed(1)}%` : "—"}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                          ${m.volume24h ? (m.volume24h / 1000000).toFixed(1) + "M" : "—"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Badge
                            variant="outline"
                            className={`text-[10px] h-5 ${
                              m.status === "active" ? "border-[hsl(var(--profit))]/30 text-profit" : "text-muted-foreground"
                            }`}
                          >
                            {m.status}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {polymarkets.length === 0 && (
                  <div className="py-8 text-center text-sm text-muted-foreground">No Polymarket markets loaded</div>
                )}
              </div>
            </div>

            {/* Exchange Section */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2 h-2 rounded-full bg-chart-2" />
                <h2 className="text-sm font-medium text-foreground">Crypto Exchanges</h2>
                <Badge variant="outline" className="text-[10px] h-5">{exchanges.length}</Badge>
              </div>
              <div className="bg-card border border-card-border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">Pair</th>
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">Platform</th>
                      <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">Price</th>
                      <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">Volume 24h</th>
                      <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {exchanges.map((m) => (
                      <tr key={m.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 font-medium text-foreground">{m.name}</td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className="text-[10px] h-5 capitalize">{m.platform}</Badge>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums font-medium text-foreground">
                          ${m.currentPrice?.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                          ${m.volume24h ? (m.volume24h / 1000000000).toFixed(1) + "B" : "—"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Badge variant="outline" className="text-[10px] h-5 border-[hsl(var(--profit))]/30 text-profit">active</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {exchanges.length === 0 && (
                  <div className="py-8 text-center text-sm text-muted-foreground">No exchange pairs loaded</div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
