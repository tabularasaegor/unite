import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { TableCell, TableRow } from "@/components/ui/table";
import { DataTable, StatusBadge, PnLDisplay, PageHeader, formatDate } from "@/components/shared";
import type { Settlement } from "@shared/schema";

const headers = ["ID", "Позиция", "Возможность", "Результат", "P&L", "Верно?", "Время"];

export default function PipelineSettlements() {
  const { data: settlements = [], isLoading } = useQuery<Settlement[]>({
    queryKey: ["/api/settlements?source=pipeline"],
  });

  return (
    <div>
      <PageHeader title="Расчёты пайплайна" subtitle="Результаты расчётов пайплайна" />
      <Card>
        <CardContent className="pt-6">
          <DataTable
            headers={headers}
            isLoading={isLoading}
            isEmpty={settlements.length === 0}
            emptyMessage="Нет расчётов"
          >
            {settlements.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-mono text-xs">{s.id}</TableCell>
                <TableCell className="font-mono text-xs">{s.positionId}</TableCell>
                <TableCell className="font-mono text-xs">{s.opportunityId ?? "—"}</TableCell>
                <TableCell>
                  <StatusBadge status={s.outcome === "won" ? "Won" : s.outcome === "lost" ? "Lost" : s.outcome} />
                </TableCell>
                <TableCell>
                  <PnLDisplay value={s.realizedPnl} />
                </TableCell>
                <TableCell>
                  {s.wasCorrect === null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : s.wasCorrect ? (
                    <span className="text-emerald-500 font-medium">✓</span>
                  ) : (
                    <span className="text-red-500 font-medium">✗</span>
                  )}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground font-mono">
                  {formatDate(s.settledAt)}
                </TableCell>
              </TableRow>
            ))}
          </DataTable>
        </CardContent>
      </Card>
    </div>
  );
}
