const { execSync } = require('child_process');

try {
  const url = 'postgresql://postgres:%2A222%2A2%23Arpit@localhost:5432/shadow_db?schema=public';
  execSync(`npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "${url}" --script > prisma/migrations/migration.sql`, {
    stdio: 'inherit',
    cwd: __dirname
  });
  console.log('Diff generated!');
} catch (e) {
  console.error('Failed', e);
}
