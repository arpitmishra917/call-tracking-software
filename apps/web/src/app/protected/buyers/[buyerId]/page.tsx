'use client';

import { useEffect, useState, use } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowLeft, UserSquare2, Phone, AlertCircle, Info, Target, Clock } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface BuyerDetail {
  id: string;
  name: string;
  destination_number: string;
  status: string;
  timeout: number;
  created_at: string;
  campaigns: {
    id: string;
    priority: number;
    campaign: {
      id: string;
      name: string;
      status: string;
    };
  }[];
}

export default function BuyerDetailPage({ params }: { params: Promise<{ buyerId: string }> | { buyerId: string } }) {
  const unwrappedParams = params instanceof Promise ? use(params) : params as { buyerId: string };
  const buyerId = unwrappedParams.buyerId;
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get('workspace');
  
  const [buyer, setBuyer] = useState<BuyerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadBuyer() {
      setLoading(true);
      setError(null);
      try {
        const data = await apiFetch(`/workspaces/${workspaceId}/buyers/${buyerId}`);
        setBuyer(data);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Buyer not found or access denied.');
      } finally {
        setLoading(false);
      }
    }

    if (workspaceId && buyerId) {
      loadBuyer();
    }
  }, [workspaceId, buyerId]);

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
        Loading buyer details...
      </div>
    );
  }

  if (error || !buyer) {
    return (
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="bg-error-muted text-error-muted-foreground p-4 rounded-md border border-error/20 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p>{error || 'Buyer not found.'}</p>
        </div>
        <Link 
          href={`/protected/buyers?workspace=${workspaceId}`}
          className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors border border-border bg-surface hover:bg-muted hover:text-foreground h-10 px-4 py-2"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Buyers
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
              href={`/protected/buyers?workspace=${workspaceId}`}
              className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors hover:bg-muted h-10 w-10 -ml-2 text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="sr-only">Back</span>
            </Link>
            <h1 className="text-2xl font-bold tracking-tight">Buyer Details</h1>
            <Badge variant={getStatusBadgeVariant(buyer.status)} className="ml-2">
              {buyer.status}
            </Badge>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground ml-11">
            <span className="font-mono text-xs">{buyer.id}</span>
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
                  <UserSquare2 className="w-3.5 h-3.5" /> Buyer Name
                </span>
                <p className="font-medium text-base">{buyer.name}</p>
              </div>
              
              <div className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5" /> Destination Number
                </span>
                <p className="font-mono text-base font-medium">{buyer.destination_number}</p>
              </div>

              <div className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" /> Ring Timeout
                </span>
                <p className="font-medium text-sm">{buyer.timeout} seconds</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Associated Campaigns */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="h-full flex flex-col">
            <CardHeader className="pb-3 border-b border-border flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Target className="w-4 h-4 text-primary" />
                  Associated Campaigns
                </CardTitle>
                <CardDescription className="mt-1">
                  Campaigns where this buyer is assigned.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="p-0 flex-1">
              {!buyer.campaigns || buyer.campaigns.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-12">
                  This buyer is not assigned to any campaigns.
                </div>
              ) : (
                <Table>
                  <TableHeader className="bg-muted/30">
                    <TableRow>
                      <TableHead>Campaign</TableHead>
                      <TableHead className="text-center w-[120px]">Priority Index</TableHead>
                      <TableHead className="text-right">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {buyer.campaigns.map((cb) => (
                      <TableRow key={cb.id}>
                        <TableCell className="font-medium">
                          <Link href={`/protected/campaigns/${cb.campaign.id}?workspace=${workspaceId}`} className="hover:underline hover:text-primary transition-colors">
                            {cb.campaign.name}
                          </Link>
                        </TableCell>
                        <TableCell className="text-center font-medium">
                          <span className="bg-secondary text-secondary-foreground px-2 py-0.5 rounded-full inline-flex items-center justify-center text-xs">
                            {cb.priority}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant={cb.campaign.status === 'ACTIVE' ? 'success' : cb.campaign.status === 'INACTIVE' ? 'warning' : 'default'} className="text-[10px] px-1.5 h-5">
                            {cb.campaign.status}
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
