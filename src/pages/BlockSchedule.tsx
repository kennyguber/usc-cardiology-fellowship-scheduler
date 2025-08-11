import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { HeartPulse, Download, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSEO } from "@/lib/seo";
import { generateAcademicYearBlocks, type BlockInfo, hasMinSpacing } from "@/lib/block-utils";
import {
  buildVacationScheduleForPGY,
  countByBlock,
  loadSchedule,
  loadSetup,
  saveSchedule,
  type Fellow,
  type PGY,
  type StoredSchedule,
} from "@/lib/schedule-engine";
import { useToast } from "@/hooks/use-toast";

export default function BlockSchedule() {
  useSEO({
    title: "Block Schedule | Cardiology Scheduler",
    description: "Build each PGY year schedule. Step 1: place vacations, then rotations.",
    canonical: window.location.href,
  });

  const { toast } = useToast();
  const setup = loadSetup();
  const [activePGY, setActivePGY] = useState<PGY | "TOTAL">("PGY-4");
  const [blocks, setBlocks] = useState<BlockInfo[]>(() =>
    generateAcademicYearBlocks(toAcademicYearJuly1(setup?.yearStart ?? new Date().toISOString().slice(0, 10)))
  );
const fellows: Fellow[] = useMemo(
    () =>
      setup
        ? activePGY === "TOTAL"
          ? setup.fellows
          : setup.fellows.filter((f) => f.pgy === activePGY)
        : [],
    [setup, activePGY]
  );

  const [schedule, setSchedule] = useState<StoredSchedule | null>(() => (activePGY === "TOTAL" ? null : loadSchedule(activePGY as PGY)));

  useEffect(() => {
    setBlocks(
      generateAcademicYearBlocks(toAcademicYearJuly1(setup?.yearStart ?? new Date().toISOString().slice(0, 10)))
    );
  }, [setup?.yearStart]);

useEffect(() => {
    if (activePGY === "TOTAL") {
      setSchedule(null);
    } else {
      setSchedule(loadSchedule(activePGY as PGY));
    }
  }, [activePGY]);

const sortedBlocks = useMemo(() => sortJulToJun(blocks), [blocks]);
  const displayByFellow = useMemo(() => {
    if (activePGY === "TOTAL") {
      const total: Record<string, Record<string, string | undefined>> = {};
      (["PGY-4", "PGY-5", "PGY-6"] as PGY[]).forEach((p) => {
        const s = loadSchedule(p);
        if (s && s.byFellow) {
          Object.assign(total, s.byFellow);
        }
      });
      return total;
    }
    return schedule?.byFellow ?? {};
  }, [activePGY, schedule]);
  const counts = useMemo(() => countByBlock(displayByFellow), [displayByFellow]);
  const fellowValidations = useMemo(() => {
    return fellows.map((f) => {
      const entries = displayByFellow[f.id] ?? {};
      const vacKeys = Object.entries(entries)
        .filter(([, v]) => v === "VAC")
        .map(([k]) => k);
      return { id: f.id, name: f.name, count: vacKeys.length, spacingOk: hasMinSpacing(sortedBlocks, vacKeys, 6) };
    });
  }, [fellows, sortedBlocks, displayByFellow]);
const handleBuildVacations = () => {
    if (!setup) {
      toast({ variant: "destructive", title: "No setup found", description: "Please configure fellows first." });
      return;
    }
    if (activePGY === "TOTAL") {
      toast({
        variant: "destructive",
        title: "Select a PGY year",
        description: "Choose PGY-4, PGY-5, or PGY-6 to place vacations.",
      });
      return;
    }
    const result = buildVacationScheduleForPGY(fellows, blocks, { randomize: true });
    if (!result.success) {
      toast({
        variant: "destructive",
        title: "Unable to place vacations",
        description: (result.conflicts && result.conflicts[0]) || "No assignment satisfies all constraints.",
      });
      return;
    }
    const next: StoredSchedule = { version: 1, pgy: activePGY, byFellow: result.byFellow };
    saveSchedule(activePGY, next);
    setSchedule(next);
    toast({ title: "Vacations placed", description: `Draft schedule built for ${activePGY}.` });
  };

const exportCSV = () => {
    const header = ["Fellow", ...sortedBlocks.map((b) => b.key)].join(",");
    const rows = fellows.map((f) => {
      const row = sortedBlocks.map((b) => displayByFellow[f.id]?.[b.key] ?? "");
      return [quote(f.name || f.id), ...row.map(quote)].join(",");
    });
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${activePGY}_block_schedule.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!setup) {
    return (
      <main className="min-h-screen bg-background">
        <section className="container mx-auto px-4 py-10">
          <h1 className="text-2xl font-semibold font-display flex items-center gap-2">
            <HeartPulse className="h-6 w-6 text-primary" /> Block Schedule
          </h1>
          <div className="ecg-divider mt-2 mb-6" />
          <Card>
            <CardHeader>
              <CardTitle>Setup required</CardTitle>
            </CardHeader>
            <CardContent>
              Please configure fellows and vacations first.
              <div className="mt-4">
                <Link to="/setup">
                  <Button>Go to Vacation Preferences</Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background">
      <section className="container mx-auto px-4 py-8">
        <h1 className="text-2xl font-semibold font-display flex items-center gap-2">
          <HeartPulse className="h-6 w-6 text-primary" /> Block Schedule
        </h1>
        <div className="ecg-divider mt-2 mb-6" />

        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="font-display">Build by PGY year</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="text-sm text-muted-foreground">
                Academic year start: <span className="font-medium text-foreground">{setup.yearStart}</span>
              </div>
              <div className="flex items-center gap-2">
<Tabs value={activePGY} onValueChange={(v) => setActivePGY(v as PGY | "TOTAL")}>
                  <TabsList>
                    <TabsTrigger value="PGY-4">PGY-4</TabsTrigger>
                    <TabsTrigger value="PGY-5">PGY-5</TabsTrigger>
                    <TabsTrigger value="PGY-6">PGY-6</TabsTrigger>
                    <TabsTrigger value="TOTAL">TOTAL</TabsTrigger>
                  </TabsList>
                </Tabs>
<Button variant="outline" onClick={handleBuildVacations} disabled={activePGY === "TOTAL"}>
                  <RefreshCw className="mr-2 h-4 w-4" /> Place Vacations
                </Button>
                <Button variant="outline" onClick={exportCSV} disabled={fellows.length === 0}>
                  <Download className="mr-2 h-4 w-4" /> Export CSV
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 md:grid-cols-3">
          <div className="md:col-span-2 rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[220px] sticky left-0 bg-background z-10">Fellow</TableHead>
                  <TableHead className="min-w-[200px]">Prefs</TableHead>
                  {sortedBlocks.map((b) => (
                    <TableHead key={b.key} className="text-center min-w-[90px]">
                      <div className="font-mono text-xs">{b.key}</div>
                      <div className="text-[10px] text-muted-foreground">{b.label}</div>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {fellows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={2 + sortedBlocks.length} className="text-center text-muted-foreground">
                      No fellows for {activePGY}.
                    </TableCell>
                  </TableRow>
                ) : (
                  fellows.map((f) => (
                    <TableRow key={f.id}>
                      <TableCell className="min-w-[220px] sticky left-0 bg-background z-10 font-medium">
                        {f.name || <span className="text-muted-foreground">Unnamed fellow</span>}
                      </TableCell>
                      <TableCell className="min-w-[200px]">
                        <div className="flex flex-wrap gap-1">
                          {Array.from(new Set((f.vacationPrefs || []).filter((k): k is string => !!k))).length > 0 ? (
                            Array.from(new Set((f.vacationPrefs || []).filter((k): k is string => !!k))).map((k) => (
                              <Badge key={k} variant={displayByFellow[f.id]?.[k] === "VAC" ? "destructive" : "secondary"}>{k}</Badge>
                            ))
                          ) : (
                            <span className="text-xs text-muted-foreground">No prefs</span>
                          )}
                        </div>
                      </TableCell>
                      {sortedBlocks.map((b) => (
                        <TableCell key={b.key} className="text-center">
                          {displayByFellow[f.id]?.[b.key] === "VAC" ? (
                            <Badge variant="destructive">Vacation</Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">&nbsp;</span>
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="font-display">Validation</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-sm text-muted-foreground">
                  Rule: exactly 2 vacations per fellow, at least 3 months apart.
                </div>
                <div>
                  <div className="text-sm mb-1">Per-block vacation counts:</div>
                  <div className="flex flex-wrap gap-2">
                    {sortedBlocks.map((b) => (
                      <Badge key={b.key} variant={counts[b.key] && counts[b.key] > 1 ? "destructive" : "secondary"}>
                        {b.key}: {counts[b.key] ?? 0}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-sm mb-1">Per-fellow status:</div>
                  <div className="flex flex-col gap-1">
                    {fellows.map((f) => {
                      const v = fellowValidations.find((x) => x.id === f.id);
                      const ok = v && v.count === 2 && v.spacingOk;
                      return (
                        <div key={f.id} className="flex items-center justify-between text-sm">
                          <span className="truncate">{f.name || "Unnamed fellow"}</span>
                          <Badge variant={ok ? "secondary" : "destructive"}>
                            {v ? `${v.count} vacations${!v.spacingOk ? ", spacing < 3 mo" : ""}` : "0 vacations"}
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                </div>
{Object.keys(displayByFellow).length === 0 && (
                    <div className="text-xs text-muted-foreground">Run "Place Vacations" to generate a draft.</div>
                  )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="font-display">Next steps</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground space-y-2">
                <p>1. Encode rotation catalog and capacities.</p>
                <p>2. Add eligibility rules per PGY.</p>
                <p>3. Fill rotations with backtracking solver.</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>
    </main>
  );
}

function quote(s: string) {
  if (s.includes(",") || s.includes("\n") || s.includes('"')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function toAcademicYearJuly1(startIso: string): string {
  const d = new Date(startIso);
  if (isNaN(d.getTime())) {
    const y = new Date().getFullYear();
    return `${y}-07-01`;
  }
  const y = d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-07-01`;
}

const MONTH_ORDER = [
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
] as const;

function sortJulToJun(blocks: BlockInfo[]): BlockInfo[] {
  const order = new Map<string, number>(MONTH_ORDER.map((m, i) => [m, i] as const));
  return [...blocks].sort((a, b) => {
    const oa = order.get(a.key.slice(0, 3)) ?? 0;
    const ob = order.get(b.key.slice(0, 3)) ?? 0;
    if (oa !== ob) return oa - ob;
    return a.half - b.half;
  });
}
