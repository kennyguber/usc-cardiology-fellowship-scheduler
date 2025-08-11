import { useMemo, useRef, useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useSEO } from "@/lib/seo";
import { BlockInfo, generateAcademicYearBlocks, hasMinSpacing } from "@/lib/block-utils";
import { HeartPulse } from "lucide-react";
import { computeAcademicYearHolidays } from "@/lib/holidays";

export type PGY = "PGY-4" | "PGY-5" | "PGY-6";
export type Fellow = { id: string; name: string; pgy: PGY; vacationPrefs: (string | undefined)[] };
export type Holiday = { id: string; date: string; name: string };

const STORAGE_KEY = "cfsa_setup_v1";

type AppSetup = {
  yearStart: string; // ISO date
  fellows: Fellow[];
  holidays: Holiday[];
};

const defaultYearStart = () => {
  const now = new Date();
  const year = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  return `${year}-07-01`;
};

function useSetupState() {
  const [raw, setRaw] = useState<AppSetup>(() => {
    try {
      const item = localStorage.getItem(STORAGE_KEY);
      return item
        ? (JSON.parse(item) as AppSetup)
        : { yearStart: defaultYearStart(), fellows: [], holidays: [] };
    } catch {
      return { yearStart: defaultYearStart(), fellows: [], holidays: [] };
    }
  });

  const save = (next: AppSetup) => {
    setRaw(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };

  return [raw, save] as const;
}

function FellowRow({
  fellow,
  blocks,
  onChange,
  onRemove,
}: {
  fellow: Fellow;
  blocks: BlockInfo[];
  onChange: (f: Fellow) => void;
  onRemove: () => void;
}) {
  const spacingOk = hasMinSpacing(blocks, fellow.vacationPrefs, 6);
  return (
    <TableRow className="animate-fade-in">
      <TableCell>
        <Input
          value={fellow.name}
          placeholder="Name"
          onChange={(e) => onChange({ ...fellow, name: e.target.value })}
        />
      </TableCell>
      <TableCell className="min-w-[140px]">
        <Select
          value={fellow.pgy}
          onValueChange={(v) => onChange({ ...fellow, pgy: v as any })}
        >
          <SelectTrigger>
            <SelectValue placeholder="PGY" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="PGY-4">PGY-4</SelectItem>
            <SelectItem value="PGY-5">PGY-5</SelectItem>
            <SelectItem value="PGY-6">PGY-6</SelectItem>
          </SelectContent>
        </Select>
      </TableCell>
      {[0, 1, 2, 3].map((i) => (
        <TableCell key={i} className="min-w-[160px]">
          <Select
            value={fellow.vacationPrefs[i]}
            onValueChange={(v) => {
              const vp = [...fellow.vacationPrefs];
              vp[i] = v;
              onChange({ ...fellow, vacationPrefs: vp });
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder={`Pref ${i + 1}`} />
            </SelectTrigger>
            <SelectContent>
              {blocks.map((b) => (
                <SelectItem key={b.key} value={b.key}>
                  {b.key} – {b.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </TableCell>
      ))}
      <TableCell className="text-right space-x-2">
        {!spacingOk ? (
          <Badge variant="destructive">Spacing &lt; 6 blocks</Badge>
        ) : (
          <Badge variant="secondary">OK</Badge>
        )}
        <Button variant="ghost" onClick={onRemove}>
          Remove
        </Button>
      </TableCell>
    </TableRow>
  );
}

export default function VacationPreferences() {
  useSEO({
    title: "Vacation Preferences | Cardiology Scheduler",
    description:
      "Configure fellows, academic year, and holidays. Offline-first with auto-save and JSON import/export.",
    canonical: window.location.href,
  });

  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [setup, save] = useSetupState();
  const blocks = useMemo(() => generateAcademicYearBlocks(setup.yearStart), [setup.yearStart]);

  // Auto-generate the 13 holidays whenever the start date changes
  useEffect(() => {
    const defaults = computeAcademicYearHolidays(setup.yearStart);
    save({ ...setup, holidays: defaults });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setup.yearStart]);

  const addFellow = () => {
    const id = crypto.randomUUID();
    save({
      ...setup,
      fellows: [
        ...setup.fellows,
        { id, name: "", pgy: "PGY-4", vacationPrefs: [undefined, undefined, undefined, undefined] },
      ],
    });
  };

  const updateFellow = (id: string, next: Fellow) => {
    save({
      ...setup,
      fellows: setup.fellows.map((f) => (f.id === id ? next : f)),
    });
  };

  const removeFellow = (id: string) => {
    save({ ...setup, fellows: setup.fellows.filter((f) => f.id !== id) });
  };


  const updateHoliday = (id: string, data: Partial<Holiday>) => {
    save({
      ...setup,
      holidays: setup.holidays.map((h) => (h.id === id ? { ...h, ...data } : h)),
    });
  };


  const exportJSON = () => {
    const data = JSON.stringify(setup, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "vacation-setup.json";
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Exported", description: "Configuration downloaded." });
  };

  const importJSON = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as AppSetup;
        if (!parsed || !("yearStart" in parsed)) throw new Error("Invalid file");
        save(parsed);
        toast({ title: "Imported", description: "Configuration loaded." });
      } catch (e) {
        toast({ variant: "destructive", title: "Import failed", description: "Invalid JSON file." });
      }
    };
    reader.readAsText(file);
  };

  return (
    <main className="min-h-screen bg-background">
      <section className="container mx-auto px-4 py-10">
        <div className="flex items-end justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold font-display flex items-center gap-2">
              <HeartPulse className="h-6 w-6 text-primary" aria-hidden="true" />
              Vacation Preferences
            </h1>
            <div className="ecg-divider mt-2" aria-hidden="true" />
          </div>
          <div className="flex gap-2">
            <Input
              type="file"
              accept="application/json"
              ref={fileRef}
              className="hidden"
              onChange={(e) => importJSON(e.target.files?.[0])}
            />
            <Button variant="outline" onClick={() => fileRef.current?.click()}>
              Import JSON
            </Button>
            <Button onClick={exportJSON}>Export JSON</Button>
            <Link to="/">
              <Button variant="ghost">Home</Button>
            </Link>
          </div>
        </div>

        <Tabs defaultValue="fellows">
          <TabsList>
            <TabsTrigger value="fellows">Fellows</TabsTrigger>
            <TabsTrigger value="holidays">Holidays</TabsTrigger>
          </TabsList>

          <TabsContent value="fellows" className="mt-6 animate-fade-in">
            <Card className="mb-6">
              <CardHeader>
                <CardTitle className="font-display">Fellowship Start Date</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <Label className="mb-1 block">Fellowship start date</Label>
                    <Input
                      type="date"
                      value={setup.yearStart}
                      onChange={(e) => save({ ...setup, yearStart: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground mt-2">
                      Generates 24 two-week blocks (e.g., JUL1, JUL2) used throughout scheduling.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="font-display">Fellows and Vacation Preferences</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex justify-between mb-4">
                  <p className="text-sm text-muted-foreground">
                    Add fellows, set PGY level, and choose their top four vacation blocks. Spacing rule: ≥ 6 blocks.
                  </p>
                  <Button onClick={addFellow}>Add Fellow</Button>
                </div>
                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>PGY</TableHead>
                        <TableHead>Pref 1</TableHead>
                        <TableHead>Pref 2</TableHead>
                        <TableHead>Pref 3</TableHead>
                        <TableHead>Pref 4</TableHead>
                        <TableHead className="text-right">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {setup.fellows.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center text-muted-foreground">
                            No fellows yet. Click "Add Fellow" to begin.
                          </TableCell>
                        </TableRow>
                      ) : (
                        setup.fellows.map((f) => (
                          <FellowRow
                            key={f.id}
                            fellow={f}
                            blocks={blocks}
                            onChange={(next) => updateFellow(f.id, next)}
                            onRemove={() => removeFellow(f.id)}
                          />
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>


          <TabsContent value="holidays" className="mt-6 animate-fade-in">
            <Card>
              <CardHeader>
                <CardTitle className="font-display">Holidays</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex justify-between items-center mb-4">
                  <p className="text-sm text-muted-foreground">
                    These 13 holidays are auto-generated from the Fellowship start date. Edit dates as needed. Changing the start date will reset them.
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => save({ ...setup, holidays: computeAcademicYearHolidays(setup.yearStart) })}
                  >
                    Reset to defaults
                  </Button>
                </div>

                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Holiday</TableHead>
                        <TableHead style={{ width: 180 }}>Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {setup.holidays.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={2} className="text-center text-muted-foreground">
                            Holidays will appear here based on the start date.
                          </TableCell>
                        </TableRow>
                      ) : (
                        setup.holidays
                          .slice()
                          .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
                          .map((h) => (
                            <TableRow key={h.id}>
                              <TableCell className="font-medium">{h.name}</TableCell>
                              <TableCell>
                                <Input
                                  type="date"
                                  value={h.date}
                                  onChange={(e) => updateHoliday(h.id, { date: e.target.value })}
                                />
                              </TableCell>
                            </TableRow>
                          ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </section>
    </main>
  );
}
