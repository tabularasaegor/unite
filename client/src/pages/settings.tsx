import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";
import { Zap, Key } from "lucide-react";
import { Link } from "wouter";

export default function SettingsPage() {
  const { toast } = useToast();

  const { data: config, isLoading } = useQuery({
    queryKey: ["/api/config"],
  });

  const [form, setForm] = useState<Record<string, string>>({});
  const [keys, setKeys] = useState<Record<string, string>>({});

  const { data: polyStatus } = useQuery({
    queryKey: ["/api/polymarket/status"],
  });

  const saveKeysMut = useMutation({
    mutationFn: (data: Record<string, string>) => apiRequest("POST", "/api/config/keys", data),
    onSuccess: () => {
      toast({ title: "Ключи сохранены" });
      setKeys({});
      queryClient.invalidateQueries({ queryKey: ["/api/polymarket/status"] });
    },
    onError: (err: any) => toast({ title: "Ошибка", description: err.message, variant: "destructive" }),
  });

  useEffect(() => {
    if (config) setForm(config);
  }, [config]);

  const saveMut = useMutation({
    mutationFn: (updates: Record<string, string>) => apiRequest("POST", "/api/config", updates),
    onSuccess: () => {
      toast({ title: "Настройки сохранены" });
      queryClient.invalidateQueries({ queryKey: ["/api/config"] });
    },
    onError: (err: any) => toast({ title: "Ошибка", description: err.message, variant: "destructive" }),
  });

  const update = (key: string, value: string) => setForm(prev => ({ ...prev, [key]: value }));

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6" data-testid="settings-page">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Настройки</h2>
          <p className="text-sm text-muted-foreground">Конфигурация платформы, моделей и управления рисками</p>
        </div>
        <Button onClick={() => saveMut.mutate(form)} disabled={saveMut.isPending}>
          {saveMut.isPending ? "Сохранение..." : "Сохранить"}
        </Button>
      </div>

      {/* Trading Mode */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Режим торговли</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>Paper Trading</Label>
              <p className="text-xs text-muted-foreground">Симуляция сделок без реальных денег</p>
            </div>
            <Switch
              checked={form.paper_trading !== "false"}
              onCheckedChange={(checked) => update("paper_trading", checked ? "true" : "false")}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label>Авто-исполнение</Label>
              <p className="text-xs text-muted-foreground">Автоматическое исполнение одобренных сделок</p>
            </div>
            <Switch
              checked={form.auto_execute === "true"}
              onCheckedChange={(checked) => update("auto_execute", checked ? "true" : "false")}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label>Human-in-the-loop</Label>
              <p className="text-xs text-muted-foreground">Требовать одобрение для каждой сделки</p>
            </div>
            <Switch
              checked={form.require_human_approval !== "false"}
              onCheckedChange={(checked) => update("require_human_approval", checked ? "true" : "false")}
            />
          </div>
        </CardContent>
      </Card>

      {/* Risk Management */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Управление рисками</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Банкролл ($)</Label>
              <Input type="number" value={form.bankroll || ""} onChange={e => update("bankroll", e.target.value)} />
            </div>
            <div>
              <Label>Макс. позиция (%)</Label>
              <Input type="number" step="0.01" value={form.max_position_pct || ""} onChange={e => update("max_position_pct", e.target.value)} />
            </div>
            <div>
              <Label>Макс. просадка (%)</Label>
              <Input type="number" step="0.01" value={form.max_drawdown || ""} onChange={e => update("max_drawdown", e.target.value)} />
            </div>
            <div>
              <Label>Порог авто-одобрения ($)</Label>
              <Input type="number" value={form.auto_approve_threshold || ""} onChange={e => update("auto_approve_threshold", e.target.value)} />
            </div>
            <div>
              <Label>Макс. размер сделки ($)</Label>
              <Input type="number" value={form.max_trade_size || ""} onChange={e => update("max_trade_size", e.target.value)} />
            </div>
            <div>
              <Label>Мин. Edge (%)</Label>
              <Input type="number" step="0.01" value={form.min_edge_threshold || ""} onChange={e => update("min_edge_threshold", e.target.value)} />
            </div>
            <div>
              <Label>Интервал пайплайна (мин)</Label>
              <Input type="number" value={form.pipeline_interval || ""} onChange={e => update("pipeline_interval", e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Pipeline Scope */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Область пайплайна</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Мин. дней до окончания</Label>
              <Input type="number" value={form.pipeline_min_days || ""} onChange={e => update("pipeline_min_days", e.target.value)} />
              <p className="text-[10px] text-muted-foreground mt-1">Не торговать события, истекающие через менее N дней</p>
            </div>
            <div>
              <Label>Макс. дней до окончания</Label>
              <Input type="number" value={form.pipeline_max_days || ""} onChange={e => update("pipeline_max_days", e.target.value)} />
              <p className="text-[10px] text-muted-foreground mt-1">Не торговать события, истекающие через более N дней</p>
            </div>
          </div>
          <div>
            <Label>Секторы</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {["sports", "crypto", "politics", "tech", "other"].map(sector => {
                const sectors = (form.pipeline_sectors || "sports,crypto,politics,tech,other").split(",").map(s => s.trim());
                const isActive = sectors.includes(sector);
                return (
                  <Badge
                    key={sector}
                    variant={isActive ? "default" : "outline"}
                    className="cursor-pointer select-none"
                    onClick={() => {
                      const newSectors = isActive
                        ? sectors.filter(s => s !== sector)
                        : [...sectors, sector];
                      update("pipeline_sectors", newSectors.join(","));
                    }}
                  >
                    {sector}
                  </Badge>
                );
              })}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">Выберите секторы для анализа. Нажмите на сектор для включения/выключения.</p>
          </div>
        </CardContent>
      </Card>

      {/* Micro-Scheduler (5-min crypto) */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-500" />
            Микро-планировщик (5-мин крипто)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Автоматическая торговля 5-минутными рынками BTC/ETH/SOL Up/Down на Polymarket.
            Управление и мониторинг доступны в <Link href="/micro" className="text-primary hover:underline">Панели управления</Link>.
          </p>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label>Активы</Label>
              <Input value={form.micro_assets || ""} onChange={e => update("micro_assets", e.target.value)} placeholder="btc,eth,sol" />
              <p className="text-[10px] text-muted-foreground mt-1">Через запятую: btc, eth, sol</p>
            </div>
            <div>
              <Label>Микро-банкролл ($)</Label>
              <Input type="number" value={form.micro_bankroll || ""} onChange={e => update("micro_bankroll", e.target.value)} />
            </div>
            <div>
              <Label>Макс. ставка ($)</Label>
              <Input type="number" value={form.micro_max_bet || ""} onChange={e => update("micro_max_bet", e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Model Weights */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Веса моделей AI ансамбля</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label>GPT-5</Label>
              <Input type="number" step="0.05" value={form.gpt_weight || ""} onChange={e => update("gpt_weight", e.target.value)} />
            </div>
            <div>
              <Label>Claude</Label>
              <Input type="number" step="0.05" value={form.claude_weight || ""} onChange={e => update("claude_weight", e.target.value)} />
            </div>
            <div>
              <Label>Gemini</Label>
              <Input type="number" step="0.05" value={form.gemini_weight || ""} onChange={e => update("gemini_weight", e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Сумма весов должна быть 1.0. Веса определяют влияние каждой модели на итоговую оценку.</p>
        </CardContent>
      </Card>

      {/* API Keys */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Key className="h-4 w-4" />
            API-ключи
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Ключи из .env имеют приоритет. Ключи, сохранённые здесь, используются если .env не задан.
          </p>
          <div className="grid grid-cols-1 gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Label>POLY_PRIVATE_KEY</Label>
                <Badge variant={polyStatus?.hasPrivateKey ? "default" : "secondary"} className="text-[10px] h-4">
                  {polyStatus?.hasPrivateKey ? "Настроен" : "Не настроен"}
                </Badge>
              </div>
              <Input type="password" placeholder="0x..." value={keys.poly_private_key || ""} onChange={e => setKeys(prev => ({ ...prev, poly_private_key: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Label>POLY_FUNDER_ADDRESS</Label>
                  <Badge variant={polyStatus?.address ? "default" : "secondary"} className="text-[10px] h-4">
                    {polyStatus?.address ? "Настроен" : "Не настроен"}
                  </Badge>
                </div>
                <Input placeholder="0x..." value={keys.poly_funder_address || ""} onChange={e => setKeys(prev => ({ ...prev, poly_funder_address: e.target.value }))} />
              </div>
              <div>
                <Label className="mb-1 block">POLY_SIGNATURE_TYPE</Label>
                <Input placeholder="0=EOA, 1=Magic, 2=Gnosis" value={keys.poly_signature_type || ""} onChange={e => setKeys(prev => ({ ...prev, poly_signature_type: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Label>OPENAI_API_KEY</Label>
                  <Badge variant={polyStatus?.hasOpenaiKey ? "default" : "secondary"} className="text-[10px] h-4">
                    {polyStatus?.hasOpenaiKey ? "Настроен" : "Не настроен"}
                  </Badge>
                </div>
                <Input type="password" placeholder="sk-..." value={keys.openai_api_key || ""} onChange={e => setKeys(prev => ({ ...prev, openai_api_key: e.target.value }))} />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Label>ANTHROPIC_API_KEY</Label>
                  <Badge variant={polyStatus?.hasAnthropicKey ? "default" : "secondary"} className="text-[10px] h-4">
                    {polyStatus?.hasAnthropicKey ? "Настроен" : "Не настроен"}
                  </Badge>
                </div>
                <Input type="password" placeholder="sk-ant-..." value={keys.anthropic_api_key || ""} onChange={e => setKeys(prev => ({ ...prev, anthropic_api_key: e.target.value }))} />
              </div>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => saveKeysMut.mutate(keys)}
            disabled={saveKeysMut.isPending || Object.values(keys).every(v => !v)}
          >
            {saveKeysMut.isPending ? "Сохранение..." : "Сохранить ключи"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
