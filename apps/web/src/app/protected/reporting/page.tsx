'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { apiFetch, apiDownload } from '@/lib/api';
import { InlineRecordingPlayer } from '@/components/ui/recording-player';
import { formatCallerDisplay } from '@/lib/phone';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import { CallsByDayChart } from './calls-by-day-chart';
import { OutcomeDistributionChart } from './outcome-distribution-chart';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend, LineChart, Line, PieChart, Pie, Cell 
} from 'recharts';
import { 
  PhoneCall, PhoneIncoming, PhoneMissed, PhoneOff, Clock, Search, RotateCcw, AlertCircle, RefreshCw, BarChart3, Filter, X, Settings2, ChevronUp, ChevronDown, Bookmark, Save, Trash2, Edit2, Download, Loader2, Percent, Timer, Radio, DollarSign, TrendingUp, CheckCircle, Copy, AlertTriangle
} from 'lucide-react';

function formatDurationHms(seconds: number | null | undefined, fallback: string = '00:00'): string {
  if (seconds === null || seconds === undefined || isNaN(seconds)) return fallback;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function formatPercent(value: number): string {
  if (isNaN(value) || !isFinite(value)) return '0%';
  const rounded = Number(value.toFixed(1));
  return `${rounded}%`;
}

function formatCurrency(amount: number | null | undefined, currency: string = 'USD'): string {
  if (amount === null || amount === undefined || isNaN(amount)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(amount);
}

export function isValidPhoneNumber(num: any): boolean {
  if (num === null || num === undefined) return false;
  if (typeof num !== 'string' && typeof num !== 'number') return false;
  const str = String(num).trim();
  if (!str) return false;

  const digitsOnly = str.replace(/\D/g, '');
  if (digitsOnly.length < 7 || digitsOnly.length > 15) {
    return false;
  }

  const phonePattern = /^\+?[0-9\s\-().]{7,20}$/;
  return phonePattern.test(str);
}

export const getStatusBadgeVariant = (state: string) => {
  switch (state?.toUpperCase()) {
    case 'COMPLETED':
    case 'ANSWERED':
      return 'success';
    case 'NO_ANSWER':
    case 'FAILED':
    case 'CANCELED':
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

export function formatPhoneNumber(num: any): string {
  const str = String(num).trim();
  if (str.startsWith('+')) {
    const digits = str.substring(1).replace(/\D/g, '');
    return `+${digits}`;
  }
  const digits = str.replace(/\D/g, '');
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  return `+${digits}`;
}

export function getFinalDestinationDisplay(call: any): string {
  if (!call) return '—';

  const stateStr = (call.state || '').toString().toUpperCase();
  const attempts: any[] = Array.isArray(call.attempts) ? call.attempts : [];
  
  const successfulAttempt = attempts.find((a: any) => {
    const state = (a?.state || '').toString().toUpperCase();
    return state === 'COMPLETED' || state === 'ANSWERED' || state === 'CONNECTED' || Boolean(a?.answered_at);
  });

  if (successfulAttempt) {
    const rawNum = 
      successfulAttempt?.destination_number ||
      successfulAttempt?.destination_ref?.destination_number ||
      successfulAttempt?.buyer?.destination_number ||
      call.destination_number ||
      call.buyer?.destination_number;

    if (isValidPhoneNumber(rawNum)) {
      return formatPhoneNumber(rawNum);
    }
    
    return 'Destination unavailable';
  }

  const isConnected = ['COMPLETED', 'CONNECTED', 'ANSWERED'].includes(stateStr) || Boolean(call.answered_at);
  const rawDirectNum = call.destination_number || call.buyer?.destination_number;

  if (isConnected && rawDirectNum) {
    if (isValidPhoneNumber(rawDirectNum)) {
      return formatPhoneNumber(rawDirectNum);
    }
    return 'Destination unavailable';
  }

  // If the call or an attempt is actively in progress, destination is pending
  const isCallInProgress = ['ROUTING', 'RINGING', 'INITIATED', 'DIALING'].includes(stateStr);
  const hasInProgressAttempt = attempts.some((a: any) => {
    const aState = (a?.state || '').toString().toUpperCase();
    return ['RINGING', 'INITIATED', 'DIALING'].includes(aState);
  });
  if (isCallInProgress || hasInProgressAttempt) {
    return '—';
  }

  const hasFailedAttempts = attempts.length > 0 && attempts.every((a: any) => {
    const state = (a?.state || '').toString().toUpperCase();
    return ['FAILED', 'NO_ANSWER', 'CANCELED', 'BUSY', 'REJECTED'].includes(state);
  });

  const isFailedCall = ['FAILED', 'NO_ANSWER', 'BUSY', 'CANCELED', 'MISSED', 'ABANDONED', 'BLOCKED', 'VOICEMAIL', 'COMPLETED'].includes(
    stateStr
  );

  if (hasFailedAttempts || isFailedCall) {
    return 'No successful destination';
  }

  return '—';
}


export interface ReportingMetrics {
  total: number;
  answered: number;
  missed: number;
  failed: number;
  blocked?: number;
  avgDuration: number | null;
  tclSecs: number | null;
  aclSecs: number | null;
  revenue?: number;
  payout?: number;
  profit?: number;
  cost?: number;
  converted?: number;
  qualified?: number;
  duplicate?: number;
  conversionRate?: number;
  commercialCalls?: number;
  currency?: string;
  campaigns?: Record<string, any>;
  buyers?: Record<string, any>;
  trackingNumbers?: Record<string, any>;
  buckets?: Array<{
    bucket: string;
    total: number;
    answered: number;
    missed: number;
    failed: number;
    revenue?: number;
    payout?: number;
    profit?: number;
    cost?: number;
    converted?: number;
    qualified?: number;
    duplicate?: number;
    conversionRate?: number;
    commercialCalls?: number;
  }>;
}

export interface LiveCallsResponse {
  liveCalls: number;
}


type ColumnId = 
  | 'time' 
  | 'caller' 
  | 'trackingNumber' 
  | 'campaign' 
  | 'finalDestination' 
  | 'status' 
  | 'talkDuration' 
  | 'totalDuration' 
  | 'revenue'
  | 'payout'
  | 'profit'
  | 'commercial'
  | 'attempts' 
  | 'recording' 
  | 'actions';

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
  { id: 'revenue', label: 'Revenue', visible: true, order: 8 },
  { id: 'payout', label: 'Payout', visible: true, order: 9 },
  { id: 'profit', label: 'Profit', visible: true, order: 10 },
  { id: 'commercial', label: 'Commercial', visible: true, order: 11 },
  { id: 'attempts', label: 'Attempts', visible: true, order: 12 },
  { id: 'recording', label: 'Recording', visible: true, order: 13 },
  { id: 'actions', label: 'Actions', visible: true, order: 14, locked: true },
];

export default function ReportingDashboard() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamsString = searchParams.toString();

  const workspaceId = searchParams.get('workspace');
  const currentWorkspaceIdRef = useRef(workspaceId);
  const reportingGenRef = useRef(0);
  const workspaceCampaignsRef = useRef<{ id: string; name: string }[]>([]);

  useEffect(() => {
    if (workspaceId && typeof window !== 'undefined') {
      sessionStorage.setItem('callflow.active_workspace_id', workspaceId);
    }
  }, [workspaceId]);

  // Read Canonical State from URL
  const startDate = searchParams.get('startDate') || '';
  const endDate = searchParams.get('endDate') || '';
  const campaignId = searchParams.get('campaignId') || '';
  const buyerId = searchParams.get('buyerId') || '';
  const vendorId = searchParams.get('vendorId') || '';
  const trackingNumber = searchParams.get('trackingNumber') || '';
  const callerNumber = searchParams.get('callerNumber') || '';
  const status = searchParams.get('status') || '';
  const durationType = searchParams.get('durationType') || 'total';
  const minDuration = searchParams.get('minDuration') || '';
  const maxDuration = searchParams.get('maxDuration') || '';
  const bucket = searchParams.get('bucket') || 'day';
  const groupBy = searchParams.get('groupBy') || 'Campaign';
  const page = parseInt(searchParams.get('page') || '1', 10);
  
  // Local UI State for Draft Filters
  const [draftFilters, setDraftFilters] = useState({
    startDate, endDate, campaignId, buyerId, vendorId, trackingNumber, callerNumber, status, durationType, minDuration, maxDuration
  });
  
  // Sync URL changes back to draft filters (e.g. back button or chip removal)
  useEffect(() => {
    setDraftFilters({ startDate, endDate, campaignId, buyerId, vendorId, trackingNumber, callerNumber, status, durationType, minDuration, maxDuration });
  }, [startDate, endDate, campaignId, buyerId, vendorId, trackingNumber, callerNumber, status, durationType, minDuration, maxDuration]);

  const [metrics, setMetrics] = useState<ReportingMetrics | null>(null);
  const [liveCalls, setLiveCalls] = useState<number>(0);
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
    if (!workspaceId) return;
    const targetWsId = workspaceId;
    try {
      const data = await apiFetch(`/workspaces/${workspaceId}/reports`);
      if (targetWsId === currentWorkspaceIdRef.current) {
        setSavedReports(data || []);
      }
    } catch (e) {
      console.error(e);
    }
  }, [workspaceId]);

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
      await apiFetch(`/workspaces/${workspaceId}/reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: reportName, visibility: reportVisibility, configuration: config })
      });
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
      if (workspaceId) q.set('workspace', workspaceId);
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
      await apiFetch(`/workspaces/${workspaceId}/reports/${id}`, { method: 'DELETE' });
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
    if (!workspaceId) return;
    const key = `callflow.reporting.columns.${workspaceId}`;
    try {
      const saved = localStorage.getItem(key);
            if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          const validIds = new Set(DEFAULT_COLUMNS.map(c => c.id));
          const filtered = parsed.filter((p: any) => p && typeof p === 'object' && validIds.has(p.id));
          
          let maxSavedOrder = -1;
          const savedMap = new Map<string, { visible: boolean; order: number }>();
          for (const item of filtered) {
            const order = typeof item.order === 'number' ? item.order : 0;
            savedMap.set(item.id, {
              visible: typeof item.visible === 'boolean' ? item.visible : true,
              order,
            });
            if (order > maxSavedOrder) {
              maxSavedOrder = order;
            }
          }

          const newCols = DEFAULT_COLUMNS.map(def => {
            const found = savedMap.get(def.id);
            if (found) {
              return { ...def, visible: def.locked ? true : found.visible, order: found.order };
            }
            maxSavedOrder += 1;
            return { ...def, order: maxSavedOrder };
          }).sort((a, b) => a.order - b.order);
          
          newCols.forEach((c, i) => { c.order = i; });
          setColumns(newCols);
        }
      }
    } catch (e) {
      console.error("Malformed localStorage columns", e);
    }
  }, [workspaceId]);

  const saveColumns = (newCols: ColumnDef[]) => {
    setColumns(newCols);
    if (!workspaceId) return;
    const key = `callflow.reporting.columns.${workspaceId}`;
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

  const [isVendorWorkspace, setIsVendorWorkspace] = useState(false);
  const [isBuyerWorkspace, setIsBuyerWorkspace] = useState(false);
  const [isOwnerOrAdmin, setIsOwnerOrAdmin] = useState(false);

  // Dropdown data options
  const [phoneNumbers, setPhoneNumbers] = useState<{ id: string; phone_number: string }[]>([]);
  const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>([]);
  const [buyers, setBuyers] = useState<{ id: string; name: string }[]>([]);
  const [vendors, setVendors] = useState<{ id: string; name: string }[]>([]);
  const [loadingDropdowns, setLoadingDropdowns] = useState(false);
  const [dropdownError, setDropdownError] = useState<string | null>(null);

  useEffect(() => {
    async function checkRole() {
      if (!workspaceId) return;
      const targetWsId = workspaceId;
      try {
        const workspaces = await apiFetch('/workspaces');
        if (targetWsId !== currentWorkspaceIdRef.current) return;
        const currentWs = Array.isArray(workspaces)
          ? workspaces.find((w: any) => w.id === targetWsId)
          : null;
        if (currentWs) {
          setIsVendorWorkspace(currentWs.participant_type === 'VENDOR');
          setIsBuyerWorkspace(currentWs.participant_type === 'BUYER');
          setIsOwnerOrAdmin(currentWs.role === 'OWNER' || currentWs.role === 'ADMIN');
        }
      } catch {
        // Continue if workspace query fails
      }
    }
    checkRole();
  }, [workspaceId]);

  useEffect(() => {
    async function loadDropdowns() {
      if (!workspaceId) return;
      const targetWsId = workspaceId;
      setLoadingDropdowns(true);
      setDropdownError(null);
      try {
        const [phoneData, campData, buyerData, vendorData] = await Promise.all([
          apiFetch(`/workspaces/${targetWsId}/phone-numbers`).catch(() => []),
          apiFetch(`/workspaces/${targetWsId}/campaigns`).catch(() => []),
          apiFetch(`/workspaces/${targetWsId}/buyers`).catch(() => []),
          apiFetch(`/workspaces/${targetWsId}/vendors`).catch(() => []),
        ]);
        if (targetWsId !== currentWorkspaceIdRef.current) return;
        const phones = Array.isArray(phoneData) ? phoneData : phoneData?.items || [];
        setPhoneNumbers(phones);
        let camps: { id: string; name: string }[] = Array.isArray(campData) ? campData : campData?.items || [];
        if (camps.length === 0 && phones.length > 0) {
          const campMap = new Map<string, string>();
          for (const p of phones) {
            if (p.campaign?.id && p.campaign?.name) {
              campMap.set(p.campaign.id, p.campaign.name);
            }
          }
          if (campMap.size > 0) {
            camps = Array.from(campMap.entries()).map(([id, name]) => ({ id, name }));
          }
        }
        workspaceCampaignsRef.current = camps;
        setCampaigns(camps);
        setBuyers(Array.isArray(buyerData) ? buyerData : buyerData?.items || []);
        setVendors(Array.isArray(vendorData) ? vendorData : vendorData?.items || []);
      } catch (err: any) {
        if (targetWsId === currentWorkspaceIdRef.current) {
          setDropdownError(err?.message || 'Failed to load filter options');
        }
      } finally {
        if (targetWsId === currentWorkspaceIdRef.current) {
          setLoadingDropdowns(false);
        }
      }
    }
    loadDropdowns();
  }, [workspaceId]);

  useEffect(() => {
    currentWorkspaceIdRef.current = workspaceId;
    reportingGenRef.current++;
    workspaceCampaignsRef.current = [];
    setMetrics(null);
    setCalls([]);
    setCallsTotal(0);
    setCampaigns([]);
    setBuyers([]);
    setVendors([]);
    setPhoneNumbers([]);
    setSavedReports([]);
    setError(null);
  }, [workspaceId]);

  const hasRevenue = metrics?.revenue !== undefined;
  const hasPayout = metrics?.payout !== undefined;
  const hasProfit = metrics?.profit !== undefined;
  const hasCost = metrics?.cost !== undefined;
  const isVendor = isVendorWorkspace || (!hasRevenue && hasPayout && !hasProfit);
  const isBuyer = isBuyerWorkspace;

  useEffect(() => {
    if (isVendor && groupBy === 'Buyer') {
      const q = new URLSearchParams(searchParamsString);
      q.set('groupBy', 'Campaign');
      if (workspaceId) {
        q.set('workspace', workspaceId);
      }
      router.replace(`${pathname}?${q.toString()}`);
    }
  }, [isVendor, groupBy, pathname, router, searchParamsString, workspaceId]);

  const allowedColumnIds = useMemo(() => {
    const ids = new Set<ColumnId>([
      'time', 'caller', 'trackingNumber', 'campaign', 'status', 
      'talkDuration', 'totalDuration', 'commercial', 'attempts', 'recording', 'actions'
    ]);
    if (!isVendor) ids.add('finalDestination');
    if (hasRevenue) ids.add('revenue');
    if (hasPayout) ids.add('payout');
    if (hasProfit) ids.add('profit');
    return ids;
  }, [hasRevenue, hasPayout, hasProfit, isVendor]);

  const displayedColumns = useMemo(() => {
    return columns.filter(c => allowedColumnIds.has(c.id));
  }, [columns, allowedColumnIds]);

  const visibleColumns = useMemo(() => {
    return displayedColumns.filter(c => c.visible);
  }, [displayedColumns]);

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


  const [showExportMenu, setShowExportMenu] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    const closeMenu = (e: MouseEvent) => {
      if (showExportMenu && !(e.target as Element).closest('.export-dropdown-container')) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener('mousedown', closeMenu);
    return () => document.removeEventListener('mousedown', closeMenu);
  }, [showExportMenu]);

  const handleExport = async (format: 'csv' | 'xlsx') => {
    setIsExporting(true);
    setShowExportMenu(false);
    try {
      const payload = {
        format,
        filters: { startDate, endDate, campaignId, buyerId, vendorId: vendorId || undefined, trackingNumber, callerNumber, status, minDurationSecs: minDuration, maxDurationSecs: maxDuration, durationType: durationType || 'talk' },
        columns
      };

      const { blob, filename: serverFilename } = await apiDownload(`/workspaces/${workspaceId}/reports/export`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      const fallbackFilename = `callflow-report-${new Date().toISOString().split('T')[0]}.${format}`;
      const filename = serverFilename || fallbackFilename;

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(err?.message || 'An unexpected error occurred during export.');
    } finally {
      setIsExporting(false);
    }
  };

  const limit = 20;

  const fetchReporting = useCallback(async () => {
    if (!workspaceId) return;
    const targetWsId = workspaceId;
    const currentGen = ++reportingGenRef.current;
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams(searchParamsString);
      if (!q.get('bucket')) q.set('bucket', bucket);
      
      // Fetch Paginated Detailed Calls
      const callsQ = new URLSearchParams(q.toString());
      if (minDuration) callsQ.set('minDurationSecs', minDuration);
      if (maxDuration) callsQ.set('maxDurationSecs', maxDuration);
      if (durationType) callsQ.set('durationType', durationType);
      if ((minDuration || maxDuration) && !callsQ.get('durationType')) {
        callsQ.set('durationType', 'total');
      }
      callsQ.set('limit', limit.toString());
      callsQ.set('offset', ((page - 1) * limit).toString());
      
      const [metricsData, callsData, liveCallsData] = await Promise.all([
        apiFetch(`/workspaces/${workspaceId}/calls/metrics?${q.toString()}`),
        apiFetch(`/workspaces/${workspaceId}/calls?${callsQ.toString()}`),
        apiFetch(`/workspaces/${workspaceId}/calls/live-calls`),
      ]);

      if (currentGen !== reportingGenRef.current || targetWsId !== currentWorkspaceIdRef.current) {
        return;
      }

      setMetrics(metricsData);
      if (metricsData?.campaigns && typeof metricsData.campaigns === 'object') {
        const baseMap = new Map(workspaceCampaignsRef.current.map(c => [c.id, c.name]));
        for (const [id, data] of Object.entries(metricsData.campaigns)) {
          if (!baseMap.has(id)) {
            baseMap.set(id, (data as any)?.name || id);
          }
        }
        setCampaigns(Array.from(baseMap.entries()).map(([id, name]) => ({ id, name })));
      }
      setCalls(callsData?.items || []);
      setCallsTotal(callsData?.total || 0);
      setLiveCalls(typeof liveCallsData?.liveCalls === 'number' ? liveCallsData.liveCalls : 0);
      
    } catch (err: any) { // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (currentGen !== reportingGenRef.current || targetWsId !== currentWorkspaceIdRef.current) {
        return;
      }
      setError(err.message || 'Unable to load reporting data');
    } finally {
      if (currentGen === reportingGenRef.current && targetWsId === currentWorkspaceIdRef.current) {
        setLoading(false);
      }
    }
  }, [workspaceId, searchParamsString, page, minDuration, maxDuration, durationType, bucket]);

  useEffect(() => {
    fetchReporting();
  }, [fetchReporting]);

  const applyFilters = (e?: React.SyntheticEvent) => {
    e?.preventDefault();
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
    const q = new URLSearchParams(searchParams.toString());
    const filterKeys = ['startDate', 'endDate', 'campaignId', 'buyerId', 'vendorId', 'trackingNumber', 'callerNumber', 'status', 'minDuration', 'maxDuration', 'durationType'];
    filterKeys.forEach((k) => q.delete(k));
    Object.entries(draftFilters).forEach(([k, v]) => { if (v) q.set(k, v); });
    q.set('bucket', bucket);
    q.set('groupBy', groupBy);
    q.set('page', '1');
    if (workspaceId) {
      q.set('workspace', workspaceId);
    }
    router.push(`${pathname}?${q.toString()}`);
  };

  const resetFilters = (e?: React.SyntheticEvent) => {
    e?.preventDefault();
    setDraftFilters({ startDate: '', endDate: '', campaignId: '', buyerId: '', vendorId: '', trackingNumber: '', callerNumber: '', status: '', durationType: 'total', minDuration: '', maxDuration: '' });
    const q = new URLSearchParams(searchParams.toString());
    const filterKeys = ['startDate', 'endDate', 'campaignId', 'buyerId', 'vendorId', 'trackingNumber', 'callerNumber', 'status', 'minDuration', 'maxDuration', 'durationType'];
    filterKeys.forEach((k) => q.delete(k));
    q.set('bucket', 'day');
    q.set('groupBy', 'Campaign');
    q.set('page', '1');
    if (workspaceId) {
      q.set('workspace', workspaceId);
    }
    router.push(`${pathname}?${q.toString()}`);
  };

  const removeFilter = (key: string) => {
    const q = new URLSearchParams(searchParams.toString());
    if (key === 'duration') {
      q.delete('minDuration');
      q.delete('maxDuration');
      q.delete('durationType');
    } else {
      q.delete(key);
    }
    q.set('page', '1');
    if (workspaceId) {
      q.set('workspace', workspaceId);
    }
    router.push(`${pathname}?${q.toString()}`);
  };

  const handleGroupChange = (newGroup: string) => {
    const q = new URLSearchParams(searchParams.toString());
    q.set('groupBy', newGroup);
    if (workspaceId) {
      q.set('workspace', workspaceId);
    }
    router.push(`${pathname}?${q.toString()}`);
  };

  const handleBucketChange = (newBucket: string) => {
    const q = new URLSearchParams(searchParams.toString());
    q.set('bucket', newBucket);
    if (workspaceId) {
      q.set('workspace', workspaceId);
    }
    router.push(`${pathname}?${q.toString()}`);
  };
  
  const setPage = (newPage: number) => {
    const q = new URLSearchParams(searchParams.toString());
    q.set('page', newPage.toString());
    if (workspaceId) {
      q.set('workspace', workspaceId);
    }
    router.push(`${pathname}?${q.toString()}`);
  };

  const activeChips = useMemo(() => {
    const chips = [];
    if (startDate) chips.push({ key: 'startDate', label: `From: ${startDate}` });
    if (endDate) chips.push({ key: 'endDate', label: `To: ${endDate}` });
    if (campaignId) {
      const camp = campaigns.find(c => c.id === campaignId);
      chips.push({ key: 'campaignId', label: `Campaign: ${camp ? camp.name : campaignId}` });
    }
    if (buyerId && !isVendor) {
      const b = buyers.find(buyer => buyer.id === buyerId);
      chips.push({ key: 'buyerId', label: `Buyer: ${b ? b.name : buyerId}` });
    }
    if (vendorId && !isVendor && !isBuyer) {
      const v = vendors.find(vendor => vendor.id === vendorId);
      chips.push({ key: 'vendorId', label: `Vendor: ${v ? v.name : vendorId}` });
    }
    if (trackingNumber) chips.push({ key: 'trackingNumber', label: `Number: ${trackingNumber}` });
    if (callerNumber) chips.push({ key: 'callerNumber', label: `Caller: ${formatCallerDisplay(callerNumber)}` });
    if (status) chips.push({ key: 'status', label: `Status: ${status}` });
    if (minDuration || maxDuration) {
      const typeLabel = durationType === 'talk' ? 'Talk' : 'Total';
      let durText = `${typeLabel} Dur:`;
      if (minDuration && maxDuration) durText += ` ${minDuration}s - ${maxDuration}s`;
      else if (minDuration) durText += ` >= ${minDuration}s`;
      else if (maxDuration) durText += ` <= ${maxDuration}s`;
      chips.push({ key: 'duration', label: durText });
    }
    return chips;
  }, [startDate, endDate, campaignId, buyerId, vendorId, trackingNumber, callerNumber, status, minDuration, maxDuration, durationType, campaigns, buyers, vendors, isVendor, isBuyer]);

  const outcomeData = metrics ? [
    { name: 'Answered', value: metrics.answered || 0, color: '#10b981' }, 
    { name: 'Missed', value: metrics.missed || 0, color: '#f97316' }, 
    { name: 'Failed', value: metrics.failed || 0, color: '#ef4444' }, 
  ].filter(d => d.value > 0) : [];

  const answerRate = metrics && metrics.total > 0
    ? (metrics.answered / metrics.total) * 100
    : 0;

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
            
            <div className="relative export-dropdown-container z-50">
              <Button variant="outline" size="sm" onClick={() => setShowExportMenu(!showExportMenu)} disabled={isExporting}>
                {isExporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
                Export ▾
              </Button>
              {showExportMenu && (
                <div className="absolute right-0 mt-2 w-40 bg-surface border border-border rounded-md shadow-lg overflow-hidden flex flex-col p-1">
                  <button className="flex items-center w-full px-3 py-2 text-sm text-left hover:bg-muted/50 rounded-sm" onClick={() => handleExport('csv')}>Export CSV</button>
                  <button className="flex items-center w-full px-3 py-2 text-sm text-left hover:bg-muted/50 rounded-sm" onClick={() => handleExport('xlsx')}>Export XLSX</button>
                </div>
              )}
            </div>

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
                        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setIsSavingReport(true)}>
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
          {dropdownError && (
            <div className="mb-4 text-xs text-red-500 flex items-center gap-1.5 bg-red-500/10 p-2 rounded">
              <AlertCircle className="w-3.5 h-3.5" />
              <span>{dropdownError}</span>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <div className="space-y-1">
              <Label htmlFor="startDate" className="text-xs font-medium">Start Date</Label>
              <Input id="startDate" type="date" value={draftFilters.startDate} onChange={(e) => setDraftFilters({...draftFilters, startDate: e.target.value})} className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="endDate" className="text-xs font-medium">End Date</Label>
              <Input id="endDate" type="date" value={draftFilters.endDate} onChange={(e) => setDraftFilters({...draftFilters, endDate: e.target.value})} className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="campaignId" className="text-xs font-medium">Campaign</Label>
              <select
                id="campaignId"
                value={draftFilters.campaignId}
                onChange={(e) => setDraftFilters({...draftFilters, campaignId: e.target.value})}
                disabled={loadingDropdowns}
                className="flex h-8 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">{loadingDropdowns ? 'Loading campaigns...' : 'All Campaigns'}</option>
                {campaigns.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            {!isVendor && (
              <div className="space-y-1">
                <Label htmlFor="buyerId" className="text-xs font-medium">Buyer</Label>
                <select
                  id="buyerId"
                  value={draftFilters.buyerId}
                  onChange={(e) => setDraftFilters({...draftFilters, buyerId: e.target.value})}
                  disabled={loadingDropdowns}
                  className="flex h-8 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="">{loadingDropdowns ? 'Loading buyers...' : 'All Buyers'}</option>
                  {buyers.map(b => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
            )}
            {!isVendor && !isBuyer && (
              <div className="space-y-1">
                <Label htmlFor="vendorId" className="text-xs font-medium">Vendor</Label>
                <select
                  id="vendorId"
                  value={draftFilters.vendorId}
                  onChange={(e) => setDraftFilters({...draftFilters, vendorId: e.target.value})}
                  disabled={loadingDropdowns}
                  className="flex h-8 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="">{loadingDropdowns ? 'Loading vendors...' : 'All Vendors'}</option>
                  {vendors.map(v => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-4">
            <div className="space-y-1">
              <Label htmlFor="trackingNumber" className="text-xs font-medium">Tracking Number</Label>
              <select
                id="trackingNumber"
                value={draftFilters.trackingNumber}
                onChange={(e) => setDraftFilters({...draftFilters, trackingNumber: e.target.value})}
                disabled={loadingDropdowns}
                className="flex h-8 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">{loadingDropdowns ? 'Loading numbers...' : 'All Numbers'}</option>
                {phoneNumbers.map(n => (
                  <option key={n.id} value={n.phone_number}>{n.phone_number}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="callerNumber" className="text-xs font-medium">Caller Number</Label>
              <Input
                id="callerNumber"
                placeholder="+1..."
                value={draftFilters.callerNumber}
                onChange={(e) => setDraftFilters({...draftFilters, callerNumber: e.target.value})}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="status" className="text-xs font-medium">Status</Label>
              <select 
                id="status"
                value={draftFilters.status} 
                onChange={(e) => setDraftFilters({...draftFilters, status: e.target.value})}
                className="flex h-8 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">All Statuses</option>
                <option value="COMPLETED">Completed</option>
                <option value="NO_ANSWER">Missed / No Answer</option>
                <option value="CANCELED">Canceled / Missed</option>
                <option value="FAILED">Failed</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="durationType" className="text-xs font-medium">Duration Type</Label>
              <select
                id="durationType"
                value={draftFilters.durationType}
                onChange={(e) => setDraftFilters({...draftFilters, durationType: e.target.value})}
                className="flex h-8 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="total">Total Time</option>
                <option value="talk">Talk Time</option>
              </select>
            </div>
            <div className="space-y-1 flex gap-2">
              <div className="flex-1 space-y-1">
                <Label htmlFor="minDuration" className="text-xs font-medium">Min (s)</Label>
                <Input
                  id="minDuration"
                  type="number"
                  min="0"
                  placeholder="0"
                  value={draftFilters.minDuration}
                  onChange={(e) => setDraftFilters({...draftFilters, minDuration: e.target.value})}
                  className="h-8 text-sm"
                />
              </div>
              <div className="flex-1 space-y-1">
                <Label htmlFor="maxDuration" className="text-xs font-medium">Max (s)</Label>
                <Input
                  id="maxDuration"
                  type="number"
                  min="0"
                  placeholder="3600"
                  value={draftFilters.maxDuration}
                  onChange={(e) => setDraftFilters({...draftFilters, maxDuration: e.target.value})}
                  className="h-8 text-sm"
                />
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" type="button" onClick={resetFilters}>
              <RotateCcw className="h-4 w-4 mr-2" /> Reset
            </Button>
            <Button size="sm" type="button" onClick={applyFilters}>
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
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-4 xl:grid-cols-8 gap-4">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
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
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-4 xl:grid-cols-8 gap-4">
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center gap-2 text-muted-foreground mb-2">
                  <PhoneCall className="h-4 w-4" />
                  <span className="text-sm font-medium">Total Calls</span>
                </div>
                <div className="text-3xl font-bold text-foreground">{(metrics.total ?? 0).toLocaleString()}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center gap-2 text-muted-foreground mb-2">
                  <PhoneIncoming className="h-4 w-4 text-emerald-600" />
                  <span className="text-sm font-medium">Answered</span>
                </div>
                <div className="text-3xl font-bold text-foreground">{(metrics.answered ?? 0).toLocaleString()}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center gap-2 text-muted-foreground mb-2">
                  <PhoneMissed className="h-4 w-4 text-orange-500" />
                  <span className="text-sm font-medium">Missed</span>
                </div>
                <div className="text-3xl font-bold text-foreground">{(metrics.missed ?? 0).toLocaleString()}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center gap-2 text-muted-foreground mb-2">
                  <PhoneOff className="h-4 w-4 text-red-500" />
                  <span className="text-sm font-medium">Failed</span>
                </div>
                <div className="text-3xl font-bold text-foreground">{(metrics.failed ?? 0).toLocaleString()}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center gap-2 text-muted-foreground mb-2">
                  <Percent className="h-4 w-4 text-emerald-500" />
                  <span className="text-sm font-medium">Answer Rate</span>
                </div>
                <div className="text-3xl font-bold text-foreground">{formatPercent(answerRate)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center gap-2 text-muted-foreground mb-2">
                  <Timer className="h-4 w-4 text-blue-500" />
                  <span className="text-sm font-medium">Average Talk Time</span>
                </div>
                <div className="text-3xl font-bold text-foreground">{formatDurationHms(metrics.avgDuration)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center gap-2 text-muted-foreground mb-2">
                  <Clock className="h-4 w-4 text-indigo-500" />
                  <span className="text-sm font-medium">Average Total Time</span>
                </div>
                <div className="text-3xl font-bold text-foreground">{formatDurationHms(metrics.aclSecs)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center gap-2 text-muted-foreground mb-2">
                  <Radio className="h-4 w-4 text-emerald-600 animate-pulse" />
                  <span className="text-sm font-medium">Live Calls</span>
                </div>
                <div className="text-3xl font-bold text-foreground">{(liveCalls ?? 0).toLocaleString()}</div>
              </CardContent>
            </Card>
          </div>

          {/* Commercial Economics KPI Cards */}
          {(hasRevenue || hasPayout || metrics.converted !== undefined) && (
            <div className="space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Commercial Economics</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-4 xl:grid-cols-8 gap-4">
                {hasRevenue && (
                  <Card data-testid="kpi-revenue">
                    <CardContent className="p-5">
                      <div className="flex items-center gap-2 text-muted-foreground mb-2">
                        <DollarSign className="h-4 w-4 text-emerald-600" />
                        <span className="text-sm font-medium">Revenue</span>
                      </div>
                      <div className="text-2xl font-bold text-foreground">{formatCurrency(metrics.revenue, metrics.currency)}</div>
                    </CardContent>
                  </Card>
                )}
                {hasPayout && (
                  <Card data-testid="kpi-payout">
                    <CardContent className="p-5">
                      <div className="flex items-center gap-2 text-muted-foreground mb-2">
                        <DollarSign className="h-4 w-4 text-blue-600" />
                        <span className="text-sm font-medium">Payout</span>
                      </div>
                      <div className="text-2xl font-bold text-foreground">{formatCurrency(metrics.payout, metrics.currency)}</div>
                    </CardContent>
                  </Card>
                )}
                {hasProfit && (
                  <Card data-testid="kpi-profit">
                    <CardContent className="p-5">
                      <div className="flex items-center gap-2 text-muted-foreground mb-2">
                        <TrendingUp className={`h-4 w-4 ${(metrics.profit ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-500'}`} />
                        <span className="text-sm font-medium">Profit</span>
                      </div>
                      <div className={`text-2xl font-bold ${(metrics.profit ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                        {formatCurrency(metrics.profit, metrics.currency)}
                      </div>
                    </CardContent>
                  </Card>
                )}
                {hasCost && (
                  <Card data-testid="kpi-cost">
                    <CardContent className="p-5">
                      <div className="flex items-center gap-2 text-muted-foreground mb-2">
                        <DollarSign className="h-4 w-4 text-orange-500" />
                        <span className="text-sm font-medium">Cost</span>
                      </div>
                      <div className="text-2xl font-bold text-foreground">{formatCurrency(metrics.cost, metrics.currency)}</div>
                    </CardContent>
                  </Card>
                )}
                {metrics.converted !== undefined && (
                  <Card data-testid="kpi-converted">
                    <CardContent className="p-5">
                      <div className="flex items-center gap-2 text-muted-foreground mb-2">
                        <CheckCircle className="h-4 w-4 text-emerald-600" />
                        <span className="text-sm font-medium">Converted</span>
                      </div>
                      <div className="text-2xl font-bold text-foreground">{(metrics.converted ?? 0).toLocaleString()}</div>
                    </CardContent>
                  </Card>
                )}
                {metrics.qualified !== undefined && (
                  <Card data-testid="kpi-qualified">
                    <CardContent className="p-5">
                      <div className="flex items-center gap-2 text-muted-foreground mb-2">
                        <Percent className="h-4 w-4 text-indigo-500" />
                        <span className="text-sm font-medium">Qualified</span>
                      </div>
                      <div className="text-2xl font-bold text-foreground">{(metrics.qualified ?? 0).toLocaleString()}</div>
                    </CardContent>
                  </Card>
                )}
                {metrics.duplicate !== undefined && (
                  <Card data-testid="kpi-duplicate">
                    <CardContent className="p-5">
                      <div className="flex items-center gap-2 text-muted-foreground mb-2">
                        <Copy className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">Duplicate</span>
                      </div>
                      <div className="text-2xl font-bold text-foreground">{(metrics.duplicate ?? 0).toLocaleString()}</div>
                    </CardContent>
                  </Card>
                )}
                {metrics.conversionRate !== undefined && (
                  <Card data-testid="kpi-conversion-rate">
                    <CardContent className="p-5">
                      <div className="flex items-center gap-2 text-muted-foreground mb-2">
                        <Percent className="h-4 w-4 text-emerald-500" />
                        <span className="text-sm font-medium">Conv. Rate</span>
                      </div>
                      <div className="text-2xl font-bold text-foreground">{formatPercent(metrics.conversionRate ?? 0)}</div>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <CallsByDayChart
              buckets={metrics.buckets}
              currency={metrics.currency}
              bucket={bucket}
              onBucketChange={handleBucketChange}
              isLoading={loading}
              hasRevenue={hasRevenue}
              onRetry={fetchReporting}
            />

            <OutcomeDistributionChart metrics={metrics} isLoading={loading} />
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
                {!isVendor && <option value="Buyer">Buyer</option>}
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
                      <TableHead>Campaign</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Answered</TableHead>
                      <TableHead className="text-right">ACL</TableHead>
                      <TableHead className="text-right">TCL</TableHead>
                      {hasRevenue && <TableHead className="text-right">Revenue</TableHead>}
                      {hasPayout && <TableHead className="text-right">Payout</TableHead>}
                      {hasCost && <TableHead className="text-right">Cost</TableHead>}
                      {hasProfit && <TableHead className="text-right">Profit</TableHead>}
                      <TableHead className="text-right">Converted</TableHead>
                      <TableHead className="text-right">Qualified</TableHead>
                      <TableHead className="text-right">Duplicate</TableHead>
                      <TableHead className="text-right">Conv. Rate</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.values(metrics.campaigns as Record<string, any>).map((stats: any) => (
                      <TableRow key={stats.id || stats.name}>
                        <TableCell className="font-medium whitespace-nowrap">{stats.name || stats.id || 'Unknown Campaign'}</TableCell>
                        <TableCell className="text-right">{typeof stats.total === 'number' ? stats.total.toLocaleString() : '—'}</TableCell>
                        <TableCell className="text-right font-medium text-emerald-600">{typeof stats.answered === 'number' ? stats.answered.toLocaleString() : '—'}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{formatDurationHms(stats.aclSecs)}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{formatDurationHms(stats.tclSecs)}</TableCell>
                        {hasRevenue && <TableCell className="text-right font-mono text-xs">{formatCurrency(stats.revenue, metrics.currency)}</TableCell>}
                        {hasPayout && <TableCell className="text-right font-mono text-xs">{formatCurrency(stats.payout, metrics.currency)}</TableCell>}
                        {hasCost && <TableCell className="text-right font-mono text-xs">{formatCurrency(stats.cost, metrics.currency)}</TableCell>}
                        {hasProfit && (
                          <TableCell className={`text-right font-mono text-xs ${(stats.profit ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                            {formatCurrency(stats.profit, metrics.currency)}
                          </TableCell>
                        )}
                        <TableCell className="text-right">{stats.converted != null ? stats.converted.toLocaleString() : '—'}</TableCell>
                        <TableCell className="text-right">{stats.qualified != null ? stats.qualified.toLocaleString() : '—'}</TableCell>
                        <TableCell className="text-right">{stats.duplicate != null ? stats.duplicate.toLocaleString() : '—'}</TableCell>
                        <TableCell className="text-right">{formatPercent(stats.conversionRate ?? 0)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ))}

              {groupBy === 'Buyer' && (isVendor || !metrics.buyers || Object.keys(metrics.buyers).length === 0 ? (
                <div className="p-8 text-center text-muted-foreground text-sm">No buyer data available.</div>
              ) : (
                <Table>
                  <TableHeader className="bg-muted/50 whitespace-nowrap">
                    <TableRow>
                      <TableHead>Buyer (Legs)</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Answered</TableHead>
                      <TableHead className="text-right">Failed</TableHead>
                      <TableHead className="text-right">TCL</TableHead>
                      {hasRevenue && <TableHead className="text-right">Revenue</TableHead>}
                      {hasPayout && <TableHead className="text-right">Payout</TableHead>}
                      {hasCost && <TableHead className="text-right">Cost</TableHead>}
                      {hasProfit && <TableHead className="text-right">Profit</TableHead>}
                      <TableHead className="text-right">Converted</TableHead>
                      <TableHead className="text-right">Qualified</TableHead>
                      <TableHead className="text-right">Duplicate</TableHead>
                      <TableHead className="text-right">Conv. Rate</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.values(metrics.buyers as Record<string, any>).map((stats: any) => (
                      <TableRow key={stats.id}>
                        <TableCell className="font-medium whitespace-nowrap">{stats.name || 'Unknown Buyer'}</TableCell>
                        <TableCell className="text-right">{typeof stats.total === 'number' ? stats.total.toLocaleString() : '—'}</TableCell>
                        <TableCell className="text-right font-medium text-emerald-600">{typeof stats.answered === 'number' ? stats.answered.toLocaleString() : '—'}</TableCell>
                        <TableCell className="text-right">{typeof stats.failed === 'number' ? stats.failed.toLocaleString() : (typeof stats.total === 'number' && typeof stats.answered === 'number' ? Math.max(0, stats.total - stats.answered).toLocaleString() : '—')}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{formatDurationHms(stats.tclSecs)}</TableCell>
                        {hasRevenue && <TableCell className="text-right font-mono text-xs">{formatCurrency(stats.revenue, metrics.currency)}</TableCell>}
                        {hasPayout && <TableCell className="text-right font-mono text-xs">{formatCurrency(stats.payout, metrics.currency)}</TableCell>}
                        {hasCost && <TableCell className="text-right font-mono text-xs">{formatCurrency(stats.cost, metrics.currency)}</TableCell>}
                        {hasProfit && (
                          <TableCell className={`text-right font-mono text-xs ${(stats.profit ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                            {formatCurrency(stats.profit, metrics.currency)}
                          </TableCell>
                        )}
                        <TableCell className="text-right">{stats.converted != null ? stats.converted.toLocaleString() : '—'}</TableCell>
                        <TableCell className="text-right">{stats.qualified != null ? stats.qualified.toLocaleString() : '—'}</TableCell>
                        <TableCell className="text-right">{stats.duplicate != null ? stats.duplicate.toLocaleString() : '—'}</TableCell>
                        <TableCell className="text-right">{formatPercent(stats.conversionRate ?? 0)}</TableCell>
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
                      {hasRevenue && <TableHead className="text-right">Revenue</TableHead>}
                      {hasPayout && <TableHead className="text-right">Payout</TableHead>}
                      {hasCost && <TableHead className="text-right">Cost</TableHead>}
                      {hasProfit && <TableHead className="text-right">Profit</TableHead>}
                      <TableHead className="text-right">Converted</TableHead>
                      <TableHead className="text-right">Qualified</TableHead>
                      <TableHead className="text-right">Duplicate</TableHead>
                      <TableHead className="text-right">Conv. Rate</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.values(metrics.trackingNumbers as Record<string, any>).map((stats: any, index: number) => (
                      <TableRow key={stats.id || stats.phone_number || index}>
                        <TableCell className="font-medium font-mono text-xs whitespace-nowrap">{stats.tracking_number || stats.phone_number || 'Unknown'}</TableCell>
                        <TableCell className="text-right">{typeof stats.total === 'number' ? stats.total.toLocaleString() : '—'}</TableCell>
                        <TableCell className="text-right font-medium text-emerald-600">{typeof stats.answered === 'number' ? stats.answered.toLocaleString() : '—'}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{formatDurationHms(stats.aclSecs)}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{formatDurationHms(stats.tclSecs)}</TableCell>
                        {hasRevenue && <TableCell className="text-right font-mono text-xs">{formatCurrency(stats.revenue, metrics.currency)}</TableCell>}
                        {hasPayout && <TableCell className="text-right font-mono text-xs">{formatCurrency(stats.payout, metrics.currency)}</TableCell>}
                        {hasCost && <TableCell className="text-right font-mono text-xs">{formatCurrency(stats.cost, metrics.currency)}</TableCell>}
                        {hasProfit && (
                          <TableCell className={`text-right font-mono text-xs ${(stats.profit ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                            {formatCurrency(stats.profit, metrics.currency)}
                          </TableCell>
                        )}
                        <TableCell className="text-right">{stats.converted != null ? stats.converted.toLocaleString() : '—'}</TableCell>
                        <TableCell className="text-right">{stats.qualified != null ? stats.qualified.toLocaleString() : '—'}</TableCell>
                        <TableCell className="text-right">{stats.duplicate != null ? stats.duplicate.toLocaleString() : '—'}</TableCell>
                        <TableCell className="text-right">{formatPercent(stats.conversionRate ?? 0)}</TableCell>
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
                        <TableCell className="text-right">{typeof d.value === 'number' ? d.value.toLocaleString() : '—'}</TableCell>
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
                      {displayedColumns.map((col, index) => {
                        const originalIndex = columns.findIndex(c => c.id === col.id);
                        return (
                          <div key={col.id} className="flex items-center justify-between py-1 px-2 hover:bg-muted/50 rounded-sm">
                            <label className="flex items-center gap-2 cursor-pointer flex-1">
                              <input 
                                type="checkbox" 
                                checked={col.visible} 
                                disabled={col.locked}
                                onChange={() => toggleColumn(originalIndex)} 
                                className="rounded border-border text-primary focus:ring-primary"
                              />
                              <span className={`text-sm ${col.locked ? 'text-muted-foreground' : ''}`}>{col.label}</span>
                            </label>
                            <div className="flex flex-col gap-0.5 ml-2">
                              <button 
                                disabled={index === 0} 
                                onClick={() => moveColumn(originalIndex, -1)}
                                className="text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed h-4 w-4 flex items-center justify-center"
                                aria-label={`Move ${col.label} up`}
                              >
                                <ChevronUp className="w-3 h-3" />
                              </button>
                              <button 
                                disabled={index === displayedColumns.length - 1} 
                                onClick={() => moveColumn(originalIndex, 1)}
                                className="text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed h-4 w-4 flex items-center justify-center"
                                aria-label={`Move ${col.label} down`}
                              >
                                <ChevronDown className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
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
                      {visibleColumns.map(col => (
                        <TableHead 
                          key={col.id} 
                          className={col.id === 'actions' || col.id === 'talkDuration' || col.id === 'totalDuration' || col.id === 'revenue' || col.id === 'payout' || col.id === 'profit' || col.id === 'attempts' ? 'text-right' : col.id === 'recording' ? 'text-center' : ''}
                        >
                          {col.label}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {calls.map((call: any) => {
                      const finalDestination = getFinalDestinationDisplay(call);
                      const recordingAvailable = call.recordings && call.recordings.length > 0;
                      const comm = call.commercial;

                      return (
                        <TableRow key={call.id}>
                          {visibleColumns.map(col => {
                            if (col.id === 'time') {
                              return (
                                <TableCell key={col.id} className="text-xs whitespace-nowrap text-muted-foreground">
                                  {call.created_at ? new Date(call.created_at).toLocaleString() : '—'}
                                </TableCell>
                              );
                            }
                            if (col.id === 'caller') {
                              return <TableCell key={col.id} className="font-mono text-xs">{formatCallerDisplay(call.from_number, isVendor)}</TableCell>;
                            }
                            if (col.id === 'trackingNumber') {
                              return <TableCell key={col.id} className="font-mono text-xs">{call.to_number}</TableCell>;
                            }
                            if (col.id === 'campaign') {
                              return <TableCell key={col.id} className="text-xs whitespace-nowrap">{call.campaign?.name || '—'}</TableCell>;
                            }
                            if (col.id === 'finalDestination') {
                              return (
                                <TableCell key={col.id} className={`text-xs whitespace-nowrap ${finalDestination.startsWith('+') ? 'font-mono' : ''}`}>
                                  {finalDestination}
                                </TableCell>
                              );
                            }
                            if (col.id === 'status') {
                              return (
                                <TableCell key={col.id}>
                                  <Badge variant={getStatusBadgeVariant(call.state)} className="text-[10px]">
                                    {call.state}
                                  </Badge>
                                </TableCell>
                              );
                            }
                            if (col.id === 'talkDuration') {
                              const talkSecs = call.talkDurationSecs ?? call.talk_duration_secs;
                              return (
                                <TableCell key={col.id} className="text-right font-mono text-xs">
                                  {talkSecs != null ? formatDurationHms(talkSecs) : '—'}
                                </TableCell>
                              );
                            }
                            if (col.id === 'totalDuration') {
                              const totalSecs = call.totalDurationSecs ?? call.total_duration_secs;
                              return (
                                <TableCell key={col.id} className="text-right font-mono text-xs">
                                  {totalSecs != null ? formatDurationHms(totalSecs) : '—'}
                                </TableCell>
                              );
                            }
                            if (col.id === 'revenue') {
                              return (
                                <TableCell key={col.id} className="text-right font-mono text-xs">
                                  {comm && comm.revenue !== undefined ? formatCurrency(comm.revenue, comm.currency) : '—'}
                                </TableCell>
                              );
                            }
                            if (col.id === 'payout') {
                              return (
                                <TableCell key={col.id} className="text-right font-mono text-xs">
                                  {comm && comm.payout !== undefined ? formatCurrency(comm.payout, comm.currency) : '—'}
                                </TableCell>
                              );
                            }
                            if (col.id === 'profit') {
                              return (
                                <TableCell key={col.id} className={`text-right font-mono text-xs ${comm && comm.profit !== undefined && comm.profit >= 0 ? 'text-emerald-600' : comm && comm.profit !== undefined ? 'text-red-500' : ''}`}>
                                  {comm && comm.profit !== undefined ? formatCurrency(comm.profit, comm.currency) : '—'}
                                </TableCell>
                              );
                            }
                            if (col.id === 'commercial') {
                              return (
                                <TableCell key={col.id} className="whitespace-nowrap">
                                  {comm ? (
                                    <div className="flex flex-col gap-1 items-start">
                                      <div className="flex gap-1 flex-wrap">
                                        {comm.converted && <Badge variant="success" className="text-[9px] px-1 py-0">Converted</Badge>}
                                        {comm.qualified && <Badge variant="success" className="text-[9px] px-1 py-0">Qualified</Badge>}
                                        {comm.duplicate && <Badge variant="warning" className="text-[9px] px-1 py-0">Duplicate</Badge>}
                                        <Badge variant="outline" className="text-[9px] px-1 py-0">{comm.status}</Badge>
                                      </div>
                                      {comm.disputeStatus && (
                                        <Badge variant={comm.disputeStatus === 'ACCEPTED' ? 'error' : comm.disputeStatus === 'PENDING' ? 'warning' : 'outline'} className="text-[9px] px-1 py-0">
                                          Dispute: {comm.disputeStatus}
                                        </Badge>
                                      )}
                                    </div>
                                  ) : (
                                    <span className="text-muted-foreground text-xs">—</span>
                                  )}
                                </TableCell>
                              );
                            }
                            if (col.id === 'attempts') {
                              return (
                                <TableCell key={col.id} className="text-right text-xs">
                                  {call.attempts?.length || 0} attempts
                                </TableCell>
                              );
                            }
                            if (col.id === 'recording') {
                              const playableRec = call.recordings?.find((r: any) => r.status === 'COMPLETED');
                              return (
                                <TableCell key={col.id} className="text-center text-xs">
                                  {playableRec ? (
                                    <InlineRecordingPlayer
                                      workspaceId={workspaceId}
                                      callWorkspaceId={call.workspace_id}
                                      recordingId={playableRec.id}
                                      recordings={call.recordings}
                                    />
                                  ) : (
                                    <span className="text-muted-foreground text-xs">—</span>
                                  )}
                                </TableCell>
                              );
                            }
                            if (col.id === 'actions') {
                              return (
                                <TableCell key={col.id} className="text-right">
                                  <Link href={`/protected/calls/${call.id}?workspace=${workspaceId}&returnTo=reporting&${searchParams.toString()}`}>
                                    <Button variant="outline" size="sm">View</Button>
                                  </Link>
                                </TableCell>
                              );
                            }
                            return null;
                          })}
                        </TableRow>
                      );
                    })}
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
