// Plan morning-digest § 1. The contract every part of § 2 builds on: one row per job for a night.
export type RunStatus = 'ok' | 'retry' | 'fail';

export type DigestRow = {
  job: string;
  owner: string | null; // from the job's last line; null renders as —
  runs: number; // lines for this job
  retries: number; // lines with status retry
  lastStatus: RunStatus;
  lastError: string | null; // most recent error seen for this job, even if it later went ok
  firstAt: string; // as in the log, offset kept
  lastAt: string;
};

export type Night = {
  night: string; // YYYY-MM-DD
  rows: DigestRow[]; // sorted by job, so page and JSON agree
  counts: Record<RunStatus, number>; // lines per status, for the board
  badLines: number; // lines that didn't parse or lacked a field; counted, never thrown
};

// null: no file for that night (or not a YYYY-MM-DD night).
export type ReadNight = (runsDir: string, night: string) => Night | null;
