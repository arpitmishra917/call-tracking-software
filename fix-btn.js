const fs = require('fs');
let code = fs.readFileSync('apps/web/src/app/protected/phone-numbers/page.tsx', 'utf8');

const t = `{num.campaign ? 'Change' : 'Assign'}\n                              </Button>\n                              <Button\n                                variant="destructive"`;
const t2 = `{num.campaign ? 'Change' : 'Assign'}\r\n                              </Button>\r\n                              <Button\r\n                                variant="destructive"`;

const r = `{num.campaign ? 'Change' : 'Assign'}
                              </Button>
                              {num.campaign && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => openUnassignModal(num)}
                                >
                                  Unassign
                                </Button>
                              )}
                              <Button
                                variant="destructive"`;

code = code.replace(t, r);
code = code.replace(t2, r);

// Fix unescaped apostrophe
code = code.replace("campaign's", "campaign&apos;s");

fs.writeFileSync('apps/web/src/app/protected/phone-numbers/page.tsx', code);
