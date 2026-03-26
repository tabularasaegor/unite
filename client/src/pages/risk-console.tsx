import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { TableCell, TableRow } from "@/components/ui/table";
import { KPICard, DataTable, PnLDisplay, StatusBadge, PageHeader } from "@/components/shared";
import { DollarSign, Shield, TrendingDown, Percent } from "lucide-react";
import type { ActivePosition } from "@shared/schema";

interface RiskStats {
  bankroll: number;
  allocated: number;
  maxPosition: number;
  kellyFraction: number;
  drawdown: number;
  maxDrawdown: number;
}

export default function RiskConsole() {
  const { data: risk, isLoading: riskLoading } = useQuery<RiskStats>({
    queryKey: ["/api/risk/stats"],
  });

  const { data: positions = [], isLoading: posLoading } = useQuery<ActivePosition[]>({
    queryKey: ["/api/positions?status=open"],
  });

  const drawdownPct = risk ? (risk.drawdown / Math.max(risk.maxDrawdown, 1)) * 100 : 0;

  return (
    <div>
      <PageHeader title="Риск-консоль" subtitle="Управление рисками и экспозицией" />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KPICard
          title="Банкролл"
          value={`$${(risk?.bankroll ?? 0).toFixed(2)}`}
          icon={<DollarSign className="h-4 w-4" />}
          isLoading={riskLoading}
        />
        <KPICard
          title="Аллокировано"
          value={`$${(risk?.allocated ?? 0).toFixed(2)}`}
          icon={<Shield className="h-4 w-4" />}
          isLoading={riskLoading}
        />
        <KPICard
          title="Макс позиция"
          value={`$${(risk?.maxPosition ?? 0).toFixed(2)}`}
          icon={<TrendingDown className="h-4 w-4" />}
          isLoading={riskLoading}
        />
        <KPICard
          title="Kelly"
          value={`${((risk?.kellyFraction ?? 0) * 100).toFixed(1)}%`}
          icon={<Percent className="h-4 w-4" />}
          isLoading={riskLoading}
        />
      </div>

      {/* Drawdown bar */}
      <Card className="mb-6">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Просадка</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Текущая просадка</span>
              <span className="font-mono font-medium">
                ${(risk?.drawdown ?? 0).toFixed(2)} / ${(risk?.maxDrawdown ?? 0).toFixed(2)}
              </span>
            </div>
            <Progress
              value={Math.min(drawdownPct, 100)}
              className="h-3"
            />
            <p className="text-xs text-muted-foreground">
              {drawdownPct.toFixed(1)}% от лимита
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Open positions with exposure */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Открытые позиции</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            headers={["ID", "Актив/Рынок", "Сторона", "Размер", "Вход", "Нереал. P&L", "Источник", "Статус"]}
            isLoading={posLoading}
            isEmpty={positions.length === 0}
            emptyMessage="Нет открытых позиций"
          >
            {positions.map((pos) => (
              <TableRow key={pos.id}>
                <TableCell className="font-mono text-xs">{pos.id}</TableCell>
                <TableCell className="text-sm font-medium">
                  {pos.asset?.toUpperCase() ?? `#${pos.opportunityId}`}
                </TableCell>
                <TableCell>
                  <StatusBadge status={pos.side?.toLowerCase() === "yes" || pos.side?.toLowerCase() === "up" ? "Up" : "Down"} />
                </TableCell>
                <TableCell className="font-mono text-sm">${pos.size.toFixed(2)}</TableCell>
                <TableCell className="font-mono text-sm">${pos.entryPrice.toFixed(4)}</TableCell>
                <TableCell>
                  <PnLDisplay value={pos.unrealizedPnl} />
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{pos.source}</TableCell>
                <TableCell>
                  <StatusBadge status={pos.status} />
                </TableCell>
              </TableRow>
            ))}
          </DataTable>
        </CardContent>
      </Card>
    </div>
  );
}
