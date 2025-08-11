import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useSEO } from "@/lib/seo";
import { HeartPulse } from "lucide-react";

const Index = () => {
  useSEO({
    title: "Home | Cardiology Scheduler",
    description: "Sleek, offline-first cardiology fellowship scheduler.",
    canonical: window.location.origin + "/",
  });

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center animate-fade-in">
        <h1 className="text-4xl font-bold mb-2 font-display flex items-center justify-center gap-2">
          <HeartPulse className="h-8 w-8 text-primary" aria-hidden="true" />
          Cardiology Fellowship Scheduler
        </h1>
        <div className="ecg-divider mx-auto mb-6 opacity-60" aria-hidden="true" />
        <p className="text-xl text-muted-foreground mb-6">Start with Vacation Preferences, then build block and call schedules.</p>
        <Link to="/setup">
          <Button size="lg">Get Started</Button>
        </Link>
      </div>
    </div>
  );
};

export default Index;
