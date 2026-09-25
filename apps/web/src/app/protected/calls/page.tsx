'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PhoneCall, Search, X } from 'lucide-react';

interface CallLog {
  id: string;
  created_at: string;
  from_number: string;
  to_number: string;
  state: string;
  duration_secs?: number | null;
  campaign?: { name: string } | null;
}

export default function CallsPage() {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get('workspace');
  const [calls, setCalls] = useState<CallLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    startDate: '',
    endDate: '',
    callerNumber: '',
    status: '',
    campaignId: '',
    buyerId: '',
  });

  useEffect(() => {
    async function loadCalls() {
      setLoading(true);
      try {
        const query = new URLSearchParams();
        if (filters.startDate) query.set('startDate', filters.startDate);
        if (filters.endDate) query.set('endDate', filters.endDate);
        if (filters.callerNumber) query.set('callerNumber', filters.callerNumber);
        if (filters.status) query.set('status', filters.status);
        if (filters.campaignId) query.set('campaignId', filters.campaignId);
        if (filters.buyerId) query.set('buyerId', filters.buyerId);
        
        const data = await apiFetch(`/workspaces/${workspaceId}/calls?${query.toString()}`);
        setCalls(data.items);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }

    if (workspaceId) {
      loadCalls();
    }
  }, [workspaceId, filters]);

  const clearFilters = () => {
    setFilters({
      startDate: '',
      endDate: '',
      callerNumber: '',
      status: '',
      campaignId: '',
      buyerId: '',
    });
  };

  const getStatusBadgeVariant = (state: string) => {
    switch (state.toUpperCase()) {
      case 'COMPLETED':
      case 'ANSWERED':
        return 'success';
      case 'NO_ANSWER':
      case 'FAILED':
        return 'error';
      case 'BLOCKED':
        return 'error';
      case 'ROUTING':
      case 'RINGING':
      case 'ACTIVE':
        return 'warning';
      default:
        return 'default';
    }
  };

  if (!workspaceId) return <div className="p-6 text-muted-foreground">Select a workspace first.</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Calls</h1>
          <p className="text-muted-foreground">Operational call logs and routing history.</p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3 border-b border-border">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Search className="w-4 h-4" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
            <div className="space-y-1.5">
              <Label htmlFor="startDate">Start Date</Label>
              <Input 
                id="startDate"
                type="date" 
                value={filters.startDate} 
                onChange={e => setFilters({...filters, startDate: e.target.value})} 
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="endDate">End Date</Label>
              <Input 
                id="endDate"
                type="date" 
                value={filters.endDate} 
                onChange={e => setFilters({...filters, endDate: e.target.value})} 
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="callerNumber">Caller Number</Label>
              <Input 
                id="callerNumber"
                type="text" 
                value={filters.callerNumber} 
                onChange={e => setFilters({...filters, callerNumber: e.target.value})} 
                placeholder="+1..." 
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="status">Status</Label>
              <select 
                id="status"
                value={filters.status} 
                onChange={e => setFilters({...filters, status: e.target.value})} 
                className="flex h-10 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
              >
                <option value="">All Statuses</option>
                <option value="COMPLETED">Completed</option>
                <option value="NO_ANSWER">No Answer</option>
                <option value="FAILED">Failed</option>
                <option value="BLOCKED">Blocked</option>
              </select>
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <Button variant="outline" size="sm" onClick={clearFilters}>
              <X className="w-4 h-4 mr-2" />
              Clear Filters
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Caller</TableHead>
              <TableHead>Tracking No.</TableHead>
              <TableHead>Campaign</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                  <div className="flex items-center justify-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    Loading calls...
                  </div>
                </TableCell>
              </TableRow>
            ) : calls.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-48 text-center">
                  <EmptyState 
                    icon={<PhoneCall className="w-8 h-8" />}
                    title="No calls found"
                    description="No calls match the current filter criteria."
                  />
                </TableCell>
              </TableRow>
            ) : (
              calls.map(call => (
                <TableRow key={call.id} className="group">
                  <TableCell className="font-medium whitespace-nowrap">
                    {new Date(call.created_at).toLocaleString(undefined, { 
                      month: 'short', 
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit'
                    })}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{call.from_number}</TableCell>
                  <TableCell className="font-mono text-xs">{call.to_number}</TableCell>
                  <TableCell>{call.campaign?.name || '-'}</TableCell>
                  <TableCell>{call.duration_secs ? `${call.duration_secs}s` : '-'}</TableCell>
                  <TableCell>
                    <Badge variant={getStatusBadgeVariant(call.state)}>
                      {call.state}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Link 
                      href={`/protected/calls/${call.id}?workspace=${workspaceId}`}
                      className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors hover:bg-muted hover:text-foreground h-9 px-3"
                    >
                      View
                    </Link>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
