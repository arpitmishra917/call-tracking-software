const fs = require('fs');
let code = fs.readFileSync('apps/web/src/app/protected/phone-numbers/page.tsx', 'utf8');

// Add Unassign state
const stateReplacement = `  const [selectedPhone, setSelectedPhone] = useState<PhoneNumber | null>(null);
  const [selectedCampaignId, setSelectedCampaignId] = useState('');
  const [isAssigning, setIsAssigning] = useState(false);

  // Unassign Modal State
  const [unassignModalOpen, setUnassignModalOpen] = useState(false);
  const [isUnassigning, setIsUnassigning] = useState(false);`;

code = code.replace(
    "  const [selectedPhone, setSelectedPhone] = useState<PhoneNumber | null>(null);\n  const [selectedCampaignId, setSelectedCampaignId] = useState('');\n  const [isAssigning, setIsAssigning] = useState(false);",
    stateReplacement
);

// Fallback for CRLF
code = code.replace(
    "  const [selectedPhone, setSelectedPhone] = useState<PhoneNumber | null>(null);\r\n  const [selectedCampaignId, setSelectedCampaignId] = useState('');\r\n  const [isAssigning, setIsAssigning] = useState(false);",
    stateReplacement
);

// Add handlers
const handlersInsertion = `  function openAssignModal(phone: PhoneNumber) {
    setSelectedPhone(phone);
    setSelectedCampaignId(phone.campaign_id || '');
    setAssignModalOpen(true);
  }

  function openUnassignModal(phone: PhoneNumber) {
    setSelectedPhone(phone);
    setUnassignModalOpen(true);
  }

  async function handleUnassign() {
    if (!workspaceId || !selectedPhone || !selectedPhone.campaign_id) return;
    setIsUnassigning(true);
    setError(null);
    try {
      await apiFetch(\`/workspaces/\${workspaceId}/campaigns/\${selectedPhone.campaign_id}/phone-numbers/\${selectedPhone.id}\`, {
        method: 'DELETE',
      });
      setSuccess('Phone number unassigned successfully.');
      setUnassignModalOpen(false);
      setSelectedPhone(null);
      await loadPhoneNumbers(workspaceId);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsUnassigning(false);
    }
  }`;

code = code.replace(
    "  function openAssignModal(phone: PhoneNumber) {\n    setSelectedPhone(phone);\n    setSelectedCampaignId(phone.campaign_id || '');\n    setAssignModalOpen(true);\n  }",
    handlersInsertion
);
code = code.replace(
    "  function openAssignModal(phone: PhoneNumber) {\r\n    setSelectedPhone(phone);\r\n    setSelectedCampaignId(phone.campaign_id || '');\r\n    setAssignModalOpen(true);\r\n  }",
    handlersInsertion
);

// Add buttons in table
const buttonTarget = `{num.campaign ? 'Change' : 'Assign'}
                              </Button>
                              <Button
                                variant="destructive"`;
const buttonReplacement = `{num.campaign ? 'Change' : 'Assign'}
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
code = code.replace(buttonTarget, buttonReplacement);
code = code.replace(buttonTarget.replace(/\n/g, "\r\n"), buttonReplacement);


// Add Unassign Modal JSX
const releaseModalTarget = `{releaseModalOpen && selectedPhone && (`;
const unassignModalJSX = `{unassignModalOpen && selectedPhone && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md shadow-lg">
            <CardHeader>
              <CardTitle>Unassign Phone Number</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Are you sure you want to unassign <strong>{selectedPhone.phone_number}</strong>? 
                It will no longer route inbound calls to the campaign's buyers.
                <br /><br />
                The number will remain provisioned in your workspace and historical call data will be preserved.
              </p>
            </CardContent>
            <CardFooter className="flex justify-end gap-3 pt-4 border-t border-border">
              <Button
                variant="outline"
                type="button"
                onClick={() => setUnassignModalOpen(false)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleUnassign}
                isLoading={isUnassigning}
              >
                Unassign
              </Button>
            </CardFooter>
          </Card>
        </div>
      )}
      {releaseModalOpen && selectedPhone && (`;
code = code.replace(releaseModalTarget, unassignModalJSX);

fs.writeFileSync('apps/web/src/app/protected/phone-numbers/page.tsx', code);
