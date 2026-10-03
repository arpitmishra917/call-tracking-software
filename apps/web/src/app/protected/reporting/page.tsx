'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend, LineChart, Line, PieChart, Pie, Cell 
} from 'recharts';
import { 
  PhoneCall, PhoneIncoming, PhoneMissed, PhoneOff, Clock, Search, RotateCcw, AlertCircle, RefreshCw, BarChart3, Filter, X, Settings2, ChevronUp, ChevronDown, Bookmark, Save, Trash2, Edit2
} from 'lucide-react';

function formatDurationHms(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || isNaN(seconds)) return '00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}


type ColumnId = 'time' | 'caller' | 'trackingNumber' | 'campaign' | 'finalDestination' | 'status' | 'talkDuration' | 'totalDuration' | 'attempts' | 'recording' | 'actions';

interface ColumnDef {
  id: ColumnId;
  label: string;
  visible: boolean;
  order: number;
  locked?: boolean;
}

const DEFAULT_COLUMNS: ColumnDef[] = [
  { id: 'time', label: 'Date / Time', visible: true, order: 0 },
  { id: 'caller', label: 'Caller', visible: true, order: 1 },
  { id: 'trackingNumber', label: 'Tracking Number', visible: true, order: 2 },
  { id: 'campaign', label: 'Campaign', visible: true, order: 3 },
  { id: 'finalDestination', label: 'Final Destination', visible: true, order: 4 },
  { id: 'status', label: 'Status', visible: true, order: 5 },
  { id: 'talkDuration', label: 'Talk Duration', visible: true, order: 6 },
  { id: 'totalDuration', label: 'Total Duration', visible: true, order: 7 },
  { id: 'attempts', label: 'Attempts', visible: true, order: 8 },
  { id: 'recording', label: 'Recording', visible: true, order: 9 },
  { id: 'actions', label: 'Actions', visible: true, order: 10, locked: true },
];

