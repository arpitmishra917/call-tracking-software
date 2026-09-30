const fs = require('fs');

let content = fs.readFileSync('apps/web/src/app/protected/reporting/page.tsx', 'utf8');

// 1. Update formatDuration
const oldFormat = `  const formatDuration = (secs: number) => {
    if (!secs) return '0s';
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return m > 0 ? \`\${m}m \${s}s\` : \`\${s}s\`;
  };`;

const newFormat = `  const formatDuration = (secs: number | null | undefined) => {
    if (secs === null || secs === undefined) return '—';
    if (secs === 0) return '00:00';
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    
    const pad = (n: number) => n.toString().padStart(2, '0');
    
    if (h > 0) {
      return \`\${pad(h)}:\${pad(m)}:\${pad(s)}\`;
    }
    return \`\${pad(m)}:\${pad(s)}\`;
  };`;
content = content.replace(oldFormat, newFormat);


// 2. Replace Grid Layout & Avg Duration Card
const oldGrid = `          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">`;
const newGrid = `          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">`;
content = content.replace(oldGrid, newGrid);

const oldAvgCard = `            <Card>
              <CardContent className="p-6">
                <div className="flex items-center gap-2 text-muted-foreground mb-2">
                  <Clock className="h-4 w-4 text-blue-500" />
                  <span className="text-sm font-medium">Avg Answered Duration</span>
                </div>
                <div className="text-3xl font-bold text-foreground">{formatDuration(metrics.avgDuration)}</div>
              </CardContent>
            </Card>`;
const newCards = `            <Card>
              <CardContent className="p-6">
                <div className="flex items-center gap-2 text-muted-foreground mb-2">
                  <Clock className="h-4 w-4 text-blue-500" />
                  <span className="text-sm font-medium">ACL</span>
                </div>
                <div className="text-3xl font-bold text-foreground">{formatDuration((metrics as any).aclSecs)}</div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center gap-2 text-muted-foreground mb-2">
                  <Clock className="h-4 w-4 text-indigo-500" />
                  <span className="text-sm font-medium">TCL</span>
                </div>
                <div className="text-3xl font-bold text-foreground">{formatDuration((metrics as any).tclSecs)}</div>
              </CardContent>
            </Card>`;
content = content.replace(oldAvgCard, newCards);


// 3. Update Campaign Table Header
const oldCampHeader = `                        <TableHead className="text-right min-w-[100px]">Total Calls</TableHead>
                        <TableHead className="text-right min-w-[100px]">Answered</TableHead>
                        <TableHead className="text-right min-w-[100px]">Answer Rate</TableHead>`;
const newCampHeader = `                        <TableHead className="text-right min-w-[100px]">Total Calls</TableHead>
                        <TableHead className="text-right min-w-[100px]">Answered</TableHead>
                        <TableHead className="text-right min-w-[100px]">Answer Rate</TableHead>
                        <TableHead className="text-right min-w-[100px]">ACL</TableHead>
                        <TableHead className="text-right min-w-[100px]">TCL</TableHead>`;
content = content.replace(oldCampHeader, newCampHeader);


// 4. Update Campaign Table Row
const oldCampRow = `                          <TableCell className="text-right">
                            <Badge variant="outline" className="font-mono text-xs bg-muted">
                              {calculateRate(stats.answered, stats.total)}
                            </Badge>
                          </TableCell>
                        </TableRow>`;
const newCampRow = `                          <TableCell className="text-right">
                            <Badge variant="outline" className="font-mono text-xs bg-muted">
                              {calculateRate(stats.answered, stats.total)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">{formatDuration((stats as any).aclSecs)}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{formatDuration((stats as any).tclSecs)}</TableCell>
                        </TableRow>`;
content = content.replace(oldCampRow, newCampRow);


// 5. Update Buyer Table Header
const oldBuyerHeader = `                        <TableHead className="text-right min-w-[100px]">Total Attempts</TableHead>
                        <TableHead className="text-right min-w-[100px]">Answered</TableHead>
                        <TableHead className="text-right min-w-[100px]">Connect Rate</TableHead>`;
const newBuyerHeader = `                        <TableHead className="text-right min-w-[100px]">Total Attempts</TableHead>
                        <TableHead className="text-right min-w-[100px]">Answered</TableHead>
                        <TableHead className="text-right min-w-[100px]">Connect Rate</TableHead>
                        <TableHead className="text-right min-w-[100px]">ACL</TableHead>
                        <TableHead className="text-right min-w-[100px]">TCL</TableHead>`;
content = content.replace(oldBuyerHeader, newBuyerHeader);


// 6. Update Buyer Table Row
const oldBuyerRow = `                          <TableCell className="text-right">
                            <Badge variant="outline" className="font-mono text-xs bg-muted">
                              {calculateRate(stats.answered, stats.total)}
                            </Badge>
                          </TableCell>
                        </TableRow>`;
const newBuyerRow = `                          <TableCell className="text-right">
                            <Badge variant="outline" className="font-mono text-xs bg-muted">
                              {calculateRate(stats.answered, stats.total)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">{formatDuration((stats as any).aclSecs)}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{formatDuration((stats as any).tclSecs)}</TableCell>
                        </TableRow>`;
content = content.replace(oldBuyerRow, newBuyerRow);


fs.writeFileSync('apps/web/src/app/protected/reporting/page.tsx', content, 'utf8');
console.log('Successfully patched frontend reporting page');
