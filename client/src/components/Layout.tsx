import { BarChart3, Flag, KanbanSquare, LogOut, Settings, Target } from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { TaskModal } from './TaskModal';
import { Avatar } from './ui';

export function Layout() {
  const { user, logout } = useAuth();
  const links = [
    { to: '/', label: 'Tarefas', icon: KanbanSquare, end: true },
    { to: '/dashboard', label: 'Dashboard', icon: BarChart3 },
    { to: '/epicos', label: 'Épicos', icon: Flag },
    { to: '/outcomes', label: 'Outcomes', icon: Target },
    ...(user?.role === 'admin' ? [{ to: '/admin', label: 'Administração', icon: Settings }] : []),
  ];
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="flex h-14 items-center gap-4 px-4 lg:px-6">
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-md bg-blue-600 text-white">
              <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 13l4 4 10-11" />
              </svg>
            </div>
            <span className="hidden text-sm font-semibold text-slate-900 sm:inline">Entregas · Dev</span>
          </div>
          <nav className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto">
            {links.map(({ to, label, icon: Icon, end }) => (
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
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <Avatar name={user?.name ?? ''} id={user?.id} size="md" />
            <div className="hidden text-right leading-tight lg:block">
              <div className="text-sm font-medium text-slate-800">{user?.name}</div>
              <div className="text-xs text-slate-500">{user?.role === 'admin' ? 'Administrador' : 'Usuário'}</div>
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
