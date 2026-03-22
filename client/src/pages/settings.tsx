import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";

export default function SettingsPage() {
  const { toast } = useToast();
  const { data: config, isLoading } = useQuery<Record<string, string>>({
    queryKey: ["/api/config"],
  });

  const [form, setForm] = useState<Record<string, string>>({});

  useEffect(() => {
    if (config) setForm(config);
  }, [config]);

  const saveMutation = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: string }) => {
      await apiRequest("POST", "/api/config", { key, value });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/config"] });
      toast({ title: "Saved", description: "Configuration updated" });
    },
  });

  const handleSave = (key: string) => {
    saveMutation.mutate({ key, value: form[key] });
  };

  const sections = [
    {
      title: "Bot Status",
      items: [
        { key: "bot_status", label: "Bot Status", type: "select", options: ["running", "paused", "stopped"] },
        { key: "paper_trading", label: "Paper Trading", type: "select", options: ["true", "false"] },
      ],
    },
    {
      title: "Risk Management",
      items: [
        { key: "max_position_size", label: "Max Position Size (USDC)", type: "number" },
        { key: "daily_loss_limit", label: "Daily Loss Limit (USDC)", type: "number" },
        { key: "max_exposure", label: "Max Total Exposure (USDC)", type: "number" },
        { key: "min_edge_threshold", label: "Min Edge Threshold", type: "number" },
      ],
    },
    {
      title: "AI Ensemble Weights",
      items: [
        { key: "gpt_weight", label: "GPT-4o Weight", type: "number" },
        { key: "claude_weight", label: "Claude 3.5 Weight", type: "number" },
        { key: "gemini_weight", label: "Gemini 1.5 Weight", type: "number" },
      ],
    },
    {
      title: "Platforms",
      items: [
        { key: "platforms", label: "Active Platforms", type: "text" },
        { key: "strategy", label: "Strategy", type: "select", options: ["ai_ensemble", "latency_arbitrage", "market_making", "structural_arbitrage"] },
      ],
    },
  ];

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-6 max-w-[800px] mx-auto space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Settings</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Bot configuration and risk management</p>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-lg" />)}
          </div>
        ) : (
          <div className="space-y-5">
            {sections.map((section) => (
              <div key={section.title} className="bg-card border border-card-border rounded-lg p-5">
                <h3 className="text-sm font-semibold text-foreground mb-4">{section.title}</h3>
                <div className="space-y-4">
                  {section.items.map((item) => (
                    <div key={item.key} className="flex items-center justify-between gap-4">
                      <label className="text-sm text-muted-foreground flex-shrink-0 w-48">{item.label}</label>
                      <div className="flex items-center gap-2 flex-1 max-w-xs">
                        {item.type === "select" ? (
                          <select
                            value={form[item.key] || ""}
                            onChange={(e) => setForm(prev => ({ ...prev, [item.key]: e.target.value }))}
                            className="flex-1 h-8 px-2 text-sm rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                            data-testid={`input-${item.key}`}
                          >
                            {item.options?.map(opt => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type={item.type === "number" ? "text" : "text"}
                            value={form[item.key] || ""}
                            onChange={(e) => setForm(prev => ({ ...prev, [item.key]: e.target.value }))}
                            className="flex-1 h-8 px-2 text-sm rounded-md border border-border bg-background text-foreground tabular-nums focus:outline-none focus:ring-1 focus:ring-ring"
                            data-testid={`input-${item.key}`}
                          />
                        )}
                        <button
                          onClick={() => handleSave(item.key)}
                          disabled={saveMutation.isPending}
                          className="h-8 px-3 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
                          data-testid={`button-save-${item.key}`}
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {/* API Keys notice */}
            <div className="bg-card border border-card-border rounded-lg p-5">
              <h3 className="text-sm font-semibold text-foreground mb-2">API Keys</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                For security, API keys (Polymarket private key, Binance/Bybit API credentials, OpenAI/Anthropic/Google AI keys) should be configured via environment variables, not stored in the database.
              </p>
              <div className="mt-3 space-y-1.5">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px] h-5">POLY_PRIVATE_KEY</Badge>
                  <span className="text-xs text-muted-foreground">Polymarket wallet key</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px] h-5">OPENAI_API_KEY</Badge>
                  <span className="text-xs text-muted-foreground">GPT-4o ensemble weight</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px] h-5">ANTHROPIC_API_KEY</Badge>
                  <span className="text-xs text-muted-foreground">Claude 3.5 ensemble weight</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px] h-5">GOOGLE_AI_API_KEY</Badge>
                  <span className="text-xs text-muted-foreground">Gemini 1.5 ensemble weight</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px] h-5">BINANCE_API_KEY / SECRET</Badge>
                  <span className="text-xs text-muted-foreground">Binance trading</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px] h-5">BYBIT_API_KEY / SECRET</Badge>
                  <span className="text-xs text-muted-foreground">Bybit trading</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
