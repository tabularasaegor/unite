import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Brain, Search, ShieldCheck, Play, RefreshCw, ExternalLink } from "lucide-react";
import { Link } from "wouter";

export default function OpportunityDetail({ params }: { params: { id: string } }) {
  const id = parseInt(params.id);
  const { toast } = useToast();

  const { data: opp } = useQuery({
    queryKey: ["/api/opportunities", id],
    queryFn: () => apiRequest("GET", `/api/opportunities/${id}`).then(r => r.json()),
    refetchInterval: 5000,
  });

  const { data: research } = useQuery({
    queryKey: ["/api/opportunities", id, "research"],
    queryFn: () => apiRequest("GET", `/api/opportunities/${id}/research`).then(r => r.json()),
  });

  const { data: estimates } = useQuery({
    queryKey: ["/api/opportunities", id, "estimates"],
    queryFn: () => apiRequest("GET", `/api/opportunities/${id}/estimates`).then(r => r.json()),
  });

  const { data: risk } = useQuery({
    queryKey: ["/api/opportunities", id, "risk"],
    queryFn: () => apiRequest("GET", `/api/opportunities/${id}/risk`).then(r => r.json()),
  });

  const researchMut = useMutation({
    mutationFn: () => apiRequest("POST", `/api/opportunities/${id}/research`),
    onSuccess: () => { toast({ title: "Исследование завершено" }); queryClient.invalidateQueries({ queryKey: ["/api/opportunities", id] }); },
  });
  const estimateMut = useMutation({
    mutationFn: () => apiRequest("POST", `/api/opportunities/${id}/estimate`),
    onSuccess: () => { toast({ title: "Оценка завершена" }); queryClient.invalidateQueries({ queryKey: ["/api/opportunities", id] }); },
  });
  const riskMut = useMutation({
    mutationFn: () => apiRequest("POST", `/api/opportunities/${id}/risk`),
    onSuccess: () => { toast({ title: "Оценка рисков завершена" }); queryClient.invalidateQueries({ queryKey: ["/api/opportunities", id] }); },
  });
  const executeMut = useMutation({
    mutationFn: () => apiRequest("POST", `/api/opportunities/${id}/execute`),
    onSuccess: () => { toast({ title: "Сделка исполнена" }); queryClient.invalidateQueries({ queryKey: ["/api/opportunities", id] }); },
  });
  const approveMut = useMutation({
    mutationFn: (assessmentId: number) => apiRequest("POST", `/api/risk/${assessmentId}/approve`),
    onSuccess: () => { toast({ title: "Одобрено" }); queryClient.invalidateQueries({ queryKey: ["/api/opportunities", id] }); },
  });
  const rejectMut = useMutation({
    mutationFn: (assessmentId: number) => apiRequest("POST", `/api/risk/${assessmentId}/reject`, { reason: "Отклонено пользователем" }),
    onSuccess: () => { toast({ title: "Отклонено" }); queryClient.invalidateQueries({ queryKey: ["/api/opportunities", id] }); },
  });

  if (!opp) return <div className="flex-1 p-6"><p className="text-muted-foreground">Загрузка...</p></div>;

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6" data-testid="opportunity-detail-page">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/scanner">
          <Button variant="ghost" size="sm"><ArrowLeft className="w-4 h-4" /></Button>
        </Link>
        <div className="flex-1">
          <h2 className="text-lg font-semibold">{opp.title}</h2>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant="outline">{opp.platform}</Badge>
            <Badge variant="secondary">{opp.category}</Badge>
            <Badge>{opp.status}</Badge>
            {opp.marketUrl && (
              <a href={opp.marketUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary flex items-center gap-1">
                Открыть <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-5 gap-3">
        <MetricCard label="Цена рынка" value={opp.currentPrice != null ? `${(opp.currentPrice * 100).toFixed(1)}%` : "—"} />
        <MetricCard label="AI вероятность" value={opp.aiProbability != null ? `${(opp.aiProbability * 100).toFixed(1)}%` : "—"} />
        <MetricCard label="Edge" value={opp.edge != null ? `${opp.edge > 0 ? "+" : ""}${(opp.edge * 100).toFixed(1)}%` : "—"} valueColor={opp.edge > 0 ? "text-green-500" : "text-red-500"} />
        <MetricCard label="Уверенность" value={opp.confidence || "—"} />
        <MetricCard label="Kelly" value={opp.kellyFraction != null ? `${(opp.kellyFraction * 100).toFixed(1)}%` : "—"} />
      </div>

      {/* Action Buttons */}
      <Card>
        <CardContent className="py-3 flex items-center gap-2">
          <span className="text-sm text-muted-foreground mr-2">Пайплайн:</span>
          <Button size="sm" variant="outline" onClick={() => researchMut.mutate()} disabled={researchMut.isPending}>
            <Search className="w-3.5 h-3.5 mr-1" /> Исследовать
          </Button>
          <Button size="sm" variant="outline" onClick={() => estimateMut.mutate()} disabled={estimateMut.isPending}>
            <Brain className="w-3.5 h-3.5 mr-1" /> Оценить P
          </Button>
          <Button size="sm" variant="outline" onClick={() => riskMut.mutate()} disabled={riskMut.isPending}>
            <ShieldCheck className="w-3.5 h-3.5 mr-1" /> Оценить риск
          </Button>
          {opp.status === "approved" && (
            <Button size="sm" onClick={() => executeMut.mutate()} disabled={executeMut.isPending}>
              <Play className="w-3.5 h-3.5 mr-1" /> Исполнить
            </Button>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="research" className="w-full">
        <TabsList>
          <TabsTrigger value="research">Исследование ({(research || []).length})</TabsTrigger>
          <TabsTrigger value="probability">Вероятности ({(estimates || []).length})</TabsTrigger>
          <TabsTrigger value="risk">Риск</TabsTrigger>
        </TabsList>

        <TabsContent value="research" className="space-y-3 mt-4">
          {(research || []).map((r: any) => (
            <Card key={r.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">{r.agentType.toUpperCase()} Agent</CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant={r.sentiment === "bullish" ? "default" : r.sentiment === "bearish" ? "destructive" : "secondary"}>
                      {r.sentiment}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{((r.confidenceScore || 0) * 100).toFixed(0)}% уверенность</span>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm">{r.summary}</p>
                {r.findings && (
                  <ul className="mt-2 space-y-1">
                    {JSON.parse(r.findings).map((f: string, i: number) => (
                      <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                        <span className="text-primary mt-0.5">•</span>
                        {f}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground">
                  <span>Модель: {r.modelUsed}</span>
                  <span>{r.latencyMs}ms</span>
                </div>
              </CardContent>
            </Card>
          ))}
          {(!research || research.length === 0) && <p className="text-sm text-muted-foreground py-4 text-center">Нет данных. Запустите исследование.</p>}
        </TabsContent>

        <TabsContent value="probability" className="space-y-3 mt-4">
          {(estimates || []).map((e: any) => (
            <Card key={e.id}>
              <CardContent className="pt-4">
                <div className="grid grid-cols-4 gap-4 mb-3">
                  <div>
                    <span className="text-xs text-muted-foreground">GPT</span>
                    <div className="text-sm font-mono">{e.gptProbability != null ? `${(e.gptProbability * 100).toFixed(1)}%` : "—"}</div>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">Claude</span>
                    <div className="text-sm font-mono">{e.claudeProbability != null ? `${(e.claudeProbability * 100).toFixed(1)}%` : "—"}</div>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">Gemini</span>
                    <div className="text-sm font-mono">{e.geminiProbability != null ? `${(e.geminiProbability * 100).toFixed(1)}%` : "—"}</div>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">Ансамбль</span>
                    <div className="text-sm font-mono font-semibold">{(e.ensembleProbability * 100).toFixed(1)}%</div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-sm font-mono ${e.edge > 0 ? "text-green-500" : "text-red-500"}`}>
                    Edge: {e.edge > 0 ? "+" : ""}{(e.edge * 100).toFixed(1)}%
                  </span>
                  <Badge>{e.confidence}</Badge>
                  <span className="text-xs text-muted-foreground">{new Date(e.createdAt).toLocaleString("ru-RU")}</span>
                </div>
                {e.reasoning && <p className="text-xs text-muted-foreground mt-2">{e.reasoning}</p>}
              </CardContent>
            </Card>
          ))}
          {(!estimates || estimates.length === 0) && <p className="text-sm text-muted-foreground py-4 text-center">Нет данных.</p>}
        </TabsContent>

        <TabsContent value="risk" className="mt-4">
          {risk ? (
            <Card>
              <CardContent className="pt-4 space-y-4">
                <div className="grid grid-cols-4 gap-4">
                  <MetricCard label="Kelly %" value={`${((risk.kellyFraction || 0) * 100).toFixed(1)}%`} />
                  <MetricCard label="Half-Kelly $" value={`$${(risk.halfKellySize || 0).toFixed(0)}`} />
                  <MetricCard label="VaR" value={`$${(risk.portfolioVaR || 0).toFixed(0)}`} />
                  <MetricCard label="CVaR" value={`$${(risk.portfolioCVaR || 0).toFixed(0)}`} />
                </div>
                <div className="grid grid-cols-4 gap-4">
                  <RiskBadge label="Корреляция" value={risk.correlationRisk} />
                  <RiskBadge label="Концентрация" value={risk.concentrationRisk} />
                  <RiskBadge label="Ликвидность" value={risk.liquidityRisk} />
                  <RiskBadge label="Общий риск" value={risk.overallRisk} />
                </div>
                <div className="flex items-center gap-2 pt-2 border-t">
                  <span className="text-sm">Статус одобрения:</span>
                  {risk.approved === 1 ? (
                    <Badge className="bg-green-500">Одобрено ({risk.approvedBy})</Badge>
                  ) : risk.approved === -1 ? (
                    <Badge variant="destructive">Отклонено</Badge>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">Ожидает</Badge>
                      <Button size="sm" onClick={() => approveMut.mutate(risk.id)}>Одобрить</Button>
                      <Button size="sm" variant="destructive" onClick={() => rejectMut.mutate(risk.id)}>Отклонить</Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ) : (
            <p className="text-sm text-muted-foreground py-4 text-center">Нет оценки рисков.</p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function MetricCard({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div className="bg-muted/30 rounded-lg px-3 py-2">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={`text-sm font-semibold font-mono ${valueColor || ""}`}>{value}</div>
    </div>
  );
}

function RiskBadge({ label, value }: { label: string; value: string }) {
  const colors = { low: "bg-green-500/10 text-green-500", medium: "bg-yellow-500/10 text-yellow-500", high: "bg-red-500/10 text-red-500", extreme: "bg-red-600/10 text-red-600" };
  return (
    <div className="bg-muted/30 rounded-lg px-3 py-2">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <span className={`text-xs px-1.5 py-0.5 rounded ${colors[value as keyof typeof colors] || ""}`}>{value}</span>
    </div>
  );
}
