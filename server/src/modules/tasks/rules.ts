/**
 * Regras de negócio das tarefas — funções puras, sem acesso ao banco, para facilitar testes.
 * Nunca dependem do NOME do status, apenas das flags is_start_status / is_completion_status.
 */
import { toLocalDate } from '../../lib/time.js';

export interface StatusFlags {
  is_start_status: number | boolean;
  is_completion_status: number | boolean;
}

export interface TaskDates {
  started_at: string | null;
  completed_at: string | null;
}

/**
 * Aplica as datas automáticas ao entrar em um status:
 *  - status de início: preenche started_at se ainda vazio (mantém a PRIMEIRA data de início);
 *  - status de conclusão: preenche completed_at se ainda vazio (nunca sobrescreve);
 *    se a tarefa for concluída sem nunca ter passado por um status de início, started_at
 *    permanece vazio — e a tarefa fica fora do Cycle Time (regra explícita do requisito).
 *  - sair de um status nunca apaga datas.
 */
export function applyStatusEntry(dates: TaskDates, target: StatusFlags, nowIso: string): TaskDates {
  const next = { ...dates };
  if (target.is_start_status && !next.started_at) next.started_at = nowIso;
  if (target.is_completion_status && !next.completed_at) next.completed_at = nowIso;
  return next;
}

export type DeadlineState =
  | 'sem_prazo' // sem data de conclusão prevista
  | 'no_prazo' // aberta, dentro do prazo
  | 'atrasada' // aberta, hoje > prazo
  | 'concluida_no_prazo'
  | 'concluida_com_atraso'
  | 'concluida'; // concluída sem prazo definido

/**
 * Situação de prazo de uma tarefa.
 * "Concluída" = o status ATUAL é um status de conclusão.
 * Comparações por data de calendário no fuso da aplicação.
 */
export function deadlineState(
  task: { planned_end_date: string | null; completed_at: string | null },
  isCompleted: boolean,
  today: string,
): DeadlineState {
  if (isCompleted) {
    if (!task.planned_end_date) return 'concluida';
    const doneDay = task.completed_at ? toLocalDate(task.completed_at) : today;
    return doneDay > task.planned_end_date ? 'concluida_com_atraso' : 'concluida_no_prazo';
  }
  if (!task.planned_end_date) return 'sem_prazo';
  return today > task.planned_end_date ? 'atrasada' : 'no_prazo';
}
