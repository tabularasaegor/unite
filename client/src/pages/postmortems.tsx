import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shared";
import { Skeleton } from "@/components/ui/skeleton";

interface PostMortem {
  id: number;
  opportunityId: number | null;
  settlementId: number | null;
  analysis: string | null;
  whatHappened: string | null;
  whatModelPredicted: string | null;
  whyWrongOrRight: string | null;
  lessonsLearned: string | null;
  createdAt: string;
}

export default function PostMortems() {
  const { data: postmortems = [], isLoading } = useQuery<PostMortem[]>({
    queryKey: ["/api/postmortems"],
  });

  return (
    <div>
      <PageHeader title="Пост-мортем" subtitle="Анализ завершённых сделок" />

      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="pt-6 space-y-3">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : postmortems.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Нет пост-мортемов. Они появятся после расчёта позиций.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {postmortems.map((pm) => (
            <Card key={pm.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium">
                    Пост-мортем #{pm.id}
                  </CardTitle>
                  <div className="flex gap-2">
                    {pm.opportunityId && (
                      <Badge variant="outline" className="text-xs font-mono">
                        Opp #{pm.opportunityId}
                      </Badge>
                    )}
                    {pm.settlementId && (
                      <Badge variant="outline" className="text-xs font-mono">
                        Set #{pm.settlementId}
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground font-mono">
                      {new Date(pm.createdAt).toLocaleDateString("ru-RU")}
                    </span>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {pm.whatHappened && (
                  <Section title="Что произошло" content={pm.whatHappened} />
                )}
                {pm.whatModelPredicted && (
                  <Section title="Предсказание модели" content={pm.whatModelPredicted} />
                )}
                {pm.whyWrongOrRight && (
                  <Section title="Почему верно/неверно" content={pm.whyWrongOrRight} />
                )}
                {pm.lessonsLearned && (
                  <Section title="Уроки" content={pm.lessonsLearned} />
                )}
                {pm.analysis && (
                  <Section title="Анализ" content={pm.analysis} />
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function Section({ title, content }: { title: string; content: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
        {title}
      </p>
      <p className="text-sm leading-relaxed">{content}</p>
    </div>
  );
}
