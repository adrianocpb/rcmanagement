import { describe, expect, it } from 'vitest';
import { computeMetrics, computeTimeInStatus, stats, type MetricTask } from '../src/modules/dashboard/metrics.js';
import { applyStatusEntry, deadlineState } from '../src/modules/tasks/rules.js';
import { startOfLocalDayUtc, toLocalDate, zonedWallTimeToUtc } from '../src/lib/time.js';

const START = { is_start_status: 1, is_completion_status: 0 };
const DONE = { is_start_status: 0, is_completion_status: 1 };
const OTHER = { is_start_status: 0, is_completion_status: 0 };

describe('applyStatusEntry', () => {
  it('preenche início real ao entrar em status de início', () => {
    expect(applyStatusEntry({ started_at: null, completed_at: null }, START, 'T1')).toEqual({
      started_at: 'T1',
      completed_at: null,
    });
  });
  it('mantém a primeira data de início ao voltar e reentrar', () => {
    let d = applyStatusEntry({ started_at: null, completed_at: null }, START, 'T1');
    d = applyStatusEntry(d, OTHER, 'T2');
    d = applyStatusEntry(d, START, 'T3');
    expect(d.started_at).toBe('T1');
  });
  it('não sobrescreve a data de conclusão existente', () => {
    expect(applyStatusEntry({ started_at: 'T1', completed_at: 'T2' }, DONE, 'T3').completed_at).toBe('T2');
  });
  it('sair de um status não apaga datas', () => {
    expect(applyStatusEntry({ started_at: 'T1', completed_at: 'T2' }, OTHER, 'T3')).toEqual({
      started_at: 'T1',
      completed_at: 'T2',
    });
  });
});

describe('deadlineState', () => {
  it('atrasada quando aberta e hoje > prazo', () => {
    expect(deadlineState({ planned_end_date: '2026-10-01', completed_at: null }, false, '2026-10-02')).toBe('atrasada');
  });
  it('no prazo no próprio dia do prazo', () => {
    expect(deadlineState({ planned_end_date: '2026-10-02', completed_at: null }, false, '2026-10-02')).toBe('no_prazo');
  });
  it('concluída com atraso usa a data local (São Paulo) da conclusão', () => {
    // 02:00Z do dia 03 = 23:00 do dia 02 em São Paulo → no prazo
    expect(
      deadlineState({ planned_end_date: '2026-10-02', completed_at: '2026-10-03T02:00:00.000Z' }, true, '2026-10-05'),
    ).toBe('concluida_no_prazo');
    expect(
      deadlineState({ planned_end_date: '2026-10-02', completed_at: '2026-10-03T04:00:00.000Z' }, true, '2026-10-05'),
    ).toBe('concluida_com_atraso');
  });
  it('sem prazo', () => {
    expect(deadlineState({ planned_end_date: null, completed_at: null }, false, '2026-10-02')).toBe('sem_prazo');
  });
});

describe('fuso horário', () => {
  it('converte datas locais para UTC corretamente', () => {
    expect(startOfLocalDayUtc('2026-10-02')).toBe('2026-10-02T03:00:00.000Z');
    expect(zonedWallTimeToUtc('2026-10-02', '21:30:00').toISOString()).toBe('2026-10-03T00:30:00.000Z');
    expect(toLocalDate('2026-10-03T02:59:00.000Z')).toBe('2026-10-02');
  });
});

