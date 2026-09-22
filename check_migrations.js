const fs = require('fs');
const path = require('path');

const migrationsDir = 'apps/api/prisma/migrations';
const dirs = fs.readdirSync(migrationsDir).filter(f => fs.statSync(path.join(migrationsDir, f)).isDirectory());

let usageFound = false;
let recordingsFound = false;

for (const dir of dirs) {
  const sqlPath = path.join(migrationsDir, dir, 'migration.sql');
  if (fs.existsSync(sqlPath)) {
    const content = fs.readFileSync(sqlPath, 'utf8');
    if (content.includes('usage_records')) {
      usageFound = true;
      console.log(`Found usage_records in ${dir}`);
    }
    if (content.includes('recordings')) {
      recordingsFound = true;
      console.log(`Found recordings in ${dir}`);
    }
  }
}

console.log('Usage records found in migrations:', usageFound);
console.log('Recordings found in migrations:', recordingsFound);
