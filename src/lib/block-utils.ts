export type BlockInfo = {
  key: string; // e.g., JUL1
  monthIndex: number; // 0-11 relative to academic year start
  half: 1 | 2;
  label: string; // e.g., Jul 1–15
};

const MONTH_ABBR = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
] as const;

export function monthAbbrForIndex(index: number) {
  return MONTH_ABBR[(index + 12) % 12];
}

function lastDayOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

export function generateAcademicYearBlocks(startIsoDate: string): BlockInfo[] {
  const start = new Date(startIsoDate);
  if (isNaN(start.getTime())) {
    // Default to July 1 of current year
    const y = new Date().getFullYear();
    return generateAcademicYearBlocks(`${y}-07-01`);
  }
  const blocks: BlockInfo[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    const monthName = MONTH_ABBR[d.getMonth()];
    const lastDay = lastDayOfMonth(d);
    const firstLabel = `${d.toLocaleString(undefined, { month: "short" })} 1–15`;
    const secondLabel = `${d.toLocaleString(undefined, { month: "short" })} 16–${lastDay}`;
    blocks.push({ key: `${monthName}1`, monthIndex: i, half: 1, label: firstLabel });
    blocks.push({ key: `${monthName}2`, monthIndex: i, half: 2, label: secondLabel });
  }
  return blocks;
}

export function indexOfBlock(blocks: BlockInfo[], key?: string | null) {
  if (!key) return -1;
  return blocks.findIndex((b) => b.key === key);
}

export function hasMinSpacing(blocks: BlockInfo[], selectedKeys: (string | undefined)[], min = 6) {
  const indices = selectedKeys
    .map((k) => indexOfBlock(blocks, k))
    .filter((i) => i >= 0)
    .sort((a, b) => a - b);
  for (let i = 1; i < indices.length; i++) {
    if (indices[i] - indices[i - 1] < min) return false;
  }
  return true;
}