describe('métricas', () => {
  it('média e mediana', () => {
    expect(stats([1, 3, 10])).toEqual({ count: 3, avg: 4.7, median: 3 });
    expect(stats([1, 2, 3, 4])).toEqual({ count: 4, avg: 2.5, median: 2.5 });
    expect(stats([])).toEqual({ count: 0, avg: null, median: null });
  });

  const base = { status_id: 1, status_name: 'X', status_color: '#000', status_position: 1, planned_end_date: null, counts_in_wip: true };
  const tasks: MetricTask[] = [
    // concluída no período: lead 10d, cycle 4d
    { ...base, id: 1, is_completed: true, created_at: '2026-09-01T12:00:00Z', started_at: '2026-09-07T12:00:00Z', completed_at: '2026-09-11T12:00:00Z' },
    // concluída no período sem início real: entra no lead time, fora do cycle time
    { ...base, id: 2, is_completed: true, created_at: '2026-09-05T12:00:00Z', started_at: null, completed_at: '2026-09-07T12:00:00Z' },
    // concluída fora do período
    { ...base, id: 3, is_completed: true, created_at: '2026-06-01T12:00:00Z', started_at: '2026-06-02T12:00:00Z', completed_at: '2026-06-10T12:00:00Z' },
    // aberta, iniciada há 20 dias, atrasada
    { ...base, id: 4, is_completed: false, created_at: '2026-09-01T12:00:00Z', started_at: '2026-09-12T12:00:00Z', completed_at: null, planned_end_date: '2026-09-30' },
    // aberta, não iniciada, criada há 1 dia
    { ...base, id: 5, is_completed: false, created_at: '2026-10-01T12:00:00Z', started_at: null, completed_at: null, planned_end_date: '2026-10-10' },
  ];
  const m = computeMetrics({
    tasks,
    from: '2026-09-01',
    to: '2026-10-02',
    granularity: 'month',
    today: '2026-10-02',
    now: new Date('2026-10-02T12:00:00Z'),
  });

  it('cycle time ignora tarefas sem início real', () => {
    expect(m.cycle_time).toEqual({ count: 1, avg: 4, median: 4 });
  });
  it('lead time considera todas as concluídas no período', () => {
    expect(m.lead_time).toEqual({ count: 2, avg: 6, median: 6 });
  });
  it('throughput, criadas, wip e atrasadas', () => {
    expect(m.throughput.count).toBe(2);
    expect(m.created.count).toBe(4);
    expect(m.wip.count).toBe(2);
    expect(m.wip.started).toBe(1);
    expect(m.overdue.count).toBe(1);
  });
  it('aging usa início real ou criação', () => {
    expect(m.aging.map((a) => a.count)).toEqual([1, 0, 1, 0]);
  });
  it('séries por mês', () => {
    expect(m.series.map((s) => [s.bucket, s.created, s.completed])).toEqual([
      ['2026-09-01', 3, 2],
      ['2026-10-01', 1, 0],
    ]);
  });
});

describe('WIP por status', () => {
  it('não conta tarefas abertas em status fora do WIP (ex.: Backlog)', () => {
    const base = { status_name: 'X', status_color: '#000', status_position: 1, planned_end_date: null, created_at: '2026-09-01T12:00:00Z', started_at: null, completed_at: null, is_completed: false };
    const m = computeMetrics({
      tasks: [
        { ...base, id: 1, status_id: 1, counts_in_wip: false },
        { ...base, id: 2, status_id: 2, counts_in_wip: true },
        { ...base, id: 3, status_id: 2, counts_in_wip: true },
      ],
      from: '2026-09-01', to: '2026-10-02', granularity: 'week', today: '2026-10-02', now: new Date('2026-10-02T12:00:00Z'),
    });
    expect(m.wip.count).toBe(2);
  });
});

describe('tempo em cada coluna', () => {
  const statuses = [
    { id: 1, name: 'Backlog', color: '#000', position: 1, is_completion_status: false },
    { id: 2, name: 'Dev', color: '#000', position: 2, is_completion_status: false },
    { id: 3, name: 'Concluído', color: '#000', position: 3, is_completion_status: true },
  ];
  const ev = (task_id: number, to_status_id: number, changed_at: string) => ({ task_id, to_status_id, changed_at });

  it('soma passagens repetidas por tarefa, ignora passagem em andamento e status de conclusão', () => {
    const r = computeTimeInStatus(
      [
        // tarefa 1: Backlog 2d → Dev 3d → Backlog 1d → Dev 1d → Concluído
        ev(1, 1, '2026-09-01T12:00:00Z'),
        ev(1, 2, '2026-09-03T12:00:00Z'),
        ev(1, 1, '2026-09-06T12:00:00Z'),
        ev(1, 2, '2026-09-07T12:00:00Z'),
        ev(1, 3, '2026-09-08T12:00:00Z'),
        // tarefa 2: Backlog 4d → Dev (ainda em andamento: não entra em Dev)
        ev(2, 1, '2026-09-01T12:00:00Z'),
        ev(2, 2, '2026-09-05T12:00:00Z'),
      ],
      statuses,
      '2026-09-01',
      '2026-09-30',
    );
    expect(r).toEqual([
      { status_id: 1, name: 'Backlog', color: '#000', tasks: 2, avg_days: 3.5, median_days: 3.5 },
      { status_id: 2, name: 'Dev', color: '#000', tasks: 1, avg_days: 4, median_days: 4 },
    ]);
  });

  it('considera apenas saídas dentro do período', () => {
    const r = computeTimeInStatus(
      [ev(1, 1, '2026-08-01T12:00:00Z'), ev(1, 2, '2026-08-05T12:00:00Z'), ev(1, 3, '2026-09-10T12:00:00Z')],
      statuses,
      '2026-09-01',
      '2026-09-30',
    );
    expect(r.map((x) => x.name)).toEqual(['Dev']);
  });
});
