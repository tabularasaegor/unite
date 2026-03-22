import { useQuery } from "@tanstack/react-query";
import type { Position } from "@shared/schema";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function Positions() {
  const { data: positions, isLoading } = useQuery<Position[]>({
    queryKey: ["/api/positions"],
  });

  const openPositions = positions?.filter(p => p.status === "open") || [];
  const closedPositions = positions?.filter(p => p.status === "closed") || [];

  const totalOpenPnl = openPositions.reduce((s, p) => s + (p.pnl || 0), 0);
  const totalClosedPnl = closedPositions.reduce((s, p) => s + (p.pnl || 0), 0);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-6 max-w-[1400px] mx-auto space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Positions</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Active and closed trading positions</p>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
          </div>
        ) : (
          <Tabs defaultValue="open">
            <div className="flex items-center justify-between">
              <TabsList>
                <TabsTrigger value="open" data-testid="tab-open">
                  Open ({openPositions.length})
                </TabsTrigger>
                <TabsTrigger value="closed" data-testid="tab-closed">
                  Closed ({closedPositions.length})
                </TabsTrigger>
              </TabsList>
              <div className="text-sm tabular-nums">
                <span className="text-muted-foreground mr-2">Unrealized P&L:</span>
                <span className={`font-medium ${totalOpenPnl >= 0 ? "text-profit" : "text-loss"}`}>
                  {totalOpenPnl >= 0 ? "+" : ""}${totalOpenPnl.toFixed(2)}
                </span>
              </div>
            </div>

            <TabsContent value="open">
              <PositionTable positions={openPositions} showClose />
            </TabsContent>
            <TabsContent value="closed">
              <PositionTable positions={closedPositions} />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  );
}

function PositionTable({ positions, showClose }: { positions: Position[]; showClose?: boolean }) {
  if (positions.length === 0) {
    return (
      <div className="bg-card border border-card-border rounded-lg py-12 text-center text-sm text-muted-foreground">
        No positions
      </div>
    );
  }

  return (
    <div className="bg-card border border-card-border rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">Market</th>
            <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">Side</th>
            <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">Entry</th>
            <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">Current</th>
            <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">Size</th>
            <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">P&L</th>
            <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">Strategy</th>
            <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">Opened</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((pos) => (
            <tr key={pos.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors" data-testid={`position-row-${pos.id}`}>
              <td className="px-4 py-3">
                <div>
                  <span className="font-medium text-foreground">{pos.marketName}</span>
                  <div className="text-xs text-muted-foreground mt-0.5">{pos.platform}</div>
                </div>
              </td>
              <td className="px-4 py-3">
                <Badge
                  variant="outline"
                  className={`text-[10px] h-5 ${
                    pos.side === "YES" || pos.side === "LONG" ? "border-[hsl(var(--profit))]/30 text-profit" : "border-[hsl(var(--loss))]/30 text-loss"
                  }`}
                >
                  {pos.side}
                </Badge>
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-foreground">{pos.entryPrice.toFixed(2)}</td>
              <td className="px-4 py-3 text-right tabular-nums text-foreground">{(pos.currentPrice || 0).toFixed(2)}</td>
              <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{pos.size} USDC</td>
              <td className="px-4 py-3 text-right">
                <div>
                  <span className={`tabular-nums font-medium ${(pos.pnl || 0) >= 0 ? "text-profit" : "text-loss"}`}>
                    {(pos.pnl || 0) >= 0 ? "+" : ""}${(pos.pnl || 0).toFixed(2)}
                  </span>
                  <div className={`text-xs tabular-nums ${(pos.pnlPercent || 0) >= 0 ? "text-profit" : "text-loss"}`}>
                    {(pos.pnlPercent || 0) >= 0 ? "+" : ""}{(pos.pnlPercent || 0).toFixed(1)}%
                  </div>
                </div>
              </td>
              <td className="px-4 py-3 text-right">
                <Badge variant="outline" className="text-[10px] h-5">{pos.strategy}</Badge>
              </td>
              <td className="px-4 py-3 text-right text-xs text-muted-foreground tabular-nums">
                {new Date(pos.openedAt).toLocaleDateString("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
