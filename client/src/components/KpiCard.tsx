import { type LucideIcon } from "lucide-react";

interface KpiCardProps {
  label: string;
  value: string;
  change?: string;
  isPositive?: boolean;
  icon: LucideIcon;
  testId: string;
}

export default function KpiCard({ label, value, change, isPositive, icon: Icon, testId }: KpiCardProps) {
  return (
    <div className="bg-card border border-card-border rounded-lg p-4" data-testid={testId}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</span>
        <Icon className="w-4 h-4 text-muted-foreground" />
      </div>
      <div className="flex items-end gap-2">
        <span className="text-xl font-semibold tabular-nums text-foreground" data-testid={`${testId}-value`}>{value}</span>
        {change && (
          <span className={`text-xs font-medium tabular-nums ${isPositive ? "text-profit" : "text-loss"}`}>
            {isPositive ? "+" : ""}{change}
          </span>
        )}
      </div>
    </div>
  );
}
