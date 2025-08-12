import { HeartPulse } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSEO } from "@/lib/seo";

export default function Statistics() {
  useSEO({
    title: "Statistics | Cardiology Scheduler",
    description: "Distribution, violations, and workload analytics (coming soon).",
    canonical: window.location.href,
  });

  return (
    <main className="min-h-screen bg-background">
      <section className="container mx-auto px-4 py-8">
        <h1 className="text-2xl font-semibold font-display flex items-center gap-2">
          <HeartPulse className="h-6 w-6 text-primary" /> Statistics
        </h1>
        <div className="ecg-trace-static mt-2 mb-6" />
        <Card>
          <CardHeader>
            <CardTitle>Coming soon</CardTitle>
          </CardHeader>
          <CardContent>
            Charts and tables for calls, rotations, spacing, and coverage will appear here.
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
