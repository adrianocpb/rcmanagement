import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-slate-100 to-blue-50 p-4">
      <form
        className="card w-full max-w-sm space-y-4 p-6 shadow-lg"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await login(email, password);
            navigate('/', { replace: true }); // primeira tela após o login: Dashboard
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="flex flex-col items-center gap-3 pb-1 text-center">
          <img src="/logo-rc.png" alt="RC+" className="h-14 w-auto" />
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Gestão de Melhorias</h1>
            <p className="text-sm text-slate-500">Solução RC+</p>
          </div>
        </div>
        <label className="block">
          <span className="label">E-mail</span>
          <input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </label>
        <label className="block">
          <span className="label">Senha</span>
          <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <button className="btn-primary w-full py-2" disabled={busy}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
