import { useEffect, useMemo, useState } from "react";
import { HeartPulse, Loader2, RefreshCcw, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useSEO } from "@/lib/seo";
import { buildPrimaryCallSchedule, loadCallSchedule, saveCallSchedule, type CallSchedule } from "@/lib/call-engine";
import { loadSetup } from "@/lib/schedule-engine";

export default function CallSchedule() {
  useSEO({
    title: "Primary Call Schedule | Cardiology Scheduler",
    description: "Generate a 365-day primary call schedule with strict eligibility and spacing rules.",
    canonical: window.location.href,
  });

  const setup = loadSetup();
  const fellows = setup?.fellows ?? [];
  const [schedule, setSchedule] = useState<CallSchedule | null>(null);
  const [loading, setLoading] = useState(false);
  const [uncovered, setUncovered] = useState<string[]>([]);
  const [success, setSuccess] = useState<boolean | null>(null);

  useEffect(() => {
    const existing = loadCallSchedule();
    if (existing) setSchedule(existing);
  }, []);

  const fellowById = useMemo(() => Object.fromEntries(fellows.map((f) => [f.id, f] as const)), [fellows]);

  const countsSorted = useMemo(() => {
    const entries = Object.entries(schedule?.countsByFellow ?? {});
    return entries
      .map(([fid, n]) => ({
        id: fid,
        n,
        name: fellowById[fid]?.name ?? fid,
        pgy: fellowById[fid]?.pgy ?? "",
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [schedule, fellowById]);

  const totalDays = useMemo(() => Object.keys(schedule?.days ?? {}).length, [schedule]);

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const result = buildPrimaryCallSchedule();
      setSchedule(result.schedule);
      setUncovered(result.uncovered ?? []);
      setSuccess(result.success);
      saveCallSchedule(result.schedule);
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setSchedule(null);
    setUncovered([]);
    setSuccess(null);
    try {
      localStorage.removeItem("cfsa_calls_v1");
    } catch {}
  };

  return (
    <main className="min-h-screen bg-background">
      <section className="container mx-auto px-4 py-8">
        <header className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold font-display flex items-center gap-2">
            <HeartPulse className="h-6 w-6 text-primary" /> Primary Call Schedule
          </h1>
          <div className="flex items-center gap-2">
            <Button onClick={handleGenerate} disabled={loading || !setup}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />} Generate
            </Button>
            <Button variant="outline" onClick={handleClear} disabled={loading}>
              <Trash2 className="h-4 w-4" /> Clear
            </Button>
          </div>
        </header>
        <div className="ecg-trace-static mt-2 mb-6" />

        <Card>
          <CardHeader>
            <CardTitle>Coverage Summary</CardTitle>
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

                <div className="mt-6">
                  <div className="text-sm font-medium mb-2">Call count by fellow</div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Fellow</TableHead>
                        <TableHead>PGY</TableHead>
                        <TableHead className="text-right">Calls</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {countsSorted.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={3} className="text-muted-foreground">
                            No schedule generated yet.
                          </TableCell>
                        </TableRow>
                      ) : (
                        countsSorted.map((r) => (
                          <TableRow key={r.id}>
                            <TableCell>{r.name}</TableCell>
                            <TableCell>{r.pgy}</TableCell>
                            <TableCell className="text-right">{r.n}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>

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
      </section>
    </main>
  );
}
