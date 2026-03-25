import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function PostMortems() {
  const { data: postMortems } = useQuery({
    queryKey: ["/api/post-mortems"],
  });

  const { data: memory } = useQuery({
    queryKey: ["/api/memory", "model_perf"],
    queryFn: async () => {
      const { apiRequest } = await import("@/lib/queryClient");
      const res = await apiRequest("GET", "/api/memory?category=model_perf");
      return res.json();
    },
  });

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6" data-testid="postmortems-page">
      <div>
        <h2 className="text-xl font-semibold">Пост-мортем анализ</h2>
        <p className="text-sm text-muted-foreground">Обучение на результатах: что сработало, что нет, уроки</p>
      </div>

      {/* Model Performance */}
      {memory && memory.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Производительность моделей</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              {memory.map((m: any) => {
                const stats = JSON.parse(m.value);
                return (
                  <div key={m.id} className="bg-muted/30 rounded-lg p-3">
                    <div className="font-medium text-sm mb-2">{m.key.toUpperCase()}</div>
                    <div className="space-y-1 text-xs">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Точность:</span>
                        <span className="font-mono">{((stats.accuracy || 0) * 100).toFixed(1)}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Средн. ошибка:</span>
                        <span className="font-mono">{((stats.avgError || 0) * 100).toFixed(1)}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Всего:</span>
                        <span className="font-mono">{stats.total || 0} / {stats.correct || 0} верных</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Post-Mortems */}
      <div className="space-y-4">
        {(postMortems || []).map((pm: any) => (
          <Card key={pm.id}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Opportunity #{pm.opportunityId}</CardTitle>
                <span className="text-xs text-muted-foreground">{new Date(pm.createdAt).toLocaleString("ru-RU")}</span>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-muted/30 rounded p-2">
                  <div className="text-[10px] text-muted-foreground">Точность прогноза</div>
                  <div className="text-sm font-mono">{pm.predictionAccuracy != null ? `${(pm.predictionAccuracy * 100).toFixed(1)}%` : "—"}</div>
                </div>
                <div className="bg-muted/30 rounded p-2">
                  <div className="text-[10px] text-muted-foreground">Ошибка калибровки</div>
                  <div className="text-sm font-mono">{pm.calibrationError != null ? `${(pm.calibrationError * 100).toFixed(1)}%` : "—"}</div>
                </div>
                <div className="bg-muted/30 rounded p-2">
                  <div className="text-[10px] text-muted-foreground">Реализованный edge</div>
                  <div className="text-sm font-mono">{pm.edgeRealized != null ? `${(pm.edgeRealized * 100).toFixed(1)}%` : "—"}</div>
                </div>
              </div>

              {pm.whatWorked && (
                <div>
                  <div className="text-xs font-medium text-green-500 mb-1">Что сработало:</div>
                  <ul className="space-y-0.5">
                    {JSON.parse(pm.whatWorked).map((item: string, i: number) => (
                      <li key={i} className="text-xs text-muted-foreground flex items-start gap-1">
                        <span className="text-green-500">✓</span> {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {pm.whatFailed && (
                <div>
                  <div className="text-xs font-medium text-red-500 mb-1">Что не сработало:</div>
                  <ul className="space-y-0.5">
                    {JSON.parse(pm.whatFailed).map((item: string, i: number) => (
                      <li key={i} className="text-xs text-muted-foreground flex items-start gap-1">
                        <span className="text-red-500">✗</span> {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {pm.lessonsLearned && (
                <div>
                  <div className="text-xs font-medium mb-1">Уроки:</div>
                  <p className="text-xs text-muted-foreground">{pm.lessonsLearned}</p>
                </div>
              )}

              {pm.recommendations && (
                <div>
                  <div className="text-xs font-medium mb-1">Рекомендации:</div>
                  <ul className="space-y-0.5">
                    {JSON.parse(pm.recommendations).map((item: string, i: number) => (
                      <li key={i} className="text-xs text-muted-foreground flex items-start gap-1">
                        <span className="text-primary">→</span> {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
        {(!postMortems || postMortems.length === 0) && (
          <Card>
            <CardContent className="py-8 text-center">
              <p className="text-sm text-muted-foreground">Нет пост-мортем анализов. Они появятся после завершения сделок.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
