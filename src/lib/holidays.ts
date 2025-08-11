export type HolidayDef = {
  id: string;
  name: string;
  date: string; // ISO YYYY-MM-DD
};

function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function nthWeekdayOfMonth(year: number, monthIndex: number, weekday: number, n: number): Date {
  // weekday: 0=Sunday ... 6=Saturday
  const first = new Date(year, monthIndex, 1);
  const firstWeekday = first.getDay();
  const delta = (weekday - firstWeekday + 7) % 7;
  const day = 1 + delta + (n - 1) * 7;
  return new Date(year, monthIndex, day);
}

function lastWeekdayOfMonth(year: number, monthIndex: number, weekday: number): Date {
  const last = new Date(year, monthIndex + 1, 0); // last day of month
  const lastWeekday = last.getDay();
  const delta = (lastWeekday - weekday + 7) % 7;
  return new Date(year, monthIndex + 1, 0 - delta);
}

export function computeAcademicYearHolidays(startIsoDate: string): HolidayDef[] {
  const start = new Date(startIsoDate);
  if (isNaN(start.getTime())) return [];
  const startYear = start.getFullYear();
  const nextYear = startYear + 1;

  const july4 = new Date(startYear, 6, 4);
  const laborDay = nthWeekdayOfMonth(startYear, 8, 1, 1); // Sep, Monday, 1st
  const indigenous = nthWeekdayOfMonth(startYear, 9, 1, 2); // Oct, Monday, 2nd
  const veterans = new Date(startYear, 10, 11); // Nov 11
  const thanksgiving = nthWeekdayOfMonth(startYear, 10, 4, 4); // Nov, Thursday, 4th
  const dayAfterThanksgiving = new Date(thanksgiving);
  dayAfterThanksgiving.setDate(thanksgiving.getDate() + 1);
  const christmas = new Date(startYear, 11, 25); // Dec 25

  const newYears = new Date(nextYear, 0, 1); // Jan 1
  const mlk = nthWeekdayOfMonth(nextYear, 0, 1, 3); // Jan, Monday, 3rd
  const presidents = nthWeekdayOfMonth(nextYear, 1, 1, 3); // Feb, Monday, 3rd
  const cesarChavez = new Date(nextYear, 2, 31); // Mar 31
  const memorial = lastWeekdayOfMonth(nextYear, 4, 1); // May, Monday (last)
  const juneteenth = new Date(nextYear, 5, 19); // Jun 19

  const list: HolidayDef[] = [
    { id: "INDEPENDENCE_DAY", name: "Independence Day", date: toISO(july4) },
    { id: "LABOR_DAY", name: "Labor Day", date: toISO(laborDay) },
    { id: "INDIGENOUS_PEOPLES_DAY", name: "Indigenous Peoples Day", date: toISO(indigenous) },
    { id: "VETERANS_DAY", name: "Veterans Day", date: toISO(veterans) },
    { id: "THANKSGIVING", name: "Thanksgiving", date: toISO(thanksgiving) },
    { id: "DAY_AFTER_THANKSGIVING", name: "Day after Thanksgiving", date: toISO(dayAfterThanksgiving) },
    { id: "CHRISTMAS_DAY", name: "Christmas Day", date: toISO(christmas) },
    { id: "NEW_YEARS_DAY", name: "New Year's Day", date: toISO(newYears) },
    { id: "MLK_DAY", name: "MLK Day", date: toISO(mlk) },
    { id: "PRESIDENTS_DAY", name: "Presidents Day", date: toISO(presidents) },
    { id: "CESAR_CHAVEZ_DAY", name: "Cesar Chavez Day", date: toISO(cesarChavez) },
    { id: "MEMORIAL_DAY", name: "Memorial Day", date: toISO(memorial) },
    { id: "JUNETEENTH", name: "Juneteenth", date: toISO(juneteenth) },
  ];

  return list;
}
