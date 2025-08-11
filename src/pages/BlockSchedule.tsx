import { HeartPulse } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSEO } from "@/lib/seo";

export default function BlockSchedule() {
  useSEO({
    title: "Block Schedule | Cardiology Scheduler",
    description: "Assign PGY-4/5/6 rotations with constraints (coming soon).",
    canonical: window.location.href,
  });

  return (
    <main className="min-h-screen bg-background">
      <section className="container mx-auto px-4 py-8">
        <h1 className="text-2xl font-semibold font-display flex items-center gap-2">
          <HeartPulse className="h-6 w-6 text-primary" /> Block Schedule
        </h1>
        <div className="ecg-divider mt-2 mb-6" />
        <Card>
          <CardHeader>
            <CardTitle>Coming soon</CardTitle>
          </CardHeader>
          <CardContent>
            This screen will build the academic block schedule based on your inputs and the full rule set.
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
