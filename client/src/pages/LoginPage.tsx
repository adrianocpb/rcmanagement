import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';

/** Login no padrão dos assets ilustrados RC+: fundo "Ciclo de melhoria" com o cartão centralizado. */
export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex min-h-full items-center justify-center bg-slate-50 bg-[url('/login-melhorias.svg')] bg-cover bg-center p-4">
      <form
        className="flex w-full max-w-[504px] flex-col gap-[22px] rounded-xl bg-white px-[30px] py-8 elev-float"
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
        <div className="flex items-center gap-2.5">
          <img src="/logo-rc.svg" alt="RC+" className="h-[30px] w-auto" />
          <span className="text-lg font-medium text-slate-900">Gestão de Melhorias</span>
        </div>
        <h1 className="text-[26px] leading-[34px] font-medium text-slate-900">Entrar</h1>
        <label className="flex flex-col gap-1.5">
          <span className="text-[15px] font-medium text-slate-900">E-mail</span>
          <input
            className="input h-11 text-[15px]"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[15px] font-medium text-slate-900">Senha</span>
          <input
            className="input h-11 text-[15px]"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <button className="btn-primary h-[46px] w-full text-base" disabled={busy}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
        <p className="text-sm leading-[22px] text-slate-500">Não tem acesso ou esqueceu a senha? Fale com o administrador do sistema.</p>
      </form>
    </div>
  );
}
