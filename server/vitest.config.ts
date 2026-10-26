import os from 'node:os';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    env: {
      APP_TIMEZONE: 'America/Sao_Paulo',
      // Anexos de solicitações gravados em uma pasta temporária durante os testes
      UPLOADS_DIR: path.join(os.tmpdir(), `rcm-test-uploads-${process.pid}`),
    },
  },
});
