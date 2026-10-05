import { describe, expect, it } from 'vitest';
import { setup } from './helpers.js';
import { todayLocal, toLocalDate, addDays } from '../src/lib/time.js';

// Auditoria: cada filtro/indicador da API comparado com um cálculo independente feito direto no banco.
describe('auditoria de filtros e indicadores', async () => {
  const ctx = await setup();
  const raw = ctx.db
    .prepare(
      `SELECT t.*, s.is_completion_status AS done FROM tasks t JOIN statuses s ON s.id = t.status_id WHERE t.deleted_at IS NULL`,
    )
    .all() as Record<string, any>[];
  const today = todayLocal();
  const ids = (rows: { id: number }[]) => rows.map((r) => r.id).sort((a, b) => a - b);
  const get = async (q: string) => (await ctx.agent.get(`/api/tasks${q}`).expect(200)).body;

  const cases: [string, string, (t: Record<string, any>) => boolean][] = [
    ['status', '?status_id=3', (t) => t.status_id === 3],
    ['responsável', '?assignee_id=3', (t) => t.assignee_id === 3],
    ['solicitante', '?requester_id=2', (t) => t.requester_id === 2],
    ['setor', '?sector_id=2', (t) => t.sector_id === 2],
    ['prioridade', '?priority=alta', (t) => t.priority === 'alta'],
    ['épico', '?epic_id=1', (t) => t.epic_id === 1],
    ['outcome', '?outcome_id=3', (t) => t.outcome_id === 3],
    ['somente atrasadas', '?overdue=true', (t) => !t.done && t.planned_end_date && today > t.planned_end_date],
    ['busca por texto', '?q=concilia', (t) => /concilia/i.test(t.title + (t.description ?? ''))],
    ['período (prazo)', `?from=${addDays(today, -15)}&to=${today}&period_field=planned_end`,
      (t) => t.planned_end_date >= addDays(today, -15) && t.planned_end_date <= today],
    ['período (criação)', `?from=${addDays(today, -20)}&to=${today}&period_field=created`,
      (t) => toLocalDate(t.created_at) >= addDays(today, -20) && toLocalDate(t.created_at) <= today],
    ['período (conclusão)', `?from=${addDays(today, -40)}&to=${today}&period_field=completed`,
      (t) => t.completed_at && toLocalDate(t.completed_at) >= addDays(today, -40) && toLocalDate(t.completed_at) <= today],
    ['combinado setor+prioridade+responsável', '?sector_id=2&priority=alta&assignee_id=3',
      (t) => t.sector_id === 2 && t.priority === 'alta' && t.assignee_id === 3],
  ];
  for (const [name, q, pred] of cases) {
    it(`filtro: ${name}`, async () => {
      const expected = raw.filter(pred);
      expect(ids(await get(q))).toEqual(ids(expected as { id: number }[]));
    });
  }

  it('indicadores do dashboard batem com o cálculo direto (com e sem filtros)', async () => {
    const from = addDays(today, -89);
    for (const [q, pred] of [
      ['', () => true],
      ['&sector_id=2', (t: any) => t.sector_id === 2],
      ['&assignee_id=3', (t: any) => t.assignee_id === 3],
      ['&epic_id=1', (t: any) => t.epic_id === 1],
      ['&outcome_id=3', (t: any) => t.outcome_id === 3],
    ] as const) {
      const d = (await ctx.agent.get(`/api/dashboard?from=${from}&to=${today}${q}`).expect(200)).body;
      const ts = raw.filter(pred as (t: any) => boolean);
      const inP = (iso: string) => toLocalDate(iso) >= from && toLocalDate(iso) <= today;
      const done = ts.filter((t) => t.done && t.completed_at && inP(t.completed_at));
      const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86400000;
      const avg = (v: number[]) => (v.length ? Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 10) / 10 : null);
      expect(d.throughput.count).toBe(done.length);
      expect(d.created.count).toBe(ts.filter((t) => inP(t.created_at)).length);
      expect(d.wip.count).toBe(ts.filter((t) => !t.done).length);
      expect(d.overdue.count).toBe(ts.filter((t) => !t.done && t.planned_end_date && today > t.planned_end_date).length);
      expect(d.cycle_time.avg).toBe(avg(done.filter((t) => t.started_at).map((t) => days(t.started_at, t.completed_at))));
      expect(d.lead_time.avg).toBe(avg(done.map((t) => days(t.created_at, t.completed_at))));
      expect(d.aging.reduce((s: number, a: any) => s + a.count, 0)).toBe(ts.filter((t) => !t.done).length);
      expect(d.status_distribution.reduce((s: number, a: any) => s + a.count, 0)).toBe(ts.length);
    }
  });
});
