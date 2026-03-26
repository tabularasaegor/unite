import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { PageHeader } from "@/components/shared";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";
import { Save, Loader2 } from "lucide-react";

interface ConfigMap {
  [key: string]: string;
}

const ASSETS = [
  { id: "btc", label: "BTC" },
  { id: "eth", label: "ETH" },
  { id: "sol", label: "SOL" },
  { id: "xrp", label: "XRP" },
];

const SECTORS = [
  { id: "sports", label: "Спорт" },
  { id: "crypto", label: "Крипто" },
  { id: "politics", label: "Политика" },
  { id: "tech", label: "Технологии" },
  { id: "other", label: "Другое" },
];

export default function SettingsPage() {
  const { toast } = useToast();

  const { data: config = {}, isLoading } = useQuery<ConfigMap>({
    queryKey: ["/api/config"],
  });

  const [local, setLocal] = useState<ConfigMap>({});

  // Sync from server
  useEffect(() => {
    if (config && Object.keys(config).length > 0) {
      setLocal(config);
    }
  }, [config]);

  const saveMutation = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: string }) => {
      await apiRequest("PUT", `/api/config/${key}`, { value });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/config"] });
      toast({ title: "Сохранено", description: "Настройка обновлена" });
    },
    onError: (err: Error) => {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    },
  });

  const getValue = (key: string, fallback: string = "") => local[key] ?? config[key] ?? fallback;
  const setValue = (key: string, value: string) => {
    setLocal((prev) => ({ ...prev, [key]: value }));
  };

  const saveKey = (key: string) => {
    saveMutation.mutate({ key, value: getValue(key) });
  };

  const isBool = (key: string) => getValue(key) === "true";
  const toggleBool = (key: string) => {
    const newVal = isBool(key) ? "false" : "true";
    setValue(key, newVal);
    saveMutation.mutate({ key, value: newVal });
  };

  const getList = (key: string, fallback: string): string[] =>
    (getValue(key, fallback) || "").split(",").filter(Boolean);

  const toggleListItem = (key: string, item: string, fallback: string) => {
    const current = getList(key, fallback);
    const next = current.includes(item)
      ? current.filter((i) => i !== item)
      : [...current, item];
    const newVal = next.join(",");
    setValue(key, newVal);
    saveMutation.mutate({ key, value: newVal });
  };

  if (isLoading) {
    return (
      <div>
        <PageHeader title="Настройки" />
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="pt-6">
                <div className="h-20 bg-muted animate-pulse rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Настройки" subtitle="Конфигурация платформы AlgoTrader" />

      <div className="space-y-6">
        {/* Trading Mode */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Режим торговли</CardTitle>
            <CardDescription className="text-xs">
              Переключение между paper и live торговлей
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label>Paper Trading</Label>
                <p className="text-xs text-muted-foreground">
                  Торговля без реальных средств
                </p>
              </div>
              <Switch
                checked={isBool("paper_trading")}
                onCheckedChange={() => toggleBool("paper_trading")}
                data-testid="switch-paper-trading"
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label>Авто-исполнение</Label>
                <p className="text-xs text-muted-foreground">
                  Автоматически исполнять одобренные сделки
                </p>
              </div>
              <Switch
                checked={isBool("auto_execute")}
                onCheckedChange={() => toggleBool("auto_execute")}
                data-testid="switch-auto-execute"
              />
            </div>
          </CardContent>
        </Card>

        {/* Risk Management */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Управление рисками</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <SettingField
                label="Банкролл ($)"
                configKey="bankroll"
                value={getValue("bankroll", "5000")}
                onChange={(v) => setValue("bankroll", v)}
                onSave={() => saveKey("bankroll")}
                isSaving={saveMutation.isPending}
                type="number"
              />
              <SettingField
                label="Макс позиция ($)"
                configKey="max_position"
                value={getValue("max_position", "500")}
                onChange={(v) => setValue("max_position", v)}
                onSave={() => saveKey("max_position")}
                isSaving={saveMutation.isPending}
                type="number"
              />
              <SettingField
                label="Макс просадка (%)"
                configKey="max_drawdown_pct"
                value={getValue("max_drawdown_pct", "20")}
                onChange={(v) => setValue("max_drawdown_pct", v)}
                onSave={() => saveKey("max_drawdown_pct")}
                isSaving={saveMutation.isPending}
                type="number"
              />
              <SettingField
                label="Мин Edge"
                configKey="min_edge"
                value={getValue("min_edge", "0.05")}
                onChange={(v) => setValue("min_edge", v)}
                onSave={() => saveKey("min_edge")}
                isSaving={saveMutation.isPending}
                type="number"
              />
              <SettingField
                label="Мин Confidence"
                configKey="min_confidence"
                value={getValue("min_confidence", "0.6")}
                onChange={(v) => setValue("min_confidence", v)}
                onSave={() => saveKey("min_confidence")}
                isSaving={saveMutation.isPending}
                type="number"
              />
            </div>
          </CardContent>
        </Card>

        {/* Pipeline Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Пайплайн</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <SettingField
                label="Мин дней до экспирации"
                configKey="pipeline_min_days"
                value={getValue("pipeline_min_days", "0")}
                onChange={(v) => setValue("pipeline_min_days", v)}
                onSave={() => saveKey("pipeline_min_days")}
                isSaving={saveMutation.isPending}
                type="number"
              />
              <SettingField
                label="Макс дней до экспирации"
                configKey="pipeline_max_days"
                value={getValue("pipeline_max_days", "30")}
                onChange={(v) => setValue("pipeline_max_days", v)}
                onSave={() => saveKey("pipeline_max_days")}
                isSaving={saveMutation.isPending}
                type="number"
              />
              <SettingField
                label="Интервал (мин)"
                configKey="pipeline_interval"
                value={getValue("pipeline_interval", "30")}
                onChange={(v) => setValue("pipeline_interval", v)}
                onSave={() => saveKey("pipeline_interval")}
                isSaving={saveMutation.isPending}
                type="number"
              />
              <SettingField
                label="Макс за запуск"
                configKey="pipeline_max_per_run"
                value={getValue("pipeline_max_per_run", "30")}
                onChange={(v) => setValue("pipeline_max_per_run", v)}
                onSave={() => saveKey("pipeline_max_per_run")}
                isSaving={saveMutation.isPending}
                type="number"
              />
            </div>
            <div>
              <Label className="mb-2 block text-sm">Секторы</Label>
              <div className="flex flex-wrap gap-3">
                {SECTORS.map((s) => (
                  <div key={s.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`sector-${s.id}`}
                      checked={getList("pipeline_sectors", "sports,crypto,politics,tech,other").includes(s.id)}
                      onCheckedChange={() =>
                        toggleListItem("pipeline_sectors", s.id, "sports,crypto,politics,tech,other")
                      }
                      data-testid={`checkbox-sector-${s.id}`}
                    />
                    <Label htmlFor={`sector-${s.id}`} className="text-sm cursor-pointer">
                      {s.label}
                    </Label>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Micro Trading */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Микро-торговля</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <SettingField
                label="Банкролл ($)"
                configKey="micro_bankroll"
                value={getValue("micro_bankroll", "200")}
                onChange={(v) => setValue("micro_bankroll", v)}
                onSave={() => saveKey("micro_bankroll")}
                isSaving={saveMutation.isPending}
                type="number"
              />
              <SettingField
                label="Макс ставка ($)"
                configKey="micro_max_bet"
                value={getValue("micro_max_bet", "20")}
                onChange={(v) => setValue("micro_max_bet", v)}
                onSave={() => saveKey("micro_max_bet")}
                isSaving={saveMutation.isPending}
                type="number"
              />
            </div>
            <div>
              <Label className="mb-2 block text-sm">Активы</Label>
              <div className="flex flex-wrap gap-3">
                {ASSETS.map((a) => (
                  <div key={a.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`asset-${a.id}`}
                      checked={getList("micro_assets", "btc,eth,sol,xrp").includes(a.id)}
                      onCheckedChange={() =>
                        toggleListItem("micro_assets", a.id, "btc,eth,sol,xrp")
                      }
                      data-testid={`checkbox-asset-${a.id}`}
                    />
                    <Label htmlFor={`asset-${a.id}`} className="text-sm cursor-pointer font-mono">
                      {a.label}
                    </Label>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── Setting Field Component ─────────────────────────────────────
function SettingField({
  label,
  configKey,
  value,
  onChange,
  onSave,
  isSaving,
  type = "text",
}: {
  label: string;
  configKey: string;
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  isSaving: boolean;
  type?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm">{label}</Label>
      <div className="flex gap-2">
        <Input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="font-mono"
          data-testid={`input-config-${configKey}`}
        />
        <Button
          size="icon"
          variant="outline"
          onClick={onSave}
          disabled={isSaving}
          data-testid={`button-save-${configKey}`}
        >
          {isSaving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  );
}
