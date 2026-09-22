const fs = require('fs');
const path = 'C:\\Users\\prate\\OneDrive\\Desktop\\call-tracking-software\\apps\\api\\src\\webhooks\\webhooks.service.ts';
let code = fs.readFileSync(path, 'utf8');

// Add import
if (!code.includes('safeFetch')) {
  code = code.replace(
    "import * as crypto from 'crypto';",
    "import * as crypto from 'crypto';\nimport { safeFetch } from '../common/safe-fetch.js';"
  );
}

// Replace fetch with safeFetch
code = code.replace(
  "const response = await fetch(url, {",
  "const response = await safeFetch(url, {"
);

fs.writeFileSync(path, code);
