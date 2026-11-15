const { execSync } = require('child_process');
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://postgres:password@localhost:5432/calltracking_mvp_test?schema=public";
try {
  execSync('npx prisma migrate deploy', { stdio: 'inherit', cwd: require('path').resolve(__dirname, '../../apps/api') });
} catch(e) {
  console.error(e);
}
