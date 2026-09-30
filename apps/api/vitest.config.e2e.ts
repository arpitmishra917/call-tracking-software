import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import { loadEnv } from 'vite';

const env = loadEnv('e2e', process.cwd(), '');
process.env.DATABASE_URL = env.DATABASE_URL;

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    fileParallelism: false,
  },
});
