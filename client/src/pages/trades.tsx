import { useQuery } from "@tanstack/react-query";
import type { Trade } from "@shared/schema";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

export default function Trades() {
  const { data: trades, isLoading } = useQuery<Trade[]>({
    queryKey: ["/api/trades"],
  });

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-6 max-w-[1400px] mx-auto space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Trade History</h1>
          <p className="text-sm text-muted-foreground mt-0.5">All executed trades across platforms</p>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
          </div>
        ) : (
          <div className="bg-card border border-card-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">Time</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">Market</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">Platform</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">Side</th>
                  <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">Price</th>
                  <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">Size</th>
                  <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">P&L</th>
                  <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">Strategy</th>
                </tr>
              </thead>
              <tbody>
                {trades && trades.length > 0 ? trades.map((trade) => (
                  <tr key={trade.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors" data-testid={`trade-row-${trade.id}`}>
                    <td className="px-4 py-3 text-xs text-muted-foreground tabular-nums">
                      {new Date(trade.executedAt).toLocaleDateString("en", { month: "short", day: "numeric" })}
                      <br />
                      {new Date(trade.executedAt).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="px-4 py-3 font-medium text-foreground">{trade.marketName}</td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className="text-[10px] h-5 capitalize">{trade.platform}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant="outline"
                        className={`text-[10px] h-5 ${
                          trade.side.startsWith("BUY") ? "border-[hsl(var(--profit))]/30 text-profit" : "border-[hsl(var(--loss))]/30 text-loss"
                        }`}
                      >
                        {trade.side}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-foreground">{trade.price.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{trade.size} USDC</td>
                    <td className={`px-4 py-3 text-right tabular-nums font-medium ${
                      (trade.pnl || 0) > 0 ? "text-profit" : (trade.pnl || 0) < 0 ? "text-loss" : "text-muted-foreground"
                    }`}>
                      {(trade.pnl || 0) !== 0 ? `${(trade.pnl || 0) > 0 ? "+" : ""}$${(trade.pnl || 0).toFixed(2)}` : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Badge variant="outline" className="text-[10px] h-5">{trade.strategy}</Badge>
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-sm text-muted-foreground">No trades yet</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
