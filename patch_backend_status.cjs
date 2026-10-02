const fs = require('fs');
let f = fs.readFileSync('apps/api/src/calls/calls.service.ts', 'utf8');

const target = `    if (filters.status) {
      where.state = filters.status;
    }`;

const replacement = `    if (filters.status) {
      if (!Object.values(CallState).includes(filters.status as CallState)) {
        throw new BadRequestException(\`Invalid status: \${filters.status}\`);
      }
      where.state = filters.status;
    }`;

f = f.replace(target, replacement);
fs.writeFileSync('apps/api/src/calls/calls.service.ts', f);
