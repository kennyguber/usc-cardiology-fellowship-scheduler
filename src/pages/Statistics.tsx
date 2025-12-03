import { useState, useEffect, useMemo } from "react";
import { useLocation } from "react-router-dom";
import { HeartPulse, Loader2, RefreshCcw, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useSEO } from "@/lib/seo";
import { usePersistentTab } from "@/hooks/use-persistent-tab";
import { useTabScrollRestoration } from "@/hooks/use-tab-scroll-restoration";
import { loadSetup } from "@/lib/schedule-engine";
import { buildPrimaryCallSchedule, loadCallSchedule, saveCallSchedule, saveCoverageMetadata, loadCoverageMetadata, clearCoverageMetadata, optimizePGY4WkndHolEquity, type CallSchedule } from "@/lib/call-engine";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import PrimaryCallStatsTable from "@/components/PrimaryCallStatsTable";
import HFCoverageStatsTable from "@/components/HFCoverageStatsTable";
import JeopardyStatsTable from "@/components/JeopardyStatsTable";
import ClinicStatsTable from "@/components/ClinicStatsTable";

export default function Statistics() {
  const location = useLocation();
  
  useSEO({
    title: "Statistics | Cardiology Scheduler",
    description: "Distribution, violations, and workload analytics (coming soon).",
    canonical: window.location.href,
  });

  const setup = loadSetup();
  const fellows = setup?.fellows ?? [];
  const [schedule, setSchedule] = useState<CallSchedule | null>(null);
  const [loading, setLoading] = useState(false);
  const [uncovered, setUncovered] = useState<string[]>([]);
  const [success, setSuccess] = useState<boolean | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [pgy4Stats, setPgy4Stats] = useState<Array<{ id: string; name: string; wkndHolCount: number }>>([]);
  const [activeTab, setActiveTab] = usePersistentTab('statistics', 'primary');
  
  useTabScrollRestoration(location.pathname, activeTab);

  useEffect(() => {
    const existing = loadCallSchedule();
    if (existing) setSchedule(existing);
    
    const metadata = loadCoverageMetadata();
    if (metadata) {
      setUncovered(metadata.uncovered);
      setSuccess(metadata.success);
    }
  }, []);

  const totalDays = useMemo(() => Object.keys(schedule?.days ?? {}).length, [schedule]);

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const result = buildPrimaryCallSchedule({ priorPrimarySeeds: {} });
      setSchedule(result.schedule);
      setUncovered(result.uncovered ?? []);
      setSuccess(result.success);
      saveCallSchedule(result.schedule);
      saveCoverageMetadata({ uncovered: result.uncovered ?? [], success: result.success });
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setSchedule(null);
    setUncovered([]);
    setSuccess(null);
    setPgy4Stats([]);
    try {
      localStorage.removeItem("cfsa_calls_v1");
      clearCoverageMetadata();
    } catch {}
  };

  const handleOptimizePGY4 = async () => {
    if (!schedule) return;
    setOptimizing(true);
    try {
      const result = optimizePGY4WkndHolEquity(schedule);
      setSchedule(result.schedule);
      setPgy4Stats(result.pgy4Stats);
      saveCallSchedule(result.schedule);
      // Show success message with number of swaps
      console.log(`Applied ${result.swapsApplied} swaps to optimize PGY-4 weekend/holiday equity`);
    } finally {
      setOptimizing(false);
    }
  };

  return (
    <main className="min-h-screen bg-background">
      <section className="container mx-auto px-4 py-8">
        <h1 className="text-2xl font-semibold font-display flex items-center gap-2">
          <HeartPulse className="h-6 w-6 text-primary" /> Statistics
        </h1>
        <div className="ecg-trace-static mt-2 mb-6" />
        <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-4">
          <TabsList>
            <TabsTrigger value="primary">Primary Call Statistics</TabsTrigger>
            <TabsTrigger value="hf">HF Coverage Statistics</TabsTrigger>
            <TabsTrigger value="jeopardy">Jeopardy Statistics</TabsTrigger>
            <TabsTrigger value="clinic">Clinic Statistics</TabsTrigger>
          </TabsList>
          <TabsContent value="primary" className="space-y-6">
            <div className="flex items-center justify-end gap-2">
              <Button onClick={handleGenerate} disabled={loading || !setup}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />} Generate
              </Button>
              {schedule && (
                <Button variant="secondary" onClick={handleOptimizePGY4} disabled={optimizing || loading}>
                  {optimizing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />} Optimize PGY-4
                </Button>
              )}
              <Button variant="outline" onClick={handleClear} disabled={loading}>
                <Trash2 className="h-4 w-4" /> Clear
              </Button>
            </div>
            
            <Card>
              <CardHeader>
                <CardTitle className="font-display">Coverage Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {!setup ? (
                  <div className="text-muted-foreground">Please complete Setup and Block schedules first.</div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                      <div>
                        <div className="text-xs text-muted-foreground">Academic year start</div>
                        <div className="font-medium">{setup.yearStart}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Fellows</div>
                        <div className="font-medium">{fellows.length}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Assigned days</div>
                        <div className="font-medium">{totalDays}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Uncovered days</div>
                        <div className={`font-medium ${success ? "text-primary" : uncovered.length ? "text-destructive" : ""}`}>
                          {uncovered.length}
                        </div>
                      </div>
                    </div>
                    {typeof success === "boolean" && (
                      <div className={`text-sm ${success ? "text-primary" : "text-destructive"}`}>
                        {success ? "Complete coverage achieved." : "Some days could not be assigned under strict rules."}
                      </div>
                    )}

                    {uncovered.length > 0 && (
                      <div className="mt-6">
                        <div className="text-sm font-medium mb-1">Uncovered dates</div>
                        <div className="text-sm text-muted-foreground break-words">
                          {uncovered.join(", ")}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            {pgy4Stats.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="font-display">PGY-4 Weekend/Holiday Equity</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
                    {pgy4Stats.map(fellow => (
                      <div key={fellow.id}>
                        <div className="text-xs text-muted-foreground">{fellow.name}</div>
                        <div className="font-medium">{fellow.wkndHolCount} calls</div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardContent>
                <PrimaryCallStatsTable schedule={schedule} fellows={fellows} />
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="hf">
            <Card>
              <CardHeader>
                <CardTitle>HF Coverage Statistics</CardTitle>
              </CardHeader>
              <CardContent>
                <HFCoverageStatsTable fellows={fellows} />
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="jeopardy">
            <Card>
              <CardHeader>
                <CardTitle>Jeopardy Statistics</CardTitle>
              </CardHeader>
              <CardContent>
                <JeopardyStatsTable fellows={fellows} />
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="clinic">
            <Card>
              <CardHeader>
                <CardTitle>Clinic Statistics</CardTitle>
              </CardHeader>
              <CardContent>
                <ClinicStatsTable fellows={fellows} callSchedule={schedule} />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </section>
    </main>
  );
}
