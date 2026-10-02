import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { ErrorText, Field, Modal, PageHeader, Spinner } from '../components/ui';
import { api, type Role, type Sector, type Status, type User } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDateTime } from '../lib/format';
import { useSectors, useStatuses } from '../lib/queries';

type Tab = 'users' | 'sectors' | 'statuses';

export function AdminPage() {
  const [tab, setTab] = useState<Tab>('statuses');
  const tabs: [Tab, string][] = [
    ['statuses', 'Status'],
    ['users', 'Usuários'],
    ['sectors', 'Setores'],
  ];
  return (
    <div className="max-w-4xl">
      <PageHeader title="Administração" subtitle="Configurações de usuários, setores e status do fluxo." />
      <div className="mb-4 flex gap-1 border-b border-slate-200">
        {tabs.map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              tab === k ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'users' && <UsersTab />}
      {tab === 'sectors' && <SectorsTab />}
      {tab === 'statuses' && <StatusesTab />}
    </div>
  );
}

function ActiveBadge({ active }: { active: number | boolean | undefined }) {
  return active ? (
    <span className="rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700">Ativo</span>
  ) : (
    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">Inativo</span>
  );
}

// ---------------- Usuários ----------------

function UsersTab() {
  const { data: users, isLoading } = useQuery({ queryKey: ['users', 'admin'], queryFn: () => api.get<User[]>('/users') });
  const [editing, setEditing] = useState<User | 'new' | null>(null);
  return (
    <div>
      <div className="mb-3 flex justify-end">
        <button className="btn-primary" onClick={() => setEditing('new')}>
          <Plus size={16} /> Novo usuário
        </button>
      </div>
      {isLoading && <Spinner />}
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Nome</th>
              <th className="th">E-mail</th>
              <th className="th">Perfil</th>
              <th className="th">Situação</th>
              <th className="th">Criado em</th>
              <th className="th" />
            </tr>
          </thead>
          <tbody>
            {users?.map((u) => (
              <tr key={u.id} className="border-b border-slate-100 last:border-0">
                <td className="td font-medium">{u.name}</td>
                <td className="td text-slate-600">{u.email}</td>
                <td className="td">{u.role === 'admin' ? 'Administrador' : 'Usuário'}</td>
                <td className="td">
                  <ActiveBadge active={u.active} />
                </td>
                <td className="td text-slate-500">{fmtDateTime(u.created_at)}</td>
                <td className="td text-right">
                  <button className="btn-ghost p-1" onClick={() => setEditing(u)} title="Editar">
                    <Pencil size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <UserModal user={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function UserModal({ user, onClose }: { user?: User; onClose: () => void }) {
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const [f, setF] = useState({
    name: user?.name ?? '',
    email: user?.email ?? '',
    role: (user?.role ?? 'user') as Role,
    active: user ? !!user.active : true,
    password: '',
  });
  const save = useMutation({
    mutationFn: () => (user ? api.put(`/users/${user.id}`, f) : api.post('/users', f)),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
  });
  const isMe = user?.id === me?.id;
  return (
    <Modal
      open
      onClose={onClose}
      title={user ? 'Editar usuário' : 'Novo usuário'}
      size="sm"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn-primary" form="user-form" disabled={save.isPending}>
            Salvar
          </button>
        </>
      }
    >
      <form
        id="user-form"
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Nome" required>
          <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required autoFocus />
        </Field>
        <Field label="E-mail" required>
          <input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required />
        </Field>
        <Field label="Perfil">
          <select className="input" value={f.role} disabled={isMe} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>
            <option value="user">Usuário</option>
            <option value="admin">Administrador</option>
          </select>
        </Field>
        <Field label={user ? 'Nova senha (deixe em branco para manter)' : 'Senha'} required={!user}>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            minLength={6}
            value={f.password}
            onChange={(e) => setF({ ...f, password: e.target.value })}
            required={!user}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.active} disabled={isMe} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Ativo
        </label>
        <ErrorText error={save.error} />
      </form>
    </Modal>
  );
}

// ---------------- Setores ----------------

function SectorsTab() {
  const { data: sectors, isLoading } = useSectors();
  const [editing, setEditing] = useState<Sector | 'new' | null>(null);
  return (
    <div>
      <div className="mb-3 flex justify-end">
        <button className="btn-primary" onClick={() => setEditing('new')}>
          <Plus size={16} /> Novo setor
        </button>
      </div>
      {isLoading && <Spinner />}
      <div className="card divide-y divide-slate-100">
        {sectors?.map((s) => (
          <div key={s.id} className="flex items-center gap-3 px-4 py-2.5">
            <span className={`flex-1 text-sm font-medium ${s.active ? '' : 'text-slate-400'}`}>{s.name}</span>
            <ActiveBadge active={s.active} />
            <button className="btn-ghost p-1" onClick={() => setEditing(s)} title="Editar">
              <Pencil size={14} />
            </button>
          </div>
        ))}
      </div>
      {editing && <SectorModal sector={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function SectorModal({ sector, onClose }: { sector?: Sector; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: sector?.name ?? '', active: sector ? !!sector.active : true });
  const save = useMutation({
    mutationFn: () => (sector ? api.put(`/sectors/${sector.id}`, f) : api.post('/sectors', f)),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['sectors'] });
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={sector ? 'Editar setor' : 'Novo setor'}
      size="sm"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn-primary" form="sector-form" disabled={save.isPending}>
            Salvar
          </button>
        </>
      }
    >
      <form
        id="sector-form"
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Nome" required>
          <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required autoFocus />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Ativo
        </label>
        <ErrorText error={save.error} />
      </form>
    </Modal>
  );
}

// ---------------- Status ----------------

function StatusesTab() {
  const qc = useQueryClient();
  const { data: statuses, isLoading } = useStatuses();
  const [editing, setEditing] = useState<Status | 'new' | null>(null);
  const reorder = useMutation({
    mutationFn: (ids: number[]) => api.put<Status[]>('/statuses/reorder', { ids }),
    onSuccess: (data) => {
      qc.setQueryData(['statuses'], data);
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
  const move = (index: number, dir: -1 | 1) => {
    if (!statuses) return;
    const ids = statuses.map((s) => s.id);
    [ids[index], ids[index + dir]] = [ids[index + dir], ids[index]];
    reorder.mutate(ids);
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          A ordem define as colunas do Kanban. As datas reais dependem das marcações <b>Início</b> e <b>Conclusão</b>, não do nome.
        </p>
        <button className="btn-primary shrink-0" onClick={() => setEditing('new')}>
          <Plus size={16} /> Novo status
        </button>
      </div>
      {isLoading && <Spinner />}
      <ErrorText error={reorder.error} />
      <div className="card divide-y divide-slate-100">
        {statuses?.map((s, i) => (
          <div key={s.id} className={`flex flex-wrap items-center gap-3 px-4 py-2.5 ${s.active ? '' : 'opacity-50'}`}>
            <div className="flex flex-col">
              <button className="text-slate-400 hover:text-slate-800 disabled:opacity-20" disabled={i === 0 || reorder.isPending} onClick={() => move(i, -1)} title="Subir">
                <ArrowUp size={14} />
              </button>
              <button
                className="text-slate-400 hover:text-slate-800 disabled:opacity-20"
                disabled={i === statuses.length - 1 || reorder.isPending}
                onClick={() => move(i, 1)}
                title="Descer"
              >
                <ArrowDown size={14} />
              </button>
            </div>
            <span className="size-3 rounded-full" style={{ background: s.color }} />
            <span className="min-w-40 flex-1 text-sm font-medium">{s.name}</span>
            <div className="flex flex-wrap gap-1.5">
              {!!s.is_default && <Flag cls="bg-slate-100 text-slate-700">Padrão p/ novas</Flag>}
              {!!s.is_start_status && <Flag cls="bg-blue-50 text-blue-700">Início</Flag>}
              {!!s.is_completion_status && <Flag cls="bg-green-50 text-green-700">Conclusão</Flag>}
            </div>
            <ActiveBadge active={s.active} />
            <button className="btn-ghost p-1" onClick={() => setEditing(s)} title="Editar">
              <Pencil size={14} />
            </button>
          </div>
        ))}
      </div>
      {editing && <StatusModal status={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function Flag({ cls, children }: { cls: string; children: React.ReactNode }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{children}</span>;
}

function StatusModal({ status, onClose }: { status?: Status; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    name: status?.name ?? '',
    color: status?.color ?? '#64748b',
    is_default: !!status?.is_default,
    is_start_status: !!status?.is_start_status,
    is_completion_status: !!status?.is_completion_status,
    active: status ? !!status.active : true,
  });
  const save = useMutation({
    mutationFn: () => (status ? api.put(`/statuses/${status.id}`, f) : api.post('/statuses', f)),
    onSuccess: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: ['statuses'] }), qc.invalidateQueries({ queryKey: ['tasks'] })]);
      onClose();
    },
  });
  const check = (k: 'is_default' | 'is_start_status' | 'is_completion_status' | 'active', label: string, hint: string) => (
    <label className="flex items-start gap-2 rounded-md p-1.5 text-sm hover:bg-slate-50">
      <input type="checkbox" className="mt-0.5" checked={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} />
      <span>
        <span className="font-medium">{label}</span>
        <span className="block text-xs text-slate-500">{hint}</span>
      </span>
    </label>
  );
  return (
    <Modal
      open
      onClose={onClose}
      title={status ? 'Editar status' : 'Novo status'}
      size="sm"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn-primary" form="status-form" disabled={save.isPending}>
            Salvar
          </button>
        </>
      }
    >
      <form
        id="status-form"
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="flex gap-3">
          <Field label="Nome" required className="flex-1">
            <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required autoFocus />
          </Field>
          <Field label="Cor">
            <input type="color" className="h-[34px] w-14 cursor-pointer rounded-md border border-slate-300" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} />
          </Field>
        </div>
        <div className="space-y-0.5">
          {check('is_default', 'Status inicial (padrão para novas tarefas)', 'Apenas um status pode ser o padrão.')}
          {check('is_start_status', 'Marca início do trabalho', 'Ao entrar neste status, a data de início real é preenchida (se vazia).')}
          {check('is_completion_status', 'Marca conclusão', 'Ao entrar neste status, a data de conclusão real é preenchida (se vazia).')}
          {check('active', 'Ativo', 'Status inativos não aparecem no Kanban.')}
        </div>
        <ErrorText error={save.error} />
      </form>
    </Modal>
  );
}
