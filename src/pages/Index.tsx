import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useSEO } from "@/lib/seo";

const Index = () => {
  useSEO({
    title: "Home | Cardiology Scheduler",
    description: "Sleek, offline-first cardiology fellowship scheduler.",
    canonical: window.location.origin + "/",
  });

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center animate-fade-in">
        <h1 className="text-4xl font-bold mb-4">Cardiology Fellowship Scheduler</h1>
        <p className="text-xl text-muted-foreground mb-6">Start with Vacation Preferences, then build block and call schedules.</p>
        <Link to="/setup">
          <Button size="lg">Get Started</Button>
        </Link>
      </div>
    </div>
  );
};

export default Index;
