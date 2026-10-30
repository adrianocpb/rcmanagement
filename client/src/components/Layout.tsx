import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Flag,
  Inbox,
  KanbanSquare,
  LogOut,
  Menu,
  Search,
  Settings,
  Target,
  Trash2,
  X,
} from 'lucide-react';
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
  // Menu recolhido (só ícones) a partir de telas médias; a preferência fica salva no navegador.
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const saved = localStorage.getItem('layout.sidebarCollapsed');
      if (saved !== null) return saved === '1';
    } catch {
      /* ignora */
    }
    // Sem preferência salva: em telas médias (notebook com zoom do Windows) começa recolhido.
    return window.innerWidth < 1280;
  });
  const toggleCollapsed = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem('layout.sidebarCollapsed', c ? '0' : '1');
      } catch {
        /* ignora */
      }
      return !c;
    });
  /** Classes aplicadas só em telas grandes com o menu recolhido (no celular o menu é sempre a gaveta completa). */
  const whenCollapsed = (cls: string) => (collapsed ? cls : '');

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
      {menuOpen && <div className="fixed inset-0 z-40 bg-slate-900/50 md:hidden" onClick={() => setMenuOpen(false)} />}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[260px] flex-col bg-white elev-card transition-[transform,width] md:translate-x-0 ${
          menuOpen ? 'translate-x-0' : '-translate-x-full'
        } ${whenCollapsed('md:w-[78px]')}`}
      >
        <div className={`flex h-16 items-center gap-2 pr-4 pl-5 ${whenCollapsed('md:justify-center md:px-2')}`}>
          <img src="/logo-rc.svg" alt="RC+" className={`h-7 w-auto ${whenCollapsed('md:h-5')}`} />
          <span className={`min-w-0 flex-1 truncate text-[15px] font-semibold whitespace-nowrap text-slate-700 ${whenCollapsed('md:hidden')}`}>
            Gestão de Melhorias
          </span>
          <button className="btn-ghost -mr-2 p-1.5 md:hidden" onClick={() => setMenuOpen(false)} aria-label="Fechar menu">
            <X size={18} />
          </button>
        </div>
        {/* Recolher/expandir: botão redondo na borda do menu, visível nos dois estados. */}
        <button
          className="absolute top-5 -right-3 hidden size-6 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 elev-card hover:bg-blue-600 hover:text-[#eff0eb] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 md:inline-flex"
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
          title={collapsed ? 'Expandir menu' : 'Recolher menu'}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
        <nav className={`flex-1 overflow-y-auto px-3.5 pb-6 ${whenCollapsed('md:px-3')}`} aria-label="Menu principal">
          {groups.map((g) => (
            <div key={g.title}>
              <div className={`px-3 pt-4 pb-1 text-[13px] text-slate-400 uppercase ${whenCollapsed('md:hidden')}`}>{g.title}</div>
              {collapsed && <div className="mx-2 my-3 hidden border-t border-slate-200 md:block" aria-hidden="true" />}
              <div className="flex flex-col gap-1">
                {g.items.map(({ to, label, icon: Icon, end, badge }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={end}
                    title={collapsed ? label : undefined}
                    aria-label={collapsed ? label : undefined}
                    className={({ isActive }) =>
                      `relative flex h-[38px] items-center gap-3 rounded-md px-3 text-[15px] ${whenCollapsed('md:justify-center md:px-0')} ${
                        isActive ? 'bg-blue-600 text-[#eff0eb] shadow-[0_2px_6px_0_rgba(14,14,14,0.24)]' : 'text-slate-500 hover:bg-[rgba(14,14,14,0.05)]'
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <Icon size={20} strokeWidth={1.75} />
                        <span className={`flex-1 ${whenCollapsed('md:hidden')}`}>{label}</span>
                        {!!badge && (
                          <span
                            className={`min-w-5 rounded-full px-1.5 text-center text-xs leading-5 font-medium ${
                              isActive ? 'bg-white text-blue-700' : 'bg-red-500 text-white'
                            } ${whenCollapsed('md:absolute md:top-0 md:right-0.5 md:min-w-4 md:px-1 md:text-[10px] md:leading-4')}`}
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

      <div className={`flex min-w-0 flex-1 flex-col transition-[padding] ${collapsed ? 'md:pl-[78px]' : 'md:pl-[260px]'}`}>
        <div className="sticky top-0 z-30 bg-slate-50/90 px-4 pt-3 backdrop-blur md:px-6">
          <header className="flex h-14 items-center gap-3 rounded-md bg-white px-4 elev-card md:px-6">
            <button className="btn-ghost -ml-2 p-1.5 md:hidden" onClick={() => setMenuOpen(true)} aria-label="Abrir menu">
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
        <main className="flex-1 px-4 py-6 md:px-6">
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
