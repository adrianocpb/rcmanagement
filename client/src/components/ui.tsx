import { X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import type { DeadlineState, Priority } from '../lib/api';
import { DEADLINE, PRIORITY, initials } from '../lib/format';

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  const width = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' }[size];
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-8">
      <div className="fixed inset-0" onClick={onClose} />
      <div className={`relative w-full ${width} rounded-xl bg-white shadow-2xl`} role="dialog" aria-modal="true">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-3.5">
          <div className="min-w-0 text-base font-semibold text-slate-900">{title}</div>
          <button className="btn-ghost -mr-2 p-1" onClick={onClose} aria-label="Fechar">
            <X size={18} />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, required, children, className = '' }: { label: string; required?: boolean; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="label">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>
      {children}
    </label>
  );
}

export function PriorityBadge({ priority, compact }: { priority: Priority; compact?: boolean }) {
  const p = PRIORITY[priority];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${p.cls}`}>
      <span className={`size-1.5 rounded-full ${p.dot}`} />
      {!compact && p.label}
      {compact && p.label}
    </span>
  );
}

export function DeadlineBadge({ state }: { state: DeadlineState }) {
  const d = DEADLINE[state];
  if (!d) return null;
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${d.cls}`}>{d.label}</span>;
}

export function StatusPill({ name, color }: { name: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-slate-700">
      <span className="size-2 rounded-full" style={{ background: color }} />
      {name}
    </span>
  );
}

const AVATAR_COLORS = ['bg-blue-600', 'bg-violet-600', 'bg-emerald-600', 'bg-amber-600', 'bg-rose-600', 'bg-cyan-700', 'bg-fuchsia-600'];
export function Avatar({ name, id, size = 'sm' }: { name: string | null; id?: number | null; size?: 'sm' | 'md' }) {
  const color = AVATAR_COLORS[(id ?? 0) % AVATAR_COLORS.length];
  const s = size === 'sm' ? 'size-6 text-[10px]' : 'size-8 text-xs';
  return (
    <span title={name ?? ''} className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${color} ${s}`}>
      {initials(name)}
    </span>
  );
}

export function ProgressBar({ value, className = '' }: { value: number; className?: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-slate-200 ${className}`}>
      <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${v}%` }} />
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">{children}</div>;
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
      {error instanceof Error ? error.message : String(error)}
    </div>
  );
}

export function Spinner() {
  return <div className="p-8 text-center text-sm text-slate-500">Carregando…</div>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
