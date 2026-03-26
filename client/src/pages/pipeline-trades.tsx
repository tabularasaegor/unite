import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { TableCell, TableRow } from "@/components/ui/table";
import { DataTable, StatusBadge, PageHeader, formatDate } from "@/components/shared";
import type { Execution } from "@shared/schema";

const headers = ["ID", "Возможность", "Позиция", "Тип", "Сторона", "Цена", "Размер", "Статус", "Время"];

export default function PipelineTrades() {
  const { data: trades = [], isLoading } = useQuery<Execution[]>({
    queryKey: ["/api/executions?source=pipeline"],
  });

  return (
    <div>
      <PageHeader title="Сделки пайплайна" subtitle="История исполнений пайплайна" />
      <Card>
        <CardContent className="pt-6">
          <DataTable
            headers={headers}
            isLoading={isLoading}
            isEmpty={trades.length === 0}
            emptyMessage="Нет сделок"
          >
            {trades.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="font-mono text-xs">{t.id}</TableCell>
                <TableCell className="font-mono text-xs">{t.opportunityId ?? "—"}</TableCell>
                <TableCell className="font-mono text-xs">{t.positionId ?? "—"}</TableCell>
                <TableCell>
                  <StatusBadge status={t.type} />
                </TableCell>
                <TableCell>
                  <StatusBadge status={t.side === "yes" ? "Yes" : "No"} />
                </TableCell>
                <TableCell className="font-mono text-sm">${t.price.toFixed(4)}</TableCell>
                <TableCell className="font-mono text-sm">${t.size.toFixed(2)}</TableCell>
                <TableCell>
                  <StatusBadge status={t.status} />
                </TableCell>
                <TableCell className="text-xs text-muted-foreground font-mono">
                  {formatDate(t.createdAt)}
                </TableCell>
              </TableRow>
            ))}
          </DataTable>
        </CardContent>
      </Card>
    </div>
  );
}
