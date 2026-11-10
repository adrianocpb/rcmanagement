/** Administração → Integrações: tokens do conector MCP (Claude). */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, KeyRound, Plus } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDateTime } from '../lib/format';
import { useUserOptions } from '../lib/queries';
import { ErrorText, Field, Modal, Spinner } from './ui';

interface ApiToken {
  id: number;
  name: string;
  token_hint: string;
  user_id: number;
  user_name: string;
  created_by_name: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

function CopyButton({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn-secondary shrink-0 py-1"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      {done ? <Check size={14} /> : <Copy size={14} />} {done ? 'Copiado' : 'Copiar'}
    </button>
  );
}

export function IntegrationsTab() {
  const qc = useQueryClient();
  const { data: tokens, isLoading, error } = useQuery({
    queryKey: ['integrations', 'tokens'],
    queryFn: () => api.get<ApiToken[]>('/integrations/tokens'),
  });
  const [creating, setCreating] = useState(false);
  const revoke = useMutation({
    mutationFn: (id: number) => api.del(`/integrations/tokens/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integrations', 'tokens'] }),
  });
  const mcpUrl = `${window.location.origin}/mcp`;

  return (
    <div className="space-y-4">
      <div className="card space-y-3 p-4 text-sm text-slate-700">
        <div className="flex items-center gap-2 font-semibold text-slate-900">
          <KeyRound size={16} /> Conector do Claude (MCP)
        </div>
        <p>
          Permite que o Claude leia épicos, outcomes e tarefas, procure duplicados e crie ou edite itens — sempre pedindo sua aprovação antes
          de gravar. Não há como excluir nada pelo conector.
        </p>
        <div>
          <div className="mb-1 text-xs text-slate-500">URL do servidor</div>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-[13px]">{mcpUrl}</code>
            <CopyButton value={mcpUrl} />
          </div>
        </div>
        <ol className="list-decimal space-y-0.5 pl-5 text-slate-600">
          <li>Crie um token abaixo e copie-o (ele só aparece uma vez).</li>
          <li>
            No claude.ai: Configurações → Conectores → Adicionar conector personalizado. Informe a URL acima e, em <b>Request headers</b>,
            o cabeçalho <code>Authorization</code> com o valor <code>Bearer &lt;token&gt;</code>.
          </li>
          <li>Tudo o que o Claude criar ou editar fica registrado em nome do usuário escolhido para o token.</li>
        </ol>
      </div>

      <div className="flex justify-end">
        <button className="btn-primary" onClick={() => setCreating(true)}>
          <Plus size={16} /> Novo token
        </button>
      </div>
      <ErrorText error={error ?? revoke.error} />
      {isLoading && <Spinner />}
      {tokens && (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="th">Nome</th>
                <th className="th">Age como</th>
                <th className="th">Token</th>
                <th className="th">Criado</th>
                <th className="th">Último uso</th>
                <th className="th">Situação</th>
                <th className="th" />
              </tr>
            </thead>
            <tbody>
              {tokens.length === 0 && (
                <tr>
                  <td className="td text-slate-500" colSpan={7}>
                    Nenhum token criado.
                  </td>
                </tr>
              )}
              {tokens.map((t) => (
                <tr key={t.id} className={`border-b border-slate-100 last:border-0 ${t.revoked_at ? 'opacity-60' : ''}`}>
                  <td className="td font-medium">{t.name}</td>
                  <td className="td">{t.user_name}</td>
                  <td className="td font-mono text-xs text-slate-500">…{t.token_hint}</td>
                  <td className="td text-slate-500">
                    {fmtDateTime(t.created_at)}
                    {t.created_by_name && <div className="text-xs">por {t.created_by_name}</div>}
                  </td>
                  <td className="td text-slate-500">{t.last_used_at ? fmtDateTime(t.last_used_at) : 'nunca'}</td>
                  <td className="td">
                    {t.revoked_at ? (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">Revogado</span>
                    ) : (
                      <span className="rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700">Ativo</span>
                    )}
                  </td>
                  <td className="td text-right">
                    {!t.revoked_at && (
                      <button
                        className="btn-danger py-1"
                        disabled={revoke.isPending}
                        onClick={() =>
                          confirm(`Revogar o token "${t.name}"? Quem o usa (ex.: o conector do Claude) perde o acesso na hora.`) &&
                          revoke.mutate(t.id)
                        }
                      >
                        Revogar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {creating && <NewTokenModal onClose={() => setCreating(false)} />}
    </div>
  );
}

function NewTokenModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data: users } = useUserOptions();
  const [name, setName] = useState('Claude (conector PM)');
  const [userId, setUserId] = useState(String(user?.id ?? ''));
  const [created, setCreated] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api.post<{ token: string }>('/integrations/tokens', { name, user_id: Number(userId) }),
    onSuccess: async (r) => {
      setCreated(r.token);
      await qc.invalidateQueries({ queryKey: ['integrations', 'tokens'] });
    },
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={created ? 'Token criado' : 'Novo token'}
      footer={
        created ? (
          <button className="btn-primary" onClick={onClose}>
            Já copiei
          </button>
        ) : (
          <>
            <button className="btn-secondary" onClick={onClose}>
              Cancelar
            </button>
            <button className="btn-primary" form="token-form" disabled={save.isPending}>
              Criar token
            </button>
          </>
        )
      }
    >
      {created ? (
        <div className="space-y-3 text-sm">
          <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-900">
            Copie agora: por segurança, o token <b>não será mostrado de novo</b>. Se perder, revogue e crie outro.
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-[13px] break-all">{created}</code>
            <CopyButton value={created} />
          </div>
          <p className="text-slate-600">
            No conector, use o cabeçalho <code>Authorization</code> com o valor <code>Bearer {created.slice(0, 8)}…</code> (a palavra Bearer, um
            espaço e o token).
          </p>
        </div>
      ) : (
        <form
          id="token-form"
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Field label="Nome (para identificar o token)" required>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
          </Field>
          <Field label="Age como (as ações ficam registradas em nome desta pessoa)" required>
            <select className="input" value={userId} onChange={(e) => setUserId(e.target.value)} required>
              <option value="">Selecione…</option>
              {users
                ?.filter((u) => u.active && u.role !== 'requester')
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
            </select>
          </Field>
          <p className="text-xs text-slate-500">
            Dica: para separar o que foi feito pelo Claude, crie antes um usuário "Assistente PM" (perfil Usuário) e escolha-o aqui.
          </p>
          <ErrorText error={save.error} />
        </form>
      )}
    </Modal>
  );
}
