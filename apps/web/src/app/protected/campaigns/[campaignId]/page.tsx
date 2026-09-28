'use client';

import { useEffect, useState, use } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Target, Phone, Hash, AlertCircle, Info, ListOrdered } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface CampaignDetail {
  id: string;
  name: string;
  status: string;
  created_at: string;
  phone_numbers: { id: string; phone_number: string; provider: string }[];
  buyers: {
    id: string;
    priority: number;
    buyer: {
      id: string;
      name: string;
      destination_number: string;
      status: string;
    };
  }[];
}

export default function CampaignDetailPage({ params }: { params: Promise<{ campaignId: string }> | { campaignId: string } }) {
  const unwrappedParams = params instanceof Promise ? use(params) : params as { campaignId: string };
  const campaignId = unwrappedParams.campaignId;
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get('workspace');
  
  const [campaign, setCampaign] = useState<CampaignDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadCampaign() {
      setLoading(true);
      setError(null);
      try {
        const data = await apiFetch(`/workspaces/${workspaceId}/campaigns/${campaignId}`);
        setCampaign(data);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Campaign not found or access denied.');
      } finally {
        setLoading(false);
      }
    }

    if (workspaceId && campaignId) {
      loadCampaign();
    }
  }, [workspaceId, campaignId]);

  const getStatusBadgeVariant = (state: string) => {
    switch (state?.toUpperCase()) {
      case 'ACTIVE':
        return 'success';
      case 'INACTIVE':
      case 'PAUSED':
        return 'warning';
      default:
        return 'default';
    }
  };

  if (!workspaceId) {
    return <div className="p-8 text-muted-foreground">Please select a workspace first.</div>;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-current border-t-transparent mr-2" />
        Loading campaign details...
      </div>
    );
  }

  if (error || !campaign) {
    return (
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="bg-error-muted text-error-muted-foreground p-4 rounded-md border border-error/20 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p>{error || 'Campaign not found.'}</p>
        </div>
        <Link 
          href={`/protected/campaigns?workspace=${workspaceId}`}
          className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors border border-border bg-surface hover:bg-muted hover:text-foreground h-10 px-4 py-2"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Campaigns
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-5xl mx-auto pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border pb-6">
        <div className="space-y-1">
          <div className="flex items-center gap-3 mb-2">
            <Link 
              href={`/protected/campaigns?workspace=${workspaceId}`}
              className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors hover:bg-muted h-10 w-10 -ml-2 text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="sr-only">Back</span>
            </Link>
            <h1 className="text-2xl font-bold tracking-tight">Campaign Details</h1>
            <Badge variant={getStatusBadgeVariant(campaign.status)} className="ml-2">
              {campaign.status}
            </Badge>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground ml-11">
            <span className="font-mono text-xs">{campaign.id}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Summary & Metadata */}
        <div className="lg:col-span-1 space-y-6">
          <Card>
            <CardHeader className="pb-3 border-b border-border">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Info className="w-4 h-4 text-primary" />
                Information
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6 space-y-6">
              <div className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Target className="w-3.5 h-3.5" /> Campaign Name
                </span>
                <p className="font-medium text-base">{campaign.name}</p>
              </div>
              
              <div className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Hash className="w-3.5 h-3.5" /> Created On
                </span>
                <p className="font-medium text-sm">
                  {new Date(campaign.created_at).toLocaleDateString()}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3 border-b border-border">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Phone className="w-4 h-4 text-primary" />
                Assigned Numbers
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 p-0">
              {campaign.phone_numbers.length === 0 ? (
                <div className="text-sm text-muted-foreground p-6 text-center">
                  No tracking numbers assigned.
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {campaign.phone_numbers.map(num => (
                    <div key={num.id} className="p-4 flex flex-col gap-1">
                      <span className="font-mono text-sm font-medium">{num.phone_number}</span>
                      <span className="text-xs text-muted-foreground capitalize">{num.provider}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Assigned Buyers */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="h-full flex flex-col">
            <CardHeader className="pb-3 border-b border-border flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <ListOrdered className="w-4 h-4 text-primary" />
                  Routing Priority
                </CardTitle>
                <CardDescription className="mt-1">
                  Buyers in order of ring attempts.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="p-0 flex-1">
              {campaign.buyers.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-12">
                  No buyers assigned to this campaign yet.
                </div>
              ) : (
                <Table>
                  <TableHeader className="bg-muted/30">
                    <TableRow>
                      <TableHead className="w-[80px] text-center">Priority</TableHead>
                      <TableHead>Buyer</TableHead>
                      <TableHead>Destination</TableHead>
                      <TableHead className="text-right">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {campaign.buyers.map((cb) => (
                      <TableRow key={cb.id}>
                        <TableCell className="text-center font-medium">
                          <span className="bg-secondary text-secondary-foreground w-6 h-6 rounded-full inline-flex items-center justify-center text-xs">
                            {cb.priority}
                          </span>
                        </TableCell>
                        <TableCell className="font-medium">
                          <Link href={`/protected/buyers/${cb.buyer.id}?workspace=${workspaceId}`} className="hover:underline hover:text-primary transition-colors">
                            {cb.buyer.name}
                          </Link>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {cb.buyer.destination_number}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant={cb.buyer.status === 'ACTIVE' ? 'success' : cb.buyer.status === 'INACTIVE' ? 'warning' : 'default'} className="text-[10px] px-1.5 h-5">
                            {cb.buyer.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
