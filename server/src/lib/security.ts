import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';

/** Cabeçalhos de segurança do navegador (equivalente enxuto ao helmet). */
export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (config.cookieSecure) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  next();
}

/**
 * Limite de tentativas de login erradas, por IP e por e-mail, numa janela de tempo.
 * Fica em memória: basta para um servidor único (reinício zera as contagens).
 */
export class LoginThrottle {
  private failures = new Map<string, number[]>();

  constructor(
    private readonly max = 10,
    private readonly windowMs = 15 * 60 * 1000,
  ) {}

  private recent(key: string, now: number) {
    const list = (this.failures.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length) this.failures.set(key, list);
    else this.failures.delete(key);
    return list;
  }

  /** Minutos até liberar, se bloqueado; 0 se pode tentar. */
  blockedFor(keys: string[], now = Date.now()): number {
    let wait = 0;
    for (const key of keys) {
      const list = this.recent(key, now);
      if (list.length >= this.max) wait = Math.max(wait, Math.ceil((list[0] + this.windowMs - now) / 60_000));
    }
    return wait;
  }

  fail(keys: string[], now = Date.now()) {
    for (const key of keys) this.failures.set(key, [...this.recent(key, now), now]);
  }

  succeed(keys: string[]) {
    for (const key of keys) this.failures.delete(key);
  }
}
