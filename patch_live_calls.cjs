const fs = require('fs');

let controllerContent = fs.readFileSync('apps/api/src/calls/calls.controller.ts', 'utf8');
const liveCallControllerStr = `
  @Get('live-calls')
  async getLiveCalls(@Param('workspaceId') workspaceId: string) {
    return this.callsService.getLiveCalls(workspaceId);
  }

  @Get(':callId')`;
controllerContent = controllerContent.replace('  @Get(\':callId\')', liveCallControllerStr);
fs.writeFileSync('apps/api/src/calls/calls.controller.ts', controllerContent, 'utf8');

let serviceContent = fs.readFileSync('apps/api/src/calls/calls.service.ts', 'utf8');
const liveCallServiceStr = `
  async getLiveCalls(workspaceId: string) {
    const count = await this.prisma.call.count({
      where: {
        workspace_id: workspaceId,
        state: { in: ['INITIATED', 'ROUTING'] },
      },
    });
    return { liveCalls: count };
  }

  async getCallDetail(workspaceId: string, callId: string) {`;
serviceContent = serviceContent.replace('  async getCallDetail(workspaceId: string, callId: string) {', liveCallServiceStr);
fs.writeFileSync('apps/api/src/calls/calls.service.ts', serviceContent, 'utf8');

console.log('Patched calls successfully');
