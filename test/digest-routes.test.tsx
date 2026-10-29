import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Night } from '../src/digest/types.js';

const l = (at: string, job: string, status: string, owner: string | null, error?: string) =>
  JSON.stringify({ at, job, status, owner, ...(error ? { error } : {}) });

const GOOD = [
  l('2026-10-29T01:00:00+01:00', 'a/alpha', 'ok', 'ann'),
  l('2026-10-29T01:10:00+01:00', 'b/flaky', 'retry', 'bob', 'timeout'),
  l('2026-10-29T01:11:00+01:00', 'b/flaky', 'retry', 'bob', 'timeout'),
  l('2026-10-29T01:12:00+01:00', 'b/flaky', 'retry', 'bob', 'timeout'),
  l('2026-10-29T01:13:00+01:00', 'b/flaky', 'ok', 'bob'),
  l('2026-10-29T01:20:00+01:00', 'c/broken', 'fail', null, 'boom'),
  l('2026-10-29T01:30:00+01:00', 'd/fine', 'ok', 'dee'),
].join('\n');

const BAD = [
  l('2026-10-29T01:00:00+01:00', 'a/alpha', 'ok', 'ann'),
  '{not json',
  l('2026-10-29T01:05:00+01:00', 'd/fine', 'ok', 'dee'),
].join('\n');

let app: ReturnType<typeof createApp>;

beforeAll(() => {
  const runsDir = mkdtempSync(join(tmpdir(), 'rig-routes-'));
  writeFileSync(join(runsDir, '2026-10-01.jsonl'), GOOD + '\n');
  writeFileSync(join(runsDir, '2026-10-02.jsonl'), '');
  writeFileSync(join(runsDir, '2026-10-03.jsonl'), BAD + '\n');
  app = createApp({ adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir });
});

const rowsOf = (html: string) => html.split('<tr').filter((s) => s.includes('<td>'));
const jobOf = (row: string) => /<td>([^<]*)<\/td>/.exec(row)![1];

describe('GET /digest/:night', () => {
  it('renders the good night with warn rows and — for a null owner', async () => {
    const res = await app.request('/digest/2026-10-01');
    expect(res.status).toBe(200);
    const html = await res.text();
    const rows = rowsOf(html);
    expect(rows.map(jobOf)).toEqual(['a/alpha', 'b/flaky', 'c/broken', 'd/fine']);
    expect(rows[0]).not.toContain('warn');
    expect(rows[1]).toContain('class="warn"'); // 3 retries
    expect(rows[2]).toContain('class="warn"'); // fail
    expect(rows[2]).toContain('<td>—</td>'); // null owner
    expect(rows[3]).not.toContain('warn');
  });

  it('404s for a night with no file', async () => {
    const res = await app.request('/digest/2026-09-09');
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('no run log for that night');
  });

  it('says nothing ran for an empty night', async () => {
    const res = await app.request('/digest/2026-10-02');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('nothing ran');
  });

  it('keeps good rows and reports a bad line', async () => {
    const res = await app.request('/digest/2026-10-03');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(rowsOf(html).map(jobOf)).toEqual(['a/alpha', 'd/fine']);
    expect(html).toMatch(/1 line didn(&#39;|')t parse/);
  });
});

describe('GET /api/digest/:night', () => {
  it('returns rows in the same order as the HTML table', async () => {
    const html = await (await app.request('/digest/2026-10-01')).text();
    const res = await app.request('/api/digest/2026-10-01');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Night;
    expect(body.rows.map((r) => r.job)).toEqual(['a/alpha', 'b/flaky', 'c/broken', 'd/fine']);
    expect(body.rows.map((r) => r.job)).toEqual(rowsOf(html).map(jobOf));
    expect(body.rows[1]).toMatchObject({ retries: 3, runs: 4, lastStatus: 'ok' });
    expect(body.rows[2]).toMatchObject({ owner: null, lastStatus: 'fail', lastError: 'boom' });
    expect(body.badLines).toBe(0);
  });

  it('404s for a night with no file', async () => {
    const res = await app.request('/api/digest/2026-09-09');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ night: '2026-09-09' });
  });

  it('has rows [] for an empty night', async () => {
    const res = await app.request('/api/digest/2026-10-02');
    expect(res.status).toBe(200);
    expect(((await res.json()) as Night).rows).toEqual([]);
  });

  it('keeps good rows and counts the bad line', async () => {
    const res = await app.request('/api/digest/2026-10-03');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Night;
    expect(body.badLines).toBe(1);
    expect(body.rows.map((r) => r.job)).toEqual(['a/alpha', 'd/fine']);
  });
});
