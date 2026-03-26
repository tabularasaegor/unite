import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";

export default function NotFound() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <Card className="max-w-md w-full text-center">
        <CardContent className="pt-10 pb-8">
          <div className="text-6xl font-mono font-bold text-muted-foreground/30 mb-4">
            404
          </div>
          <h1 className="text-lg font-semibold mb-2">Страница не найдена</h1>
          <p className="text-sm text-muted-foreground mb-6">
            Запрашиваемая страница не существует.
          </p>
          <Button asChild data-testid="button-go-home">
            <Link href="/">На главную</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
