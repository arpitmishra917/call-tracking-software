const fs = require('fs');
let code = fs.readFileSync('apps/web/src/app/protected/phone-numbers/page.tsx', 'utf8');

code = code.replace(/\{num\.campaign \? 'Change' : 'Assign'\}\s*<\/Button>/g, 
`{num.campaign ? 'Change' : 'Assign'}
                              </Button>
                              {num.campaign && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => openUnassignModal(num)}
                                >
                                  Unassign
                                </Button>
                              )}`);

fs.writeFileSync('apps/web/src/app/protected/phone-numbers/page.tsx', code);
