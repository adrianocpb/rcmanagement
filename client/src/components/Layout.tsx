import { BarChart3, ClipboardCheck, Flag, Inbox, KanbanSquare, LogOut, Menu, Search, Settings, Target, Trash2, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { ROLE_LABEL } from '../lib/format';
import { useRequestCounts } from '../pages/RequestsPage';
import { TaskModal } from './TaskModal';
import { Avatar } from './ui';

type NavItem = { to: string; label: string; icon: typeof BarChart3; end?: boolean; badge?: number };
type NavGroup = { title: string; items: NavItem[] };

/** Menu lateral fixo + barra superior flutuante (design system RC+ apps). */
export function Layout() {
  const { user, logout } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isRequester = user?.role === 'requester';
  const { data: counts } = useRequestCounts(isAdmin);
  const pending = counts?.aguardando ?? 0;
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setMenuOpen(false), [location.pathname]);

  // Solicitante: apenas as próprias solicitações.
  const groups: NavGroup[] = isRequester
    ? [{ title: 'Solicitações', items: [{ to: '/solicitacoes', label: 'Minhas solicitações', icon: Inbox }] }]
    : [
        {
          title: 'Acompanhamento',
          items: [
            { to: '/', label: 'Dashboard', icon: BarChart3, end: true },
            { to: '/tarefas', label: 'Tarefas', icon: KanbanSquare },
            { to: '/epicos', label: 'Épicos', icon: Flag },
            { to: '/outcomes', label: 'Outcomes', icon: Target },
          ],
        },
        {
          title: 'Solicitações',
          items: [
            { to: '/solicitacoes', label: 'Minhas solicitações', icon: Inbox },
            ...(isAdmin ? [{ to: '/aprovacoes', label: 'Aprovações', icon: ClipboardCheck, badge: pending }] : []),
          ],
        },
        {
          title: 'Administração',
          items: [
            { to: '/lixeira', label: 'Lixeira', icon: Trash2 },
            ...(isAdmin ? [{ to: '/admin', label: 'Administração', icon: Settings }] : []),
          ],
        },
      ];

  return (
    <div className="flex min-h-full">
      {menuOpen && <div className="fixed inset-0 z-40 bg-slate-900/50 lg:hidden" onClick={() => setMenuOpen(false)} />}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[260px] flex-col bg-white elev-card transition-transform lg:translate-x-0 ${
          menuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-16 items-center gap-2.5 px-6">
          <img src="/logo-rc.png" alt="RC+" className="h-7 w-auto" />
          <span className="min-w-0 flex-1 truncate text-base font-semibold whitespace-nowrap text-slate-700">Gestão de Melhorias</span>
          <button className="btn-ghost -mr-2 p-1.5 lg:hidden" onClick={() => setMenuOpen(false)} aria-label="Fechar menu">
            <X size={18} />
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto px-3.5 pb-6" aria-label="Menu principal">
          {groups.map((g) => (
            <div key={g.title}>
              <div className="px-3 pt-4 pb-1 text-[13px] text-slate-400 uppercase">{g.title}</div>
              <div className="flex flex-col gap-1">
                {g.items.map(({ to, label, icon: Icon, end, badge }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={end}
                    className={({ isActive }) =>
                      `flex h-[38px] items-center gap-3 rounded-md px-3 text-[15px] ${
                        isActive ? 'bg-blue-600 text-white shadow-[0_2px_6px_0_rgba(115,103,240,0.3)]' : 'text-slate-500 hover:bg-[rgba(47,43,61,0.06)]'
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <Icon size={20} strokeWidth={1.75} />
                        <span className="flex-1">{label}</span>
                        {!!badge && (
                          <span
                            className={`min-w-5 rounded-full px-1.5 text-center text-xs leading-5 font-medium ${
                              isActive ? 'bg-white text-blue-700' : 'bg-red-500 text-white'
                            }`}
                            title={`${badge} aguardando aprovação`}
                          >
                            {badge}
                          </span>
                        )}
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col lg:pl-[260px]">
        <div className="sticky top-0 z-30 bg-slate-50/90 px-4 pt-3 backdrop-blur lg:px-6">
          <header className="flex h-14 items-center gap-3 rounded-md bg-white px-4 elev-card lg:px-6">
            <button className="btn-ghost -ml-2 p-1.5 lg:hidden" onClick={() => setMenuOpen(true)} aria-label="Abrir menu">
              <Menu size={20} />
            </button>
            {isRequester ? (
              <span className="hidden truncate text-[15px] text-slate-500 sm:block">Envie ideias de melhoria e acompanhe cada uma.</span>
            ) : (
              <TaskSearch />
            )}
            <div className="ml-auto flex items-center gap-3">
              <div className="hidden text-right leading-tight sm:block">
                <div className="text-[15px] font-medium text-slate-700">{user?.name}</div>
                <div className="text-[13px] text-slate-400">{user ? ROLE_LABEL[user.role] : ''}</div>
              </div>
              <Avatar name={user?.name ?? ''} id={user?.id} size="md" />
              <button className="btn-ghost p-2" onClick={logout} title="Sair" aria-label="Sair">
                <LogOut size={18} />
              </button>
            </div>
          </header>
        </div>
        <main className="flex-1 px-4 py-6 lg:px-6">
          <Outlet />
        </main>
      </div>
      <TaskModal />
    </div>
  );
}

/** Busca global de tarefas por título: abre a tela de Tarefas já filtrada. */
function TaskSearch() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    navigate(`/tarefas?q=${encodeURIComponent(q.trim())}`);
    setQ('');
  };
  return (
    <form onSubmit={submit} className="flex max-w-md min-w-0 flex-1 items-center gap-3 text-slate-500" role="search">
      <Search size={18} className="shrink-0" />
      <input
        className="min-w-0 flex-1 border-0 bg-transparent text-[15px] text-slate-700 outline-none placeholder:text-slate-400"
        placeholder="Buscar tarefas pelo título"
        aria-label="Buscar tarefas"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
    </form>
  );
}
