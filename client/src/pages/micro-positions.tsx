import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TableCell, TableRow } from "@/components/ui/table";
import { DataTable, StatusBadge, PnLDisplay, PageHeader, formatDate } from "@/components/shared";
import type { ActivePosition } from "@shared/schema";

const headers = ["ID", "Актив", "Направление", "Вход", "Текущая", "Размер", "P&L", "Стратегия", "Статус", "Время"];

function PositionsTable({ positions, isLoading }: { positions: ActivePosition[]; isLoading: boolean }) {
  return (
    <DataTable
      headers={headers}
      isLoading={isLoading}
      isEmpty={positions.length === 0}
      emptyMessage="Нет позиций"
    >
      {positions.map((pos) => (
        <TableRow key={pos.id}>
          <TableCell className="font-mono text-xs">{pos.id}</TableCell>
          <TableCell className="font-mono font-medium text-primary">
            {pos.asset?.toUpperCase() ?? "—"}
          </TableCell>
          <TableCell>
            <StatusBadge status={pos.side?.toLowerCase() === "yes" || pos.side?.toLowerCase() === "up" ? "Up" : "Down"} />
          </TableCell>
          <TableCell className="font-mono text-sm">${pos.entryPrice.toFixed(4)}</TableCell>
          <TableCell className="font-mono text-sm">${(pos.currentPrice ?? 0).toFixed(4)}</TableCell>
          <TableCell className="font-mono text-sm">${pos.size.toFixed(2)}</TableCell>
          <TableCell>
            <PnLDisplay value={pos.status === "open" ? pos.unrealizedPnl : pos.realizedPnl} />
          </TableCell>
          <TableCell className="text-xs text-muted-foreground">{pos.strategyUsed ?? "—"}</TableCell>
          <TableCell>
            <StatusBadge status={pos.status} />
          </TableCell>
          <TableCell className="text-xs text-muted-foreground font-mono">
            {formatDate(pos.createdAt)}
          </TableCell>
        </TableRow>
      ))}
    </DataTable>
  );
}

export default function MicroPositions() {
  const { data: positions = [], isLoading } = useQuery<ActivePosition[]>({
    queryKey: ["/api/positions?source=micro"],
  });

  const open = positions.filter((p) => p.status === "open");
  const closed = positions.filter((p) => p.status !== "open");

  return (
    <div>
      <PageHeader title="Микро-позиции" subtitle="Позиции крипто 5-минутной торговли" />
      <Card>
        <CardContent className="pt-6">
          <Tabs defaultValue="open">
            <TabsList data-testid="tabs-position-filter">
              <TabsTrigger value="open" data-testid="tab-open">Открытые ({open.length})</TabsTrigger>
              <TabsTrigger value="closed" data-testid="tab-closed">Закрытые ({closed.length})</TabsTrigger>
              <TabsTrigger value="all" data-testid="tab-all">Все ({positions.length})</TabsTrigger>
            </TabsList>
            <TabsContent value="open">
              <PositionsTable positions={open} isLoading={isLoading} />
            </TabsContent>
            <TabsContent value="closed">
              <PositionsTable positions={closed} isLoading={isLoading} />
            </TabsContent>
            <TabsContent value="all">
              <PositionsTable positions={positions} isLoading={isLoading} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
