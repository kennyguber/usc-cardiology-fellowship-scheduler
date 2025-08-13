import { useEffect, useMemo, useState } from "react";
import { HeartPulse, Loader2, RefreshCcw, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useSEO } from "@/lib/seo";
import { buildPrimaryCallSchedule, loadCallSchedule, saveCallSchedule, type CallSchedule } from "@/lib/call-engine";
import { loadSchedule, loadSetup, type PGY, type StoredSchedule } from "@/lib/schedule-engine";
import { computeAcademicYearHolidays } from "@/lib/holidays";
import { monthAbbrForIndex } from "@/lib/block-utils";
import { parseISO } from "date-fns";
import PrimaryCallEditDialog from "@/components/PrimaryCallEditDialog";

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
  const [priorSeeds, setPriorSeeds] = useState<Record<string, string>>({});
  const [editISO, setEditISO] = useState<string | null>(null);

  const toISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const seedsKey = useMemo(() => (setup?.yearStart ? `cfsa_calls_prior5_v1:${setup.yearStart}` : ""), [setup?.yearStart]);

  const priorDates = useMemo(() => {
    if (!setup?.yearStart) return [] as string[];
    const start = parseISO(setup.yearStart);
    const list: string[] = [];
    for (let i = 5; i >= 1; i--) {
      const d = new Date(start);
      d.setDate(d.getDate() - i);
      list.push(toISO(d));
    }
    return list;
  }, [setup?.yearStart]);

  useEffect(() => {
    const existing = loadCallSchedule();
    if (existing) setSchedule(existing);
  }, []);

  useEffect(() => {
    if (!seedsKey) return;
    try {
      const raw = localStorage.getItem(seedsKey);
      setPriorSeeds(raw ? JSON.parse(raw) : {});
    } catch {
      setPriorSeeds({});
    }
  }, [seedsKey]);

  const updateSeed = (iso: string, fid: string) => {
    const next = { ...priorSeeds, [iso]: fid };
    setPriorSeeds(next);
    try {
      if (seedsKey) localStorage.setItem(seedsKey, JSON.stringify(next));
    } catch {}
  };

  const allDays = useMemo(() => {
    if (!setup?.yearStart) return [] as string[];
    const start = parseISO(setup.yearStart);
    const end = new Date(start.getFullYear() + 1, 5, 30);
    const list: string[] = [];
    let cur = new Date(start);
    while (cur <= end) {
      list.push(toISO(cur));
      cur.setDate(cur.getDate() + 1);
    }
    return list;
  }, [setup?.yearStart]);

  const holidayMap = useMemo(() => {
    if (!setup?.yearStart) return {} as Record<string, string>;
    const map: Record<string, string> = {};
    for (const h of computeAcademicYearHolidays(setup.yearStart)) map[h.date] = h.name;
    return map;
  }, [setup?.yearStart]);

  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const months = useMemo(() => {
    if (!setup?.yearStart) return [] as { label: string; firstWeekday: number; daysInMonth: number; year: number; month: number }[];
    const start = parseISO(setup.yearStart);
    const list: { label: string; firstWeekday: number; daysInMonth: number; year: number; month: number }[] = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
      const label = d.toLocaleString(undefined, { month: "long", year: "numeric" });
      const firstWeekday = new Date(d.getFullYear(), d.getMonth(), 1).getDay();
      const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      list.push({ label, firstWeekday, daysInMonth, year: d.getFullYear(), month: d.getMonth() });
    }
    return list;
  }, [setup?.yearStart]);
  const fellowById = useMemo(() => Object.fromEntries(fellows.map((f) => [f.id, f] as const)), [fellows]);

  // Assign stable fellow color variants (f1..f15) based on fellows order
  const fellowColorVariants = [
    "f1","f2","f3","f4","f5","f6","f7","f8","f9","f10","f11","f12","f13","f14","f15",
  ] as const;
  const fellowColorById = useMemo(() => {
    const map: Record<string, (typeof fellowColorVariants)[number]> = {};
    fellows.forEach((f, idx) => {
      map[f.id] = fellowColorVariants[idx % fellowColorVariants.length];
    });
    return map;
  }, [fellows]);

  const schedByPGY = useMemo<Record<PGY, StoredSchedule | null>>(
    () => ({
      "PGY-4": loadSchedule("PGY-4"),
      "PGY-5": loadSchedule("PGY-5"),
      "PGY-6": loadSchedule("PGY-6"),
    }),
    []
  );

  const blockKeyForDate = (d: Date) => {
    const abbr = monthAbbrForIndex(d.getMonth());
    const half = d.getDate() <= 15 ? 1 : 2;
    return `${abbr}${half}`;
  };

  const rotationOnDate = (fid?: string, d?: Date) => {
    if (!fid || !d) return undefined;
    const f = fellowById[fid];
    if (!f) return undefined;
    const sched = schedByPGY[f.pgy];
    const row = sched?.byFellow?.[fid];
    if (!row) return undefined;
    return row[blockKeyForDate(d)];
  };

  const isWeekend = (d: Date) => {
    const dow = d.getDay();
    return dow === 0 || dow === 6;
  };

  const lastNameOf = (full?: string) => (full ? full.trim().split(/\s+/).slice(-1)[0] : "");

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

  const violations = useMemo(() => {
    if (!schedule || !setup) return [] as { iso: string; reason: string; fellow: string }[];
    const list: { iso: string; reason: string; fellow: string }[] = [];
    for (const [iso, fid] of Object.entries(schedule.days)) {
      if (!fid) continue;
      const d = parseISO(iso);
      const rot = rotationOnDate(fid, d);
      const name = fellowById[fid]?.name ?? fid;
      if (rot === "HF") list.push({ iso, reason: "HF rotation assigned to primary", fellow: name });
      const dow = d.getDay();
      if (rot === "EP" && (dow === 2 || dow === 4)) list.push({ iso, reason: "EP rotation assigned on Tue/Thu", fellow: name });
    }
    return list.sort((a, b) => a.iso.localeCompare(b.iso));
  }, [schedule, setup, fellowById, rotationOnDate]);

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const result = buildPrimaryCallSchedule({ priorPrimarySeeds: priorSeeds });
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

                {violations.length > 0 && (
                  <div className="mt-6">
                    <div className="text-sm font-medium mb-1 text-destructive">Rule violations</div>
                    <div className="text-sm text-muted-foreground space-y-1">
                      {violations.map((v) => (
                        <div key={`${v.iso}-${v.fellow}`}>{v.iso}: {v.fellow} — {v.reason}</div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="font-display">Prior 5 primary call assignments (pre-seed)</CardTitle>
          </CardHeader>
          <CardContent>
            {!setup ? (
              <div className="text-muted-foreground">Please complete Setup first.</div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {priorDates.map((iso) => (
                  <div key={iso} className="flex items-center gap-3">
                    <div className="w-28 text-sm text-muted-foreground">{iso}</div>
                    <Select value={priorSeeds[iso] ?? ""} onValueChange={(v) => updateSeed(iso, v)}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select fellow" />
                      </SelectTrigger>
                      <SelectContent>
                        {fellows.map((f) => (
                          <SelectItem key={f.id} value={f.id}>
                            {f.name} ({f.pgy})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="font-display">Schedule</CardTitle>
          </CardHeader>
          <CardContent>
            {!setup ? (
              <div className="text-muted-foreground">Please complete Setup first.</div>
            ) : (
              <>
                <Tabs defaultValue="table">
                <TabsList>
                  <TabsTrigger value="table">Table</TabsTrigger>
                  <TabsTrigger value="calendar">Calendar</TabsTrigger>
                </TabsList>
                <TabsContent value="table">
<Table containerClassName="mt-4 max-h-[70vh] overflow-auto">
  <TableHeader>
    <TableRow>
      <TableHead className="sticky top-0 z-[1] bg-background">Date</TableHead>
      <TableHead className="sticky top-0 z-[1] bg-background">Day</TableHead>
      <TableHead className="sticky top-0 z-[1] bg-background">Holiday</TableHead>
      <TableHead className="sticky top-0 z-[1] bg-background">Primary</TableHead>
      <TableHead className="sticky top-0 z-[1] bg-background">Jeopardy</TableHead>
      <TableHead className="sticky top-0 z-[1] bg-background">HF coverage</TableHead>
      <TableHead className="sticky top-0 z-[1] bg-background">HF fellow</TableHead>
      <TableHead className="sticky top-0 z-[1] bg-background">Vacation</TableHead>
      <TableHead className="sticky top-0 z-[1] bg-background">Clinic</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    {allDays.map((iso) => {
      const d = parseISO(iso);
      const dow = weekdays[d.getDay()];
      const fid = schedule?.days?.[iso];
      const rot = rotationOnDate(fid, d);
      const hol = holidayMap[iso] ?? "";
      const weekend = isWeekend(d);
      const rowClass = hol
        ? "bg-[hsl(var(--holiday))]"
        : weekend
        ? "bg-muted/70"
        : "";
      const primaryName = fid ? `${fellowById[fid]?.name ?? fid}${rot ? ` (${rot})` : ""}` : "—";
      const blockKey = blockKeyForDate(d);
      const hfIds = fellows
        .filter((f) => schedByPGY[f.pgy]?.byFellow?.[f.id]?.[blockKey] === "HF")
        .map((f) => f.id);
      const vacIds = fellows
        .filter((f) => schedByPGY[f.pgy]?.byFellow?.[f.id]?.[blockKey] === "VAC")
        .map((f) => f.id);
      return (
        <TableRow key={iso} className={rowClass}>
          <TableCell>{iso}</TableCell>
          <TableCell>{dow}</TableCell>
          <TableCell>{hol}</TableCell>
          <TableCell>
            {schedule ? (
              fid ? (
                <button onClick={() => setEditISO(iso)} aria-label={`Edit primary for ${iso}`} className="inline-flex">
                  <Badge variant={fellowColorById[fid]}>{primaryName}</Badge>
                </button>
              ) : (
                <Button variant="link" size="sm" onClick={() => setEditISO(iso)}>Assign</Button>
              )
            ) : (
              fid ? <Badge variant={fellowColorById[fid]}>{primaryName}</Badge> : "—"
            )}
          </TableCell>
          <TableCell>—</TableCell>
          <TableCell>—</TableCell>
          <TableCell>
            {hfIds.length ? (
              <div className="flex flex-wrap gap-1">
                {hfIds.map((id) => (
                  <Badge key={id} variant={fellowColorById[id]}>
                    {fellowById[id]?.name ?? id}
                  </Badge>
                ))}
              </div>
            ) : (
              "—"
            )}
          </TableCell>
          <TableCell>
            {vacIds.length ? (
              <div className="flex flex-wrap gap-1">
                {vacIds.map((id) => (
                  <Badge key={id} variant={fellowColorById[id]}>
                    {fellowById[id]?.name ?? id}
                  </Badge>
                ))}
              </div>
            ) : (
              "—"
            )}
          </TableCell>
          <TableCell>—</TableCell>
        </TableRow>
      );
    })}
  </TableBody>
</Table>
                </TabsContent>
                <TabsContent value="calendar">
                  <div className="mt-4 grid gap-6">
                    {months.map((m, idx) => (
                      <div key={idx}>
                        <div className="text-sm font-medium mb-2">{m.label}</div>
                        <div className="grid grid-cols-7 gap-2">
                          {Array.from({ length: m.firstWeekday }).map((_, i) => (
                            <div key={`e-${i}`} className="h-20 rounded-md bg-muted/30" />
                          ))}
{Array.from({ length: m.daysInMonth }).map((_, i) => {
  const day = i + 1;
  const iso = toISO(new Date(m.year, m.month, day));
  const fid = schedule?.days?.[iso];
  const name = fid ? (fellowById[fid]?.name ?? fid) : "";
  const last = lastNameOf(name) || "—";
  const hol = holidayMap[iso];
  const weekend = isWeekend(new Date(m.year, m.month, day));
  const cellBg = hol ? "bg-[hsl(var(--holiday))]" : weekend ? "bg-muted/70" : "bg-card";
  const rot = rotationOnDate(fid, new Date(m.year, m.month, day));
  return (
    <div key={iso} className={`h-20 rounded-md border ${cellBg} p-2 text-xs`}>
      <div className="flex items-center justify-between">
        <span className="font-medium">{day}</span>
        {hol ? <span className="px-1 py-0.5 rounded bg-muted text-muted-foreground">{hol}</span> : null}
      </div>
      <div className="mt-2 text-sm">
        {fid ? (
          schedule ? (
            <button onClick={() => setEditISO(iso)} aria-label={`Edit primary for ${iso}`} className="inline-flex">
              <Badge variant={fellowColorById[fid]}>
                {`${last}${rot ? ` (${rot})` : ""}`}
              </Badge>
            </button>
          ) : (
            <Badge variant={fellowColorById[fid]}>
              {`${last}${rot ? ` (${rot})` : ""}`}
            </Badge>
          )
        ) : (
          "—"
        )}
      </div>
    </div>
  );
})}
                        </div>
                      </div>
                    ))}
                  </div>
                </TabsContent>
              </Tabs>
              {editISO && schedule && (
                <PrimaryCallEditDialog
                  iso={editISO}
                  schedule={schedule}
                  onClose={() => setEditISO(null)}
                  onApply={(updated) => {
                    setSchedule(updated);
                    saveCallSchedule(updated);
                    const newUncovered = allDays.filter((d) => !updated.days[d]);
                    setUncovered(newUncovered);
                    setSuccess(newUncovered.length === 0);
                    setEditISO(null);
                  }}
                />
              )}
              </>
            )}
          </CardContent>
        </Card>

      </section>
    </main>
  );
}
