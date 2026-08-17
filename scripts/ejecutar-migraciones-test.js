require('dotenv').config({ path: '.env.test', override: true });
const { spawnSync } = require('node:child_process');

const resultado = spawnSync('npx prisma migrate deploy', {
  stdio: 'inherit',
  env: process.env,
  shell: true,
});

process.exit(resultado.status === null ? 1 : resultado.status);