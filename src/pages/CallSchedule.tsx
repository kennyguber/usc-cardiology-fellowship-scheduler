import { HeartPulse } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSEO } from "@/lib/seo";

export default function CallSchedule() {
  useSEO({
    title: "Call Schedule | Cardiology Scheduler",
    description: "Primary call, jeopardy, and HF weekend coverage (coming soon).",
    canonical: window.location.href,
  });

  return (
    <main className="min-h-screen bg-background">
      <section className="container mx-auto px-4 py-8">
        <h1 className="text-2xl font-semibold font-display flex items-center gap-2">
          <HeartPulse className="h-6 w-6 text-primary" /> Call Schedule
        </h1>
        <div className="ecg-trace-static mt-2 mb-6" />
        <Card>
          <CardHeader>
            <CardTitle>Coming soon</CardTitle>
          </CardHeader>
          <CardContent>
            This screen will generate daily call and coverage assignments with spacing and holiday rules.
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
