const fs = require('fs');
const path = require('path');

const walk = (dir) => {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach((file) => {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(file));
    } else if (file.endsWith('.ts')) {
      results.push(file);
    }
  });
  return results;
};

const files = walk('apps/api/src');
files.push('apps/api/test/authorization.e2e-spec.ts');
files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  let changed = false;
  content = content.replace(/from\s+['"](\.[^'"]+)['"]/g, (match, p1) => {
    if (!p1.endsWith('.js') && !p1.endsWith('.ts')) {
      changed = true;
      return 'from \'' + p1 + '.js\'';
    }
    return match;
  });
  if (changed) {
    fs.writeFileSync(file, content);
    console.log('Fixed', file);
  }
});
