const fs = require('fs');
let code = fs.readFileSync('apps/api/test/routing-engine.e2e-spec.ts', 'utf8');

// Fix the trailing describe block issue
code = code.replace("});\r\n\r\n  it('R1-05:", "  it('R1-05:");
code = code.replace("});\n\n  it('R1-05:", "  it('R1-05:");
if (!code.endsWith('});\n')) {
  code += '\n});\n';
}

// Add money to the test workspace
const seedBlock = `    workspaceId = ws.id;

    await prisma.workspaceBalance.create({
      data: {
        workspace_id: workspaceId,
        balance_micro: 50000000n,
        reserved_micro: 0n,
      }
    });
`;

code = code.replace("workspaceId = ws.id;", seedBlock);
fs.writeFileSync('apps/api/test/routing-engine.e2e-spec.ts', code);
