import { BarChart3, ClipboardCheck, Flag, Inbox, KanbanSquare, LogOut, Settings, Target, Trash2 } from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { ROLE_LABEL } from '../lib/format';
import { useRequestCounts } from '../pages/RequestsPage';
import { TaskModal } from './TaskModal';
import { Avatar } from './ui';

export function Layout() {
  const { user, logout } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { data: counts } = useRequestCounts(isAdmin);
  const pending = counts?.aguardando ?? 0;
  type NavItem = { to: string; label: string; icon: typeof BarChart3; end?: boolean; badge?: number };
  // Solicitante: apenas as próprias solicitações.
  const links: NavItem[] =
    user?.role === 'requester'
      ? [{ to: '/solicitacoes', label: 'Minhas solicitações', icon: Inbox }]
      : [
          { to: '/', label: 'Dashboard', icon: BarChart3, end: true },
          { to: '/tarefas', label: 'Tarefas', icon: KanbanSquare },
          { to: '/epicos', label: 'Épicos', icon: Flag },
          { to: '/outcomes', label: 'Outcomes', icon: Target },
          { to: '/solicitacoes', label: 'Solicitações', icon: Inbox },
          ...(isAdmin ? [{ to: '/aprovacoes', label: 'Aprovações', icon: ClipboardCheck, badge: pending }] : []),
          { to: '/lixeira', label: 'Lixeira', icon: Trash2 },
          ...(isAdmin ? [{ to: '/admin', label: 'Administração', icon: Settings }] : []),
        ];
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="flex h-14 items-center gap-4 px-4 lg:px-6">
          <div className="flex items-center gap-2">
            <img src="/logo-rc.png" alt="RC+" className="h-7 w-auto" />
            <span className="hidden text-sm font-semibold whitespace-nowrap text-slate-900 sm:inline">Gestão de Melhorias</span>
          </div>
          <nav className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto">
            {links.map(({ to, label, icon: Icon, end, badge }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium whitespace-nowrap ${
                    isActive ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`
                }
              >
                <Icon size={16} />
                <span className="hidden md:inline">{label}</span>
                {!!badge && (
                  <span className="rounded-full bg-amber-500 px-1.5 text-[11px] leading-4 font-semibold text-white" title={`${badge} aguardando aprovação`}>
                    {badge}
                  </span>
                )}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <Avatar name={user?.name ?? ''} id={user?.id} size="md" />
            <div className="hidden text-right leading-tight 2xl:block">
              <div className="text-sm font-medium text-slate-800">{user?.name}</div>
              <div className="text-xs text-slate-500">{user ? ROLE_LABEL[user.role] : ''}</div>
            </div>
            <button className="btn-ghost p-1.5" onClick={logout} title="Sair">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </header>
      <main className="flex-1 px-4 py-5 lg:px-6">
        <Outlet />
      </main>
      <TaskModal />
    </div>
  );
}
