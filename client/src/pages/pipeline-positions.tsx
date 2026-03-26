import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TableCell, TableRow } from "@/components/ui/table";
import { DataTable, StatusBadge, PnLDisplay, PageHeader, formatDate } from "@/components/shared";
import type { ActivePosition } from "@shared/schema";

const headers = ["ID", "Рынок", "Сторона", "Вход", "Текущая", "Размер", "P&L", "Статус", "Время"];

function PosTable({ positions, isLoading }: { positions: ActivePosition[]; isLoading: boolean }) {
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
          <TableCell className="text-sm font-medium max-w-[200px] truncate">
            {pos.slug ?? `Рынок #${pos.opportunityId}`}
          </TableCell>
          <TableCell>
            <StatusBadge status={pos.side === "yes" ? "Yes" : "No"} />
          </TableCell>
          <TableCell className="font-mono text-sm">${pos.entryPrice.toFixed(4)}</TableCell>
          <TableCell className="font-mono text-sm">${(pos.currentPrice ?? 0).toFixed(4)}</TableCell>
          <TableCell className="font-mono text-sm">${pos.size.toFixed(2)}</TableCell>
          <TableCell>
            <PnLDisplay value={pos.status === "open" ? pos.unrealizedPnl : pos.realizedPnl} />
          </TableCell>
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

export default function PipelinePositions() {
  const { data: positions = [], isLoading } = useQuery<ActivePosition[]>({
    queryKey: ["/api/positions?source=pipeline"],
  });

  const open = positions.filter((p) => p.status === "open");
  const closed = positions.filter((p) => p.status !== "open");

  return (
    <div>
      <PageHeader title="Позиции пайплайна" subtitle="Позиции из prediction market пайплайна" />
      <Card>
        <CardContent className="pt-6">
          <Tabs defaultValue="open">
            <TabsList data-testid="tabs-pipeline-position-filter">
              <TabsTrigger value="open" data-testid="tab-pipeline-open">Открытые ({open.length})</TabsTrigger>
              <TabsTrigger value="closed" data-testid="tab-pipeline-closed">Закрытые ({closed.length})</TabsTrigger>
              <TabsTrigger value="all" data-testid="tab-pipeline-all">Все ({positions.length})</TabsTrigger>
            </TabsList>
            <TabsContent value="open">
              <PosTable positions={open} isLoading={isLoading} />
            </TabsContent>
            <TabsContent value="closed">
              <PosTable positions={closed} isLoading={isLoading} />
            </TabsContent>
            <TabsContent value="all">
              <PosTable positions={positions} isLoading={isLoading} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
