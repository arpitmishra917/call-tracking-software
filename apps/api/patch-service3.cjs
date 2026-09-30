const fs = require('fs');
let code = fs.readFileSync('apps/api/src/calls/calls.service.ts', 'utf8');

const newFiltersInterface = `      filters: {
        campaignId?: string;
        buyerId?: string;
        status?: CallState;
        callerNumber?: string;
        trackingNumber?: string;
        durationType?: 'talk' | 'total';
        minDurationSecs?: number;
        maxDurationSecs?: number;
        startDate?: string;
        endDate?: string;
        limit?: number;
        offset?: number;
      },`;

code = code.replace(
  /      filters: {\n        campaignId\?: string;\n        buyerId\?: string;\n        status\?: CallState;\n        callerNumber\?: string;\n        startDate\?: string;\n        endDate\?: string;\n        limit\?: number;\n        offset\?: number;\n      },/g,
  newFiltersInterface
);

const newWhereLogic = `      if (filters.callerNumber) {
        where.from_number = { contains: filters.callerNumber };
      }
      if (filters.trackingNumber) {
        where.to_number = filters.trackingNumber;
      }
      if (filters.durationType) {
        // We use $queryRawUnsafe to filter by computed durations
        let query = \`SELECT id FROM "calls" WHERE workspace_id = $1\`;
        const params = [workspaceId];
        let paramIdx = 2;

        if (filters.durationType === 'talk') {
          query += \` AND answered_at IS NOT NULL AND ended_at IS NOT NULL\`;
          if (filters.minDurationSecs !== undefined) {
            query += \` AND EXTRACT(EPOCH FROM (ended_at - answered_at)) >= $\${paramIdx++}\`;
            params.push(filters.minDurationSecs);
          }
          if (filters.maxDurationSecs !== undefined) {
            query += \` AND EXTRACT(EPOCH FROM (ended_at - answered_at)) <= $\${paramIdx++}\`;
            params.push(filters.maxDurationSecs);
          }
        } else if (filters.durationType === 'total') {
          query += \` AND started_at IS NOT NULL AND ended_at IS NOT NULL\`;
          if (filters.minDurationSecs !== undefined) {
            query += \` AND EXTRACT(EPOCH FROM (ended_at - started_at)) >= $\${paramIdx++}\`;
            params.push(filters.minDurationSecs);
          }
          if (filters.maxDurationSecs !== undefined) {
            query += \` AND EXTRACT(EPOCH FROM (ended_at - started_at)) <= $\${paramIdx++}\`;
            params.push(filters.maxDurationSecs);
          }
        }
        const rawIds = await this.prisma.$queryRawUnsafe<any[]>(query, ...params);
        const durationIds = rawIds.map(r => r.id);
        
        // Merge into the main Prisma where clause
        where.id = { in: durationIds };
      }
`;

code = code.replace(
  /      if \(filters\.callerNumber\) {\n        where\.from_number = { contains: filters\.callerNumber };\n      }/g,
  newWhereLogic
);

const newIncludeAndMapping = `          include: {
            campaign: { select: { name: true } },
            attempts: {
              include: { buyer: { select: { name: true } } },
              orderBy: { created_at: 'asc' },
            },
            recordings: { select: { id: true, status: true } },
          },
          orderBy: { created_at: 'desc' },
          skip: filters.offset || 0,
          take: filters.limit || 50,
        }),
        this.prisma.call.count({ where }),
      ]);
  
      const mappedItems = items.map((item: any) => {
        let talkDurationSecs = null;
        let totalDurationSecs = null;
        if (item.answered_at && item.ended_at) {
          talkDurationSecs = Math.floor((item.ended_at.getTime() - item.answered_at.getTime()) / 1000);
        }
        if (item.started_at && item.ended_at) {
          totalDurationSecs = Math.floor((item.ended_at.getTime() - item.started_at.getTime()) / 1000);
        }
        return {
          ...item,
          talkDurationSecs,
          totalDurationSecs,
        };
      });

      return { items: mappedItems, total };`;

code = code.replace(
  /          include: {\n            campaign: { select: { name: true } },\n            attempts: {\n              include: { buyer: { select: { name: true } } },\n              orderBy: { created_at: 'asc' },\n            },\n          },\n          orderBy: { created_at: 'desc' },\n          skip: filters\.offset \|\| 0,\n          take: filters\.limit \|\| 50,\n        }\),\n        this\.prisma\.call\.count\(\{ where \}\),\n      \]\);\n  \n      return \{ items, total \};/g,
  newIncludeAndMapping
);

fs.writeFileSync('apps/api/src/calls/calls.service.ts', code);
console.log('patched calls.service.ts');