export default function ReportingDashboard({ params }: { params: { workspaceId: string } }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Read Canonical State from URL
  const startDate = searchParams.get('startDate') || '';
  const endDate = searchParams.get('endDate') || '';
  const campaignId = searchParams.get('campaignId') || '';
  const buyerId = searchParams.get('buyerId') || '';
  const trackingNumber = searchParams.get('trackingNumber') || '';
  const callerNumber = searchParams.get('callerNumber') || '';
  const status = searchParams.get('status') || '';
  const minDuration = searchParams.get('minDuration') || '';
  const maxDuration = searchParams.get('maxDuration') || '';
  const bucket = searchParams.get('bucket') || 'day';
  const groupBy = searchParams.get('groupBy') || 'Campaign';
  const page = parseInt(searchParams.get('page') || '1', 10);
  
  // Local UI State for Draft Filters
  const [draftFilters, setDraftFilters] = useState({
    startDate, endDate, campaignId, buyerId, trackingNumber, callerNumber, status, minDuration, maxDuration
  });
  
  // Sync URL changes back to draft filters (e.g. back button or chip removal)
  useEffect(() => {
    setDraftFilters({ startDate, endDate, campaignId, buyerId, trackingNumber, callerNumber, status, minDuration, maxDuration });
  }, [startDate, endDate, campaignId, buyerId, trackingNumber, callerNumber, status, minDuration, maxDuration]);

  const [metrics, setMetrics] = useState<Record<string, any> | null>(null);
  const [calls, setCalls] = useState<any[]>([]);
  const [callsTotal, setCallsTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  
  
  const [savedReports, setSavedReports] = useState<any[]>([]);
  const [showReportsMenu, setShowReportsMenu] = useState(false);
  const [reportName, setReportName] = useState('');
  const [reportVisibility, setReportVisibility] = useState<'PERSONAL' | 'SHARED'>('PERSONAL');
  const [isSavingReport, setIsSavingReport] = useState(false);

  const fetchSavedReports = useCallback(async () => {
    if (!params.workspaceId) return;
    try {
      const res = await apiFetch(`/workspaces/${params.workspaceId}/reports`);
      if (res.ok) {
        setSavedReports(await res.json());
      }
    } catch (e) {
      console.error(e);
    }
  }, [params.workspaceId]);

  useEffect(() => {
    fetchSavedReports();
  }, [fetchSavedReports]);

  const handleSaveReport = async () => {
    if (!reportName.trim()) return alert('Name required');
    const config = {
      filters: draftFilters,
      groupBy,
      bucket,
      columns: columns.map(c => ({ id: c.id, visible: c.visible, order: c.order })),
    };
    
    try {
      const res = await apiFetch(`/workspaces/${params.workspaceId}/reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: reportName, visibility: reportVisibility, configuration: config })
      });
      if (!res.ok) throw new Error('Failed to save report');
      setReportName('');
      setIsSavingReport(false);
      fetchSavedReports();
    } catch (e: any) {
      alert(e.message);
    }
  };

  const applyReport = (report: any) => {
    const config = report.configuration || {};
    
    if (config.filters) {
      const q = new URLSearchParams();
      Object.entries(config.filters).forEach(([k, v]) => { if (v) q.set(k, v as string); });
      if (config.groupBy) q.set('groupBy', config.groupBy);
      if (config.bucket) q.set('bucket', config.bucket);
      router.push(`/protected/reporting?${q.toString()}`);
    }
    
    if (config.columns && Array.isArray(config.columns)) {
      const validIds = new Set(DEFAULT_COLUMNS.map(c => c.id));
      const filtered = config.columns.filter((p: any) => validIds.has(p.id));
      const newCols = DEFAULT_COLUMNS.map(def => {
        const found = filtered.find((p: any) => p.id === def.id);
        if (found) {
          return { ...def, visible: def.locked ? true : found.visible, order: found.order };
        }
        return def;
      }).sort((a, b) => a.order - b.order);
      newCols.forEach((c, i) => c.order = i);
      saveColumns(newCols);
    }
    setShowReportsMenu(false);
  };

  const deleteReport = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm('Delete this saved report?')) return;
    try {
      const res = await apiFetch(`/workspaces/${params.workspaceId}/reports/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete report');
      fetchSavedReports();
    } catch(err: any) {
      alert(err.message);
    }
  };

  useEffect(() => {
    const closeMenu = (e: MouseEvent) => {
      if (showReportsMenu && !(e.target as Element).closest('.reports-dropdown-container')) {
        setShowReportsMenu(false);
      }
    };
    document.addEventListener('mousedown', closeMenu);
    return () => document.removeEventListener('mousedown', closeMenu);
  }, [showReportsMenu]);

  const [columns, setColumns] = useState<ColumnDef[]>([...DEFAULT_COLUMNS]);
  const [showColumnMenu, setShowColumnMenu] = useState(false);

  useEffect(() => {
    if (!params.workspaceId) return;
    const key = `callflow.reporting.columns.${params.workspaceId}`;
    try {
      const saved = localStorage.getItem(key);
      if (saved) {
        const parsed = JSON.parse(saved);
        const validIds = new Set(DEFAULT_COLUMNS.map(c => c.id));
        const filtered = parsed.filter((p: any) => validIds.has(p.id));
        
        const newCols = DEFAULT_COLUMNS.map(def => {
          const found = filtered.find((p: any) => p.id === def.id);
          if (found) {
            return { ...def, visible: def.locked ? true : found.visible, order: found.order };
          }
          return def;
        }).sort((a, b) => a.order - b.order);
        
        newCols.forEach((c, i) => c.order = i);
        setColumns(newCols);
      }
    } catch (e) {
      console.error("Malformed localStorage columns", e);
    }
  }, [params.workspaceId]);

  const saveColumns = (newCols: ColumnDef[]) => {
    setColumns(newCols);
    if (!params.workspaceId) return;
    const key = `callflow.reporting.columns.${params.workspaceId}`;
    localStorage.setItem(key, JSON.stringify(newCols.map(c => ({ id: c.id, visible: c.visible, order: c.order }))));
  };

  const resetColumns = () => saveColumns([...DEFAULT_COLUMNS]);

  const moveColumn = (index: number, direction: -1 | 1) => {
    if (index + direction < 0 || index + direction >= columns.length) return;
    const newCols = [...columns];
    const temp = newCols[index];
    newCols[index] = newCols[index + direction];
    newCols[index + direction] = temp;
    newCols.forEach((c, i) => c.order = i);
    saveColumns(newCols);
  };

  const toggleColumn = (index: number) => {
    const newCols = [...columns];
    if (newCols[index].locked) return;
    newCols[index].visible = !newCols[index].visible;
    saveColumns(newCols);
  };

  const visibleColumns = columns.filter(c => c.visible);

  // Close dropdown when clicking outside
  useEffect(() => {
    const closeMenu = (e: MouseEvent) => {
      if (showColumnMenu && !(e.target as Element).closest('.columns-dropdown-container')) {
        setShowColumnMenu(false);
      }
    };
    document.addEventListener('mousedown', closeMenu);
    return () => document.removeEventListener('mousedown', closeMenu);
  }, [showColumnMenu]);

const limit = 20;

  const fetchReporting = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams(searchParams.toString());
      
      // Fetch Aggregated Metrics
      const metricsRes = await apiFetch(`/workspaces/${params.workspaceId}/calls/metrics?${q.toString()}`);
      if (!metricsRes.ok) throw new Error('Failed to load reporting metrics');
      const metricsData = await metricsRes.json();
      setMetrics(metricsData);
      
      // Fetch Paginated Detailed Calls
      const callsQ = new URLSearchParams(q.toString());
      if (minDuration) callsQ.set('minDurationSecs', minDuration);
      if (maxDuration) callsQ.set('maxDurationSecs', maxDuration);
      callsQ.set('limit', limit.toString());
      callsQ.set('offset', ((page - 1) * limit).toString());
      
      const callsRes = await apiFetch(`/workspaces/${params.workspaceId}/calls?${callsQ.toString()}`);
      if (!callsRes.ok) throw new Error('Failed to load detailed calls');
      const callsData = await callsRes.json();
      setCalls(callsData.items || []);
      setCallsTotal(callsData.total || 0);
      
    } catch (err: any) { // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setError(err.message || 'Unable to load reporting data');
    } finally {
      setLoading(false);
    }
  }, [params.workspaceId, searchParams, page, minDuration, maxDuration]);

  useEffect(() => {
    fetchReporting();
  }, [fetchReporting]);

  const applyFilters = () => {
    if (draftFilters.minDuration && draftFilters.maxDuration) {
      if (parseInt(draftFilters.minDuration, 10) > parseInt(draftFilters.maxDuration, 10)) {
        alert('Minimum duration cannot be greater than maximum duration.');
        return;
      }
    }
    if (draftFilters.startDate && draftFilters.endDate) {
      if (new Date(draftFilters.startDate) > new Date(draftFilters.endDate)) {
        alert('Start date cannot be after end date.');
        return;
      }
    }
    const q = new URLSearchParams();
    Object.entries(draftFilters).forEach(([k, v]) => { if (v) q.set(k, v); });
    q.set('bucket', bucket);
    q.set('groupBy', groupBy);
    q.set('page', '1');
    router.push(`${pathname}?${q.toString()}`);
  };

  const resetFilters = () => {
    setDraftFilters({ startDate: '', endDate: '', campaignId: '', buyerId: '', trackingNumber: '', callerNumber: '', status: '', minDuration: '', maxDuration: '' });
    router.push(`${pathname}?bucket=day&groupBy=Campaign&page=1`);
  };

  const removeFilter = (key: string) => {
    const q = new URLSearchParams(searchParams.toString());
    q.delete(key);
    q.set('page', '1');
    router.push(`${pathname}?${q.toString()}`);
  };

  const handleGroupChange = (newGroup: string) => {
    const q = new URLSearchParams(searchParams.toString());
    q.set('groupBy', newGroup);
    router.push(`${pathname}?${q.toString()}`);
  };

  const handleBucketChange = (newBucket: string) => {
    const q = new URLSearchParams(searchParams.toString());
    q.set('bucket', newBucket);
    router.push(`${pathname}?${q.toString()}`);
  };
  
  const setPage = (newPage: number) => {
    const q = new URLSearchParams(searchParams.toString());
    q.set('page', newPage.toString());
    router.push(`${pathname}?${q.toString()}`);
  };

  const activeChips = useMemo(() => {
    const chips = [];
    if (startDate) chips.push({ key: 'startDate', label: `From: ${startDate}` });
    if (endDate) chips.push({ key: 'endDate', label: `To: ${endDate}` });
    if (campaignId) chips.push({ key: 'campaignId', label: `Campaign: ${campaignId}` });
    if (buyerId) chips.push({ key: 'buyerId', label: `Buyer: ${buyerId}` });
    if (trackingNumber) chips.push({ key: 'trackingNumber', label: `Number: ${trackingNumber}` });
    if (callerNumber) chips.push({ key: 'callerNumber', label: `Caller: ${callerNumber}` });
    if (status) chips.push({ key: 'status', label: `Status: ${status}` });
    if (minDuration) chips.push({ key: 'minDuration', label: `Min Dur: ${minDuration}s` });
    if (maxDuration) chips.push({ key: 'maxDuration', label: `Max Dur: ${maxDuration}s` });
    return chips;
  }, [startDate, endDate, campaignId, buyerId, trackingNumber, callerNumber, status, minDuration, maxDuration]);

  const outcomeData = metrics ? [
    { name: 'Answered', value: metrics.answered || 0, color: '#10b981' }, 
    { name: 'Missed', value: metrics.missed || 0, color: '#f97316' }, 
    { name: 'Failed', value: metrics.failed || 0, color: '#ef4444' }, 
  ].filter(d => d.value > 0) : [];

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Reporting</h1>
          <p className="text-muted-foreground mt-1">
            Monitor call volume, connection performance, duration, campaigns, buyers, and tracking numbers.
          </p>
        </div>
        <div className="flex items-center gap-2">
            <div className="relative reports-dropdown-container z-50">
              <Button variant="outline" size="sm" onClick={() => setShowReportsMenu(!showReportsMenu)}>
                <Bookmark className="w-4 h-4 mr-2" />
                Saved Reports
              </Button>
              {showReportsMenu && (
                <div className="absolute right-0 mt-2 w-80 bg-surface border border-border rounded-md shadow-lg overflow-hidden">
                  {!isSavingReport ? (
                    <>
                      <div className="p-3 border-b border-border flex justify-between items-center bg-muted/30">
                        <span className="text-sm font-semibold text-foreground">Saved Reports</span>
                        <Button variant="default" size="sm" className="h-7 text-xs" onClick={() => setIsSavingReport(true)}>
                          <Save className="w-3 h-3 mr-1" /> Save Current
                        </Button>
                      </div>
                      <div className="max-h-64 overflow-y-auto p-2 space-y-4">
                        {savedReports.length === 0 ? (
                          <div className="text-xs text-muted-foreground text-center py-4">No saved reports yet.</div>
                        ) : (
                          <>
                            {['PERSONAL', 'SHARED'].map(vis => {
                              const reps = savedReports.filter(r => r.visibility === vis);
                              if (reps.length === 0) return null;
                              return (
                                <div key={vis}>
                                  <h4 className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-2 px-2">{vis} REPORTS</h4>
                                  <div className="space-y-1">
                                    {reps.map(r => (
                                      <div key={r.id} onClick={() => applyReport(r)} className="flex items-center justify-between p-2 hover:bg-muted/50 rounded-sm cursor-pointer group">
                                        <div className="flex flex-col gap-0.5">
                                          <span className="text-sm font-medium text-foreground">{r.name}</span>
                                          <span className="text-[10px] text-muted-foreground">by {r.creator?.display_name || 'Unknown'}</span>
                                        </div>
                                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 text-error hover:text-error hover:bg-error/10" onClick={(e) => deleteReport(e, r.id)}>
                                          <Trash2 className="w-3.5 h-3.5" />
                                        </Button>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              );
                            })}
                          </>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="p-4 space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold">Save New Report</span>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setIsSavingReport(false)}><X className="w-4 h-4" /></Button>
                      </div>
                      <div className="space-y-3">
                        <div className="space-y-1.5">
                          <Label htmlFor="report-name" className="text-xs">Report Name</Label>
                          <Input id="report-name" placeholder="e.g. Q3 Inbound Success" value={reportName} onChange={e => setReportName(e.target.value)} className="h-8 text-sm" />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">Visibility</Label>
                          <div className="flex gap-2">
                            <label className="flex items-center gap-1.5 cursor-pointer">
                              <input type="radio" name="visibility" checked={reportVisibility === 'PERSONAL'} onChange={() => setReportVisibility('PERSONAL')} className="text-primary focus:ring-primary h-3.5 w-3.5" />
                              <span className="text-xs text-foreground">Personal</span>
                            </label>
                            <label className="flex items-center gap-1.5 cursor-pointer">
                              <input type="radio" name="visibility" checked={reportVisibility === 'SHARED'} onChange={() => setReportVisibility('SHARED')} className="text-primary focus:ring-primary h-3.5 w-3.5" />
                              <span className="text-xs text-foreground">Shared (Workspace)</span>
                            </label>
                          </div>
                        </div>
                        <Button className="w-full h-8 text-xs" onClick={handleSaveReport}>Save Report</Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          <Button variant="outline" size="sm" onClick={fetchReporting} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button variant="outline" size="sm" className="md:hidden" onClick={() => setShowFilters(!showFilters)}>
            <Filter className="h-4 w-4 mr-2" />
            Filters
          </Button>
        </div>
      </div>

      <Card className={`bg-muted/30 ${showFilters ? 'block' : 'hidden md:block'}`}>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <div className="space-y-1">
              <Label className="text-xs">Start Date</Label>
              <Input type="date" value={draftFilters.startDate} onChange={(e) => setDraftFilters({...draftFilters, startDate: e.target.value})} className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">End Date</Label>
              <Input type="date" value={draftFilters.endDate} onChange={(e) => setDraftFilters({...draftFilters, endDate: e.target.value})} className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Campaign ID</Label>
              <Input placeholder="Filter by Campaign..." value={draftFilters.campaignId} onChange={(e) => setDraftFilters({...draftFilters, campaignId: e.target.value})} className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Buyer ID</Label>
              <Input placeholder="Filter by Buyer..." value={draftFilters.buyerId} onChange={(e) => setDraftFilters({...draftFilters, buyerId: e.target.value})} className="h-8 text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-4">
            <div className="space-y-1">
              <Label className="text-xs">Tracking Number</Label>
              <Input placeholder="+1..." value={draftFilters.trackingNumber} onChange={(e) => setDraftFilters({...draftFilters, trackingNumber: e.target.value})} className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Caller Number</Label>
              <Input placeholder="+1..." value={draftFilters.callerNumber} onChange={(e) => setDraftFilters({...draftFilters, callerNumber: e.target.value})} className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Status</Label>
              <select 
                value={draftFilters.status} 
                onChange={(e) => setDraftFilters({...draftFilters, status: e.target.value})}
                className="flex h-8 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">All States</option>
                <option value="COMPLETED">Completed</option>
                <option value="NO_ANSWER">Missed/No Answer</option>
                <option value="FAILED">Failed</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Total Call Duration: Min (s)</Label>
              <Input type="number" placeholder="0" value={draftFilters.minDuration} onChange={(e) => setDraftFilters({...draftFilters, minDuration: e.target.value})} className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Total Call Duration: Max (s)</Label>
              <Input type="number" placeholder="3600" value={draftFilters.maxDuration} onChange={(e) => setDraftFilters({...draftFilters, maxDuration: e.target.value})} className="h-8 text-sm" />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={resetFilters}>
              <RotateCcw className="h-4 w-4 mr-2" /> Reset
            </Button>
            <Button size="sm" onClick={applyFilters}>
              <Search className="h-4 w-4 mr-2" /> Apply Filters
            </Button>
          </div>
        </CardContent>
      </Card>
      
      {activeChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground mr-1">Active Filters:</span>
          {activeChips.map(chip => (
            <Badge key={chip.key} variant="outline" className="px-2 py-1 text-xs flex items-center gap-1">
              {chip.label}
              <button onClick={() => removeFilter(chip.key)} className="ml-1 hover:text-foreground text-muted-foreground">
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          <Button variant="ghost" size="sm" onClick={resetFilters} className="text-xs h-6 px-2 text-muted-foreground">
            Clear all
          </Button>
        </div>
      )}

      {error ? (
        <Card className="border-red-200 bg-red-50/50">
          <CardContent className="p-8 text-center flex flex-col items-center justify-center">
            <AlertCircle className="h-10 w-10 text-red-500 mb-4" />
            <p className="text-lg font-semibold text-red-900">Unable to load reporting data</p>
            <p className="text-sm text-red-700 mt-1 mb-4">{error}</p>
            <Button variant="outline" onClick={fetchReporting}>Try again</Button>
          </CardContent>
        </Card>
      ) : loading ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Skeleton className="h-[350px] col-span-2 rounded-xl" />
            <Skeleton className="h-[350px] rounded-xl" />
          </div>
          <Skeleton className="h-[400px] rounded-xl" />
        </div>
      ) : !metrics ? (
        <EmptyState title="No matching calls" description="Try adjusting your filters or clearing them." />
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center gap-2 text-muted-foreground mb-2">
                  <PhoneCall className="h-4 w-4" />
                  <span className="text-sm font-medium">Total Calls</span>
                </div>
                <div className="text-3xl font-bold text-foreground">{metrics.total.toLocaleString()}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center gap-2 text-muted-foreground mb-2">
                  <PhoneIncoming className="h-4 w-4 text-emerald-600" />
                  <span className="text-sm font-medium">Answered</span>
                </div>
                <div className="text-3xl font-bold text-foreground">{metrics.answered.toLocaleString()}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center gap-2 text-muted-foreground mb-2">
                  <PhoneMissed className="h-4 w-4 text-orange-500" />
                  <span className="text-sm font-medium">Missed</span>
                </div>
                <div className="text-3xl font-bold text-foreground">{metrics.missed.toLocaleString()}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center gap-2 text-muted-foreground mb-2">
                  <PhoneOff className="h-4 w-4 text-red-500" />
                  <span className="text-sm font-medium">Failed</span>
                </div>
                <div className="text-3xl font-bold text-foreground">{metrics.failed.toLocaleString()}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center gap-2 text-muted-foreground mb-2">
                  <Clock className="h-4 w-4 text-blue-500" />
                  <span className="text-sm font-medium">ACL</span>
                </div>
                <div className="text-3xl font-bold text-foreground">{formatDurationHms(metrics.aclSecs)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center gap-2 text-muted-foreground mb-2">
                  <BarChart3 className="h-4 w-4 text-indigo-500" />
                  <span className="text-sm font-medium">TCL</span>
                </div>
                <div className="text-3xl font-bold text-foreground">{formatDurationHms(metrics.tclSecs)}</div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="col-span-1 lg:col-span-2 flex flex-col">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div>
                  <CardTitle className="text-base font-semibold">Call Volume</CardTitle>
                </div>
                <select 
                  value={bucket} 
                  onChange={(e) => handleBucketChange(e.target.value)}
                  className="h-8 rounded-md border border-input bg-transparent px-2 py-1 text-xs shadow-sm"
                >
                  <option value="hour">Hourly</option>
                  <option value="day">Daily</option>
                  <option value="week">Weekly</option>
                </select>
              </CardHeader>
              <CardContent className="flex-1 min-h-[300px]">
                {!metrics.buckets || metrics.buckets.length === 0 ? (
                  <div className="h-full w-full flex items-center justify-center text-sm text-muted-foreground">
                    No time-series data available.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={metrics.buckets} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                      <XAxis 
                        dataKey="time" 
                        tickFormatter={(t) => {
                          const d = new Date(t);
                          if (bucket === 'hour') return d.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
                          return d.toLocaleDateString([], {month: 'short', day: 'numeric'});
                        }}
                        tick={{fontSize: 12}}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis tick={{fontSize: 12}} axisLine={false} tickLine={false} />
                      <RechartsTooltip 
                        labelFormatter={(t: any) => new Date(t).toLocaleString()}
                        contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}}
                      />
                      <Legend iconType="circle" wrapperStyle={{fontSize: '12px', paddingTop: '10px'}} />
                      <Line type="monotone" dataKey="total" name="Total Calls" stroke="#3b82f6" strokeWidth={2} dot={false} activeDot={{r: 4}} />
                      <Line type="monotone" dataKey="answered" name="Answered" stroke="#10b981" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card className="flex flex-col">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold">Outcome Distribution</CardTitle>
              </CardHeader>
              <CardContent className="flex-1 min-h-[300px] flex items-center justify-center">
                {outcomeData.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No call outcomes.</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={outcomeData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={90}
                        paddingAngle={2}
                        dataKey="value"
                      >
                        {outcomeData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <RechartsTooltip 
                        formatter={(val: any) => [Number(val).toLocaleString(), 'Calls']}
                        contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}}
                      />
                      <Legend iconType="circle" layout="vertical" verticalAlign="bottom" align="center" wrapperStyle={{fontSize: '12px'}} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base font-semibold">Performance Grouping</CardTitle>
              <select 
                value={groupBy} 
                onChange={(e) => handleGroupChange(e.target.value)}
                className="h-8 rounded-md border border-input bg-transparent px-2 py-1 text-xs shadow-sm"
              >
                <option value="Campaign">Campaign</option>
                <option value="Buyer">Buyer</option>
                <option value="Tracking Number">Tracking Number</option>
                <option value="Status">Status</option>
              </select>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              {groupBy === 'Campaign' && (!metrics.campaigns || Object.keys(metrics.campaigns).length === 0 ? (
                <div className="p-8 text-center text-muted-foreground text-sm">No campaign data.</div>
              ) : (
                <Table>
                  <TableHeader className="bg-muted/50 whitespace-nowrap">
                    <TableRow>
                      {visibleColumns.map(col => (
                        <TableHead 
                          key={col.id} 
                          className={col.id === 'actions' || col.id === 'talkDuration' || col.id === 'totalDuration' || col.id === 'attempts' ? 'text-right' : col.id === 'recording' ? 'text-center' : ''}
                        >
                          {col.label}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {calls.map((call: any) => {
                      const answeredAttempt = call.attempts?.find((a: any) => a.state === 'COMPLETED' || a.state === 'ANSWERED' || a.state === 'CONNECTED');
                      const finalDestination = call.buyer?.name || answeredAttempt?.buyer?.name || 'No successful destination';
                      const recordingAvailable = call.recordings && call.recordings.length > 0;
                      
                      return (
                        <TableRow key={call.id}>
                          <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                            {new Date(call.created_at).toLocaleString()}
                          </TableCell>
                          <TableCell className="font-mono text-xs">{call.from_number}</TableCell>
                          <TableCell className="font-mono text-xs">{call.to_number}</TableCell>
                          <TableCell className="text-xs whitespace-nowrap">{call.campaign?.name || '—'}</TableCell>
                          <TableCell className="text-xs whitespace-nowrap">{finalDestination}</TableCell>
                          <TableCell>
                            <Badge variant={call.state === "COMPLETED" ? "success" : "warning"} className="text-[10px]">
                              {call.state}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {call.talkDurationSecs != null ? formatDurationHms(call.talkDurationSecs) : '—'}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {call.totalDurationSecs != null ? formatDurationHms(call.totalDurationSecs) : '—'}
                          </TableCell>
                          <TableCell className="text-right text-xs">
                            {call.attempts?.length || 0} attempts
                          </TableCell>
                          <TableCell className="text-center text-xs">
                            {recordingAvailable ? 'Available' : '—'}
                          </TableCell>
                          <TableCell className="text-right">
                            <Link href={`/protected/calls/${call.id}?workspace=${params.workspaceId}&returnTo=reporting&${searchParams.toString()}`}><Button variant="outline" size="sm">View</Button></Link>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              ))}

              {groupBy === 'Buyer' && (!metrics.buyers || Object.keys(metrics.buyers).length === 0 ? (
                <div className="p-8 text-center text-muted-foreground text-sm">No buyer data.</div>
              ) : (
                <Table>
                  <TableHeader className="bg-muted/50 whitespace-nowrap">
                    <TableRow>
                      <TableHead>Buyer (Legs)</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Answered</TableHead>
                      <TableHead className="text-right">Failed</TableHead>
                      <TableHead className="text-right">TCL</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.values(metrics.buyers as Record<string, any>).map((stats: any) => (
                      <TableRow key={stats.id}>
                        <TableCell className="font-medium whitespace-nowrap">{stats.name || 'Unknown Buyer'}</TableCell>
                        <TableCell className="text-right">{stats.total.toLocaleString()}</TableCell>
                        <TableCell className="text-right font-medium text-emerald-600">{stats.answered.toLocaleString()}</TableCell>
                        <TableCell className="text-right">{stats.failed.toLocaleString()}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{formatDurationHms(stats.tclSecs)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ))}

              {groupBy === 'Tracking Number' && (!metrics.trackingNumbers || Object.keys(metrics.trackingNumbers).length === 0 ? (
                <div className="p-8 text-center text-muted-foreground text-sm">No tracking number data.</div>
              ) : (
                <Table>
                  <TableHeader className="bg-muted/50 whitespace-nowrap">
                    <TableRow>
                      <TableHead>Tracking Number</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Answered</TableHead>
                      <TableHead className="text-right">ACL</TableHead>
                      <TableHead className="text-right">TCL</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.values(metrics.trackingNumbers as Record<string, any>).map((stats: any, index: number) => (
                      <TableRow key={index}>
                        <TableCell className="font-medium font-mono text-xs whitespace-nowrap">{stats.tracking_number || 'Unknown'}</TableCell>
                        <TableCell className="text-right">{stats.total.toLocaleString()}</TableCell>
                        <TableCell className="text-right font-medium text-emerald-600">{stats.answered.toLocaleString()}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{formatDurationHms(stats.aclSecs)}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{formatDurationHms(stats.tclSecs)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ))}

              {groupBy === 'Status' && (
                <Table>
                  <TableHeader className="bg-muted/50 whitespace-nowrap">
                    <TableRow>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Calls</TableHead>
                      <TableHead className="text-right">% of Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {outcomeData.map((d: any, index: number) => (
                      <TableRow key={index}>
                        <TableCell className="font-medium whitespace-nowrap flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full" style={{backgroundColor: d.color}}></div>
                          {d.name}
                        </TableCell>
                        <TableCell className="text-right">{d.value.toLocaleString()}</TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {metrics.total > 0 ? Math.round((d.value / metrics.total) * 100) : 0}%
                        </TableCell>
                      </TableRow>
                    ))}
                    {outcomeData.length === 0 && (
                      <TableRow><TableCell colSpan={3} className="text-center p-8 text-muted-foreground">No outcomes.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-base font-semibold">Detailed Calls</CardTitle>
              <div className="relative columns-dropdown-container">
                <Button variant="outline" size="sm" onClick={() => setShowColumnMenu(!showColumnMenu)}>
                  <Settings2 className="w-4 h-4 mr-2" />
                  Columns
                </Button>
                {showColumnMenu && (
                  <div className="absolute right-0 mt-2 w-64 bg-surface border border-border rounded-md shadow-lg z-50 p-2">
                    <div className="flex items-center justify-between pb-2 mb-2 border-b border-border">
                      <span className="text-sm font-semibold">Customize Columns</span>
                      <Button variant="ghost" size="sm" onClick={resetColumns} className="h-6 px-2 text-xs">Reset</Button>
                    </div>
                    <div className="max-h-64 overflow-y-auto space-y-1">
                      {columns.map((col, index) => (
                        <div key={col.id} className="flex items-center justify-between py-1 px-2 hover:bg-muted/50 rounded-sm">
                          <label className="flex items-center gap-2 cursor-pointer flex-1">
                            <input 
                              type="checkbox" 
                              checked={col.visible} 
                              disabled={col.locked}
                              onChange={() => toggleColumn(index)} 
                              className="rounded border-border text-primary focus:ring-primary"
                            />
                            <span className={`text-sm ${col.locked ? 'text-muted-foreground' : ''}`}>{col.label}</span>
                          </label>
                          <div className="flex flex-col gap-0.5 ml-2">
                            <button 
                              disabled={index === 0} 
                              onClick={() => moveColumn(index, -1)}
                              className="text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed h-4 w-4 flex items-center justify-center"
                              aria-label={`Move ${col.label} up`}
                            >
                              <ChevronUp className="w-3 h-3" />
                            </button>
                            <button 
                              disabled={index === columns.length - 1} 
                              onClick={() => moveColumn(index, 1)}
                              className="text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed h-4 w-4 flex items-center justify-center"
                              aria-label={`Move ${col.label} down`}
                            >
                              <ChevronDown className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              {calls.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground text-sm">No calls found.</div>
              ) : (
                <Table>
                  <TableHeader className="bg-muted/50 whitespace-nowrap">
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Caller</TableHead>
                      <TableHead>Tracking Number</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Duration</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {calls.map((call: any) => (
                      <TableRow key={call.id}>
                        <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                          {new Date(call.created_at).toLocaleString()}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{call.from_number}</TableCell>
                        <TableCell className="font-mono text-xs">{call.to_number}</TableCell>
                        <TableCell>
                          <Badge variant={call.state === "COMPLETED" ? "default" : "warning"} className="text-[10px]">
                            {call.state}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {formatDurationHms(call.duration_secs)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
            {callsTotal > limit && (
              <div className="flex items-center justify-between px-4 py-3 border-t">
                <span className="text-sm text-muted-foreground">
                  Showing {((page - 1) * limit) + 1} to {Math.min(page * limit, callsTotal)} of {callsTotal} calls
                </span>
                <div className="flex gap-1">
                  <Button variant="outline" size="sm" onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1}>
                    Previous
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setPage(page + 1)} disabled={page * limit >= callsTotal}>
                    Next
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
