import { HeartPulse } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSEO } from "@/lib/seo";
import { loadSetup } from "@/lib/schedule-engine";
import { loadCallSchedule } from "@/lib/call-engine";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import PrimaryCallStatsTable from "@/components/PrimaryCallStatsTable";

export default function Statistics() {
  useSEO({
    title: "Statistics | Cardiology Scheduler",
    description: "Distribution, violations, and workload analytics (coming soon).",
    canonical: window.location.href,
  });

  const setup = loadSetup();
  const fellows = setup?.fellows ?? [];
  const schedule = loadCallSchedule();
  return (
    <main className="min-h-screen bg-background">
      <section className="container mx-auto px-4 py-8">
        <h1 className="text-2xl font-semibold font-display flex items-center gap-2">
          <HeartPulse className="h-6 w-6 text-primary" /> Statistics
        </h1>
        <div className="ecg-trace-static mt-2 mb-6" />
        <Tabs defaultValue="primary" className="mt-4">
          <TabsList>
            <TabsTrigger value="primary">Primary Call Statistics</TabsTrigger>
            <TabsTrigger value="jeopardy">Jeopardy Statistics</TabsTrigger>
            <TabsTrigger value="hf">Heart Failure Coverage Statistics</TabsTrigger>
            <TabsTrigger value="clinic">Clinic Statistics</TabsTrigger>
          </TabsList>
          <TabsContent value="primary">
            <Card>
              <CardHeader>
                <CardTitle>Primary Call Statistics</CardTitle>
              </CardHeader>
              <CardContent>
                <PrimaryCallStatsTable schedule={schedule} fellows={fellows} />
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="jeopardy">
            <Card>
              <CardHeader>
                <CardTitle>Jeopardy Statistics</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-muted-foreground">Coming soon.</div>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="hf">
            <Card>
              <CardHeader>
                <CardTitle>Heart Failure Coverage Statistics</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-muted-foreground">Coming soon.</div>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="clinic">
            <Card>
              <CardHeader>
                <CardTitle>Clinic Statistics</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-muted-foreground">Coming soon.</div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </section>
    </main>
  );
}
