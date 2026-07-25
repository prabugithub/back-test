import { useEffect, useMemo, useState } from 'react';
import {
  TrendingUp, TrendingDown, Activity, Target,
  BarChart3, Filter, Download as DownloadIcon,
  Layers, ArrowUpRight, ArrowDownRight, Info,
  Search, ArrowUpDown, ChevronRight, ChevronDown, Link as LinkIcon,
  Loader2
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell, PieChart as RePieChart, Pie, Legend
} from 'recharts';
import { listSnapshots, type SessionState } from '../services/firebaseSessionService';
import { groupTradesIntoPositions, calculatePerformanceStats, type GroupedPosition } from '../utils/tradeAnalysis';
import { formatCurrency, formatTimestamp } from '../utils/formatters';
import { OptionBacktestModal } from './OptionBacktestModal';
import { ShieldCheck } from 'lucide-react';
import { EntryMetricsDashboardFromPositions } from './EntryMetricsDashboard';
import { PageNavTabs, type ActivePage } from './PageNavTabs';

interface PerformanceDashboardProps {
    onNavigate: (page: ActivePage) => void;
    liveInstrument?: string;
}

const MARKET_STRUCTURES = [
    'Bull-Trend', 'Range', 'Bear-Trend', 'Bear-Reversal',
    'Bull-Reversal', 'Bear-Trending-range', 'Bull-Trending-range'
];

export function PerformanceDashboard({ onNavigate, liveInstrument }: PerformanceDashboardProps) {
    const [snapshots, setSnapshots] = useState<SessionState[]>([]);
    const [loadingSnapshots, setLoadingSnapshots] = useState(false);
    const [selectedSnapshotIds, setSelectedSnapshotIds] = useState<Set<string> | null>(null); // null = all
    const [selectedInstrument, setSelectedInstrument] = useState<string>('All');
    const [selectedCategory, setSelectedCategory] = useState<string>('All');
    const [activeTab, setActiveTab] = useState<'dashboard' | 'log' | 'entry'>('dashboard');
    const [searchQuery, setSearchQuery] = useState('');
    const [isOptionModalOpen, setIsOptionModalOpen] = useState(false);

    useEffect(() => {
        if (liveInstrument) setSelectedInstrument(liveInstrument);
        setLoadingSnapshots(true);
        listSnapshots().then(snaps => {
            setSnapshots(snaps);
            setSelectedSnapshotIds(null); // null = all included
        }).finally(() => setLoadingSnapshots(false));
    }, [liveInstrument]);

    // Consolidate trades from selected snapshots
    const filteredPositions = useMemo(() => {
        let allPos: GroupedPosition[] = [];

        // null = all included; empty Set = none; non-empty Set = only those IDs
        const activeSnapshots = selectedSnapshotIds === null
            ? snapshots
            : snapshots.filter(s => selectedSnapshotIds.has(s.id!));
        activeSnapshots.forEach(s => {
            const pos = groupTradesIntoPositions(s.trades);
            allPos = [...allPos, ...pos];
        });

        return allPos.filter(p => {
            // Instrument Filter (Case-Insensitive)
            const pInst = p.instrument.trim().toLowerCase();
            const sInst = selectedInstrument.trim().toLowerCase();
            const matchInstrument = selectedInstrument === 'All' || pInst === sInst;

            // Category Filter (Case-Insensitive)
            const entryExec = p.executions[0];
            const pCat = (entryExec?.journal?.tradeCategory || 'Discretionary').trim().toLowerCase();
            const sCat = selectedCategory.trim().toLowerCase();
            const matchCategory = selectedCategory === 'All' || pCat === sCat;

            return matchInstrument && matchCategory;
        }).sort((a, b) => a.entryTime - b.entryTime);
    }, [snapshots, selectedSnapshotIds, selectedInstrument, selectedCategory]);

    const stats = useMemo(() => calculatePerformanceStats(filteredPositions), [filteredPositions]);

    const instruments = useMemo(() => {
        const set = new Set<string>();
        snapshots.forEach(s => set.add(s.instrument));
        if (liveInstrument) set.add(liveInstrument);
        return ['All', ...Array.from(set)];
    }, [snapshots, liveInstrument]);

    // Data for charts
    const pnlDistributionData = useMemo(() => {
        const bins: Record<string, number> = {};
        filteredPositions.forEach(p => {
            if (p.status !== 'CLOSED') return;
            const pnl = p.realizedPnL;
            const binSize = 500; 
            const binLower = Math.floor(pnl / binSize) * binSize;
            const binLabel = `${binLower}`;
            bins[binLabel] = (bins[binLabel] || 0) + 1;
        });
        return Object.entries(bins).map(([label, count]) => ({
            label: Number(label),
            count
        })).sort((a, b) => a.label - b.label);
    }, [filteredPositions]);

    const categoryPerformance = useMemo(() => {
        const cats: Record<string, { pnl: number; count: number }> = {
            'System': { pnl: 0, count: 0 },
            'Discretionary': { pnl: 0, count: 0 }
        };
        filteredPositions.forEach(p => {
            if (p.status !== 'CLOSED') return;
            const cat = p.executions[0]?.journal?.tradeCategory || 'Discretionary';
            if (cats[cat]) {
                cats[cat].pnl += p.realizedPnL;
                cats[cat].count += 1;
            }
        });
        return Object.entries(cats).map(([name, data]) => ({ name, ...data }));
    }, [filteredPositions]);

    const heatmapData = useMemo(() => {
        const matrix: Record<string, Record<string, { pnl: number; count: number }>> = {};
        
        MARKET_STRUCTURES.forEach(lt => {
            matrix[lt] = {};
            MARKET_STRUCTURES.forEach(ht => {
                matrix[lt][ht] = { pnl: 0, count: 0 };
            });
        });

        filteredPositions.forEach(p => {
            if (p.status !== 'CLOSED') return;
            const journal = p.executions[0]?.journal;
            if (journal) {
                const lt = journal.ltMarket;
                const ht = journal.htMarket;
                if (matrix[lt] && matrix[lt][ht]) {
                    matrix[lt][ht].pnl += p.realizedPnL;
                    matrix[lt][ht].count += 1;
                }
            }
        });

        return matrix;
    }, [filteredPositions]);

    const contextualStats = useMemo(() => {
        const entryPos: Record<string, { pnl: number; count: number; wins: number }> = {};
        const entrySign: Record<string, { pnl: number; count: number; wins: number }> = {};
        const pivotPattern: Record<string, { pnl: number; count: number; wins: number }> = {};
        const hourly: Record<number, { pnl: number; count: number; wins: number }> = {};

        filteredPositions.forEach(p => {
            if (p.status !== 'CLOSED') return;
            const journal = p.executions[0]?.journal;
            const win = p.realizedPnL > 0;

            if (journal) {
                // Entry Position
                const pos = journal.entryPosition || 'Unknown';
                if (!entryPos[pos]) entryPos[pos] = { pnl: 0, count: 0, wins: 0 };
                entryPos[pos].pnl += p.realizedPnL;
                entryPos[pos].count += 1;
                if (win) entryPos[pos].wins += 1;

                // Entry Sign
                const sign = journal.entrySign || 'Unknown';
                if (!entrySign[sign]) entrySign[sign] = { pnl: 0, count: 0, wins: 0 };
                entrySign[sign].pnl += p.realizedPnL;
                entrySign[sign].count += 1;
                if (win) entrySign[sign].wins += 1;

                // Pivot Pattern
                const pivot = journal.llhhPivot || 'Unknown';
                if (!pivotPattern[pivot]) pivotPattern[pivot] = { pnl: 0, count: 0, wins: 0 };
                pivotPattern[pivot].pnl += p.realizedPnL;
                pivotPattern[pivot].count += 1;
                if (win) pivotPattern[pivot].wins += 1;
            }

            // Hourly
            const hour = new Date(p.entryTime).getHours();
            if (!hourly[hour]) hourly[hour] = { pnl: 0, count: 0, wins: 0 };
            hourly[hour].pnl += p.realizedPnL;
            hourly[hour].count += 1;
            if (win) hourly[hour].wins += 1;
        });

        const mapToChartData = (record: Record<string, { pnl: number; count: number; wins: number }>) => {
            return Object.entries(record).map(([name, d]) => ({
                name,
                ...d,
                winRate: d.count > 0 ? (d.wins / d.count) * 100 : 0
            })).sort((a, b) => b.pnl - a.pnl);
        };

        return {
            entryPos: mapToChartData(entryPos),
            entrySign: mapToChartData(entrySign),
            pivotPattern: mapToChartData(pivotPattern),
            hourly: Object.entries(hourly).map(([h, d]) => ({
                hour: parseInt(h, 10),
                ...d,
                winRate: d.count > 0 ? (d.wins / d.count) * 100 : 0
            })).sort((a, b) => a.hour - b.hour)
        };
    }, [filteredPositions]);

    const insights = useMemo(() => {
        // Profitability by "Setup" (Combined LT + Sign)
        const setupMap: Record<string, { pnl: number; count: number; wins: number }> = {};
        
        filteredPositions.forEach(p => {
            if (p.status !== 'CLOSED') return;
            const journal = p.executions[0]?.journal;
            if (!journal) return;
            
            const setupId = `${journal.ltMarket} | ${journal.entrySign}`;
            if (!setupMap[setupId]) setupMap[setupId] = { pnl: 0, count: 0, wins: 0 };
            setupMap[setupId].pnl += p.realizedPnL;
            setupMap[setupId].count += 1;
            if (p.realizedPnL > 0) setupMap[setupId].wins += 1;
        });

        const sortedSetups = Object.entries(setupMap).map(([name, d]) => ({ name, ...d, winRate: (d.wins/d.count)*100 }));
        
        return {
            topSetups: [...sortedSetups].sort((a, b) => b.pnl - a.pnl).slice(0, 5),
            worstSetups: [...sortedSetups].sort((a, b) => a.pnl - b.pnl).slice(0, 5),
        };
    }, [filteredPositions]);

    const handleExportCSV = () => {
        if (filteredPositions.length === 0) return;

        let csv = "ID,Instrument,Direction,Entry Time,Exit Time,Entry Price,Exit Price,Qty,PnL,LT Market,HT Market,Entry Pos,LLHH Pivot,Entry Sign,Category\n";
        filteredPositions.forEach(p => {
            const j = p.executions[0]?.journal;
            csv += `${p.id},${p.instrument},${p.direction},${formatTimestamp(p.entryTime)},${p.exitTime ? formatTimestamp(p.exitTime) : 'OPEN'},${p.avgEntryPrice},${p.avgExitPrice || ''},${p.totalQuantity},${p.realizedPnL},${j?.ltMarket || ''},${j?.htMarket || ''},${j?.entryPosition || ''},${j?.llhhPivot || ''},${j?.entrySign || ''},${j?.tradeCategory || ''}\n`;
        });

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `trade-analysis-export-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
    };

    return (
        <div className="absolute inset-0 z-[110] bg-slate-50 flex flex-col overflow-hidden font-sans">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-slate-200 shrink-0">
                <div className="flex items-center gap-4">
                    <PageNavTabs active="dashboard" onNavigate={onNavigate} />
                    <div className="w-px h-6 bg-slate-200 hidden lg:block" />
                    <div className="bg-blue-600 p-2 rounded-xl text-white shadow-lg shadow-blue-200 hidden lg:block">
                        <Activity size={20} />
                    </div>
                    <div className="hidden lg:block">
                        <h2 className="text-xl font-bold text-slate-800 tracking-tight">Performance Analytics</h2>
                        <p className="text-slate-500 text-xs font-medium">Detailed insights into your backtesting strategy</p>
                    </div>
                </div>
                <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200">
                    <button
                        onClick={() => setActiveTab('dashboard')}
                        className={`px-4 py-1.5 text-sm font-bold rounded-md transition-all ${activeTab === 'dashboard' ? 'text-blue-700 bg-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                        Dashboard
                    </button>
                    <button
                        onClick={() => setActiveTab('entry')}
                        className={`px-4 py-1.5 text-sm font-bold rounded-md transition-all ${activeTab === 'entry' ? 'text-blue-700 bg-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                        Entry Analytics
                    </button>
                    <button
                        onClick={() => setActiveTab('log')}
                        className={`px-4 py-1.5 text-sm font-bold rounded-md transition-all ${activeTab === 'log' ? 'text-blue-700 bg-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                        Detailed Log
                    </button>
                </div>
            </div>

                {/* Main Content */}
                <div className="flex-1 flex overflow-hidden">
                    {/* Filters Sidebar */}
                    <div className="w-72 bg-white border-r border-slate-200 p-6 flex flex-col gap-6 overflow-y-auto">
                        <div>
                            <div className="flex items-center gap-2 mb-4 text-slate-800">
                                <Filter size={18} className="text-blue-600" />
                                <h3 className="font-bold text-sm uppercase tracking-wider">Filters</h3>
                            </div>
                            
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5 tracking-tighter">Instrument</label>
                                    <select 
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-medium"
                                        value={selectedInstrument}
                                        onChange={(e) => setSelectedInstrument(e.target.value)}
                                    >
                                        {instruments.map(inst => (
                                            <option key={inst} value={inst}>{inst}</option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5 tracking-tighter">Category</label>
                                    <select 
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-medium"
                                        value={selectedCategory}
                                        onChange={(e) => setSelectedCategory(e.target.value)}
                                    >
                                        <option value="All">All Categories</option>
                                        <option value="System">System</option>
                                        <option value="Discretionary">Discretionary</option>
                                    </select>
                                </div>

                                <div>
                                    <div className="flex items-center justify-between mb-1.5">
                                        <label className="text-xs font-bold text-slate-400 uppercase tracking-tighter">Snapshots</label>
                                        {snapshots.length > 0 && (
                                            <div className="flex gap-2 text-[10px] font-bold">
                                                <button
                                                    className="text-blue-500 hover:text-blue-700"
                                                    onClick={() => setSelectedSnapshotIds(null)}
                                                >All</button>
                                                <span className="text-slate-300">|</span>
                                                <button
                                                    className="text-blue-500 hover:text-blue-700"
                                                    onClick={() => setSelectedSnapshotIds(new Set())}
                                                >None</button>
                                            </div>
                                        )}
                                    </div>
                                    {loadingSnapshots ? (
                                        <div className="flex items-center gap-2 text-slate-400 text-xs py-2">
                                            <Loader2 size={14} className="animate-spin" />
                                            <span>Loading snapshots...</span>
                                        </div>
                                    ) : snapshots.length === 0 ? (
                                        <p className="text-xs text-slate-400 italic py-1">No snapshots saved yet.</p>
                                    ) : (
                                        <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1 custom-scrollbar">
                                            {snapshots.map(s => {
                                                return (
                                                    <label key={s.id} className="flex items-start gap-2 cursor-pointer group">
                                                        <input
                                                            type="checkbox"
                                                            className="mt-0.5 accent-blue-600 shrink-0"
                                                            checked={selectedSnapshotIds === null || selectedSnapshotIds.has(s.id!)}
                                                            onChange={() => {
                                                                setSelectedSnapshotIds(prev => {
                                                                    if (prev === null) {
                                                                        // All mode → uncheck this one: include all except this
                                                                        const next = new Set(snapshots.map(sn => sn.id!));
                                                                        next.delete(s.id!);
                                                                        return next;
                                                                    }
                                                                    const next = new Set(prev);
                                                                    if (next.has(s.id!)) {
                                                                        next.delete(s.id!);
                                                                    } else {
                                                                        next.add(s.id!);
                                                                        if (next.size === snapshots.length) return null; // all checked → back to "all" mode
                                                                    }
                                                                    return next;
                                                                });
                                                            }}
                                                        />
                                                        <div className="min-w-0">
                                                            <div className="text-xs font-semibold text-slate-700 truncate group-hover:text-blue-700">{s.name}</div>
                                                            <div className="text-[10px] text-slate-400">
                                                                {s.archivedAt ? new Date(s.archivedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : ''}
                                                            </div>
                                                        </div>
                                                    </label>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="mt-auto space-y-3 pt-6 border-t border-slate-100">
                            <button 
                                onClick={() => setIsOptionModalOpen(true)}
                                className="w-full flex items-center justify-center gap-2 bg-indigo-600 text-white rounded-xl py-3 text-sm font-bold shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all cursor-pointer"
                            >
                                <ShieldCheck size={18} />
                                Option Backtest (Dhan)
                            </button>
                            <button 
                                onClick={handleExportCSV}
                                className="w-full flex items-center justify-center gap-2 bg-slate-800 text-white rounded-xl py-3 text-sm font-bold shadow-lg shadow-slate-200 hover:bg-slate-900 transition-all cursor-pointer"
                            >
                                <DownloadIcon size={18} />
                                Export Filtered Data
                            </button>
                        </div>
                    </div>
                    
                    <OptionBacktestModal 
                        isOpen={isOptionModalOpen} 
                        onClose={() => setIsOptionModalOpen(false)} 
                        customPositions={filteredPositions}
                        customInstrument={selectedInstrument === 'All' ? 'NIFTY' : selectedInstrument}
                    />

                    {/* Dashboard Scrollable Area */}
                    <div className="flex-1 overflow-y-auto bg-slate-50/50 p-8 custom-scrollbar">
                        {filteredPositions.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-4">
                                <Activity size={64} className="opacity-10" />
                                <div className="text-center">
                                    <h3 className="text-lg font-bold text-slate-500">No trading data available</h3>
                                    <p className="text-sm">Try adjusting your filters or complete some backtesting sessions.</p>
                                </div>
                            </div>
                        ) : (
                            <>
                                {/* KPI Cards */}
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden group">
                                        <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                                            <Activity size={64} className="text-blue-600" />
                                        </div>
                                        <div className="text-xs font-bold text-slate-400 uppercase mb-2 tracking-widest">Total Net P&L</div>
                                        <div className={`text-3xl font-black ${stats.totalPnL >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                            {formatCurrency(stats.totalPnL)}
                                        </div>
                                        <div className="mt-3 flex items-center gap-1.5 text-xs font-bold text-slate-500">
                                            <div className={`flex items-center ${stats.totalPnL >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                                {stats.totalPnL >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                                            </div>
                                            <span>From {stats.totalTrades} positions</span>
                                        </div>
                                    </div>

                                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden group">
                                        <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                                            <Target size={64} className="text-orange-600" />
                                        </div>
                                        <div className="text-xs font-bold text-slate-400 uppercase mb-2 tracking-widest">Win Rate</div>
                                        <div className={`text-3xl font-black ${stats.winRate >= 50 ? 'text-emerald-600' : 'text-orange-600'}`}>
                                            {stats.winRate.toFixed(1)}<span className="text-xl">%</span>
                                        </div>
                                        <div className="mt-3 flex items-center gap-2 text-xs font-bold">
                                            <span className="text-emerald-600">{stats.winningTrades} Wins</span>
                                            <span className="text-slate-300">|</span>
                                            <span className="text-rose-500">{stats.losingTrades} Losses</span>
                                        </div>
                                    </div>

                                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden group">
                                        <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                                            <Layers size={64} className="text-indigo-600" />
                                        </div>
                                        <div className="text-xs font-bold text-slate-400 uppercase mb-2 tracking-widest">Profit Factor</div>
                                        <div className="text-3xl font-black text-indigo-600">
                                            {stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2)}
                                        </div>
                                        <div className="mt-3 flex items-center gap-1.5 text-xs font-bold text-slate-500">
                                            <Info size={14} className="text-slate-300" />
                                            <span>Expectancy: {formatCurrency(stats.expectancy || 0)}</span>
                                        </div>
                                    </div>

                                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden group">
                                        <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                                            <TrendingDown size={64} className="text-rose-600" />
                                        </div>
                                        <div className="text-xs font-bold text-slate-400 uppercase mb-2 tracking-widest">Max Drawdown</div>
                                        <div className="text-3xl font-black text-rose-600">
                                            {formatCurrency(stats.maxDrawdown)}
                                        </div>
                                        <div className="mt-3 text-xs font-bold text-rose-500/70">
                                            {stats.maxDrawdownPercent.toFixed(2)}% Relative drawdown
                                        </div>
                                    </div>
                                </div>

                                {activeTab === 'dashboard' ? (
                                    <>
                                        {/* Charts Grid */}
                                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
                                            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col h-[400px]">
                                                <div className="flex items-center justify-between mb-6">
                                                    <h3 className="font-bold text-slate-800 flex items-center gap-2">
                                                        <TrendingUp size={18} className="text-blue-600" />
                                                        Equity Growth
                                                    </h3>
                                                </div>
                                                <div className="flex-1 min-h-0">
                                                    <ResponsiveContainer width="100%" height="100%">
                                                        <AreaChart data={stats.equityCurve}>
                                                            <defs>
                                                                <linearGradient id="colorEquity" x1="0" y1="0" x2="0" y2="1">
                                                                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15}/>
                                                                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                                                                </linearGradient>
                                                            </defs>
                                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                                            <XAxis dataKey="timestamp" hide />
                                                            <YAxis tick={{fontSize: 10, fill: '#94a3b8'}} tickFormatter={(v) => `₹${v/1000}k`} axisLine={false} tickLine={false} />
                                                            <Tooltip 
                                                                labelFormatter={(ts) => formatTimestamp(ts)}
                                                                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                                                            />
                                                            <Area type="monotone" dataKey="equity" stroke="#3b82f6" strokeWidth={3} fillOpacity={1} fill="url(#colorEquity)" />
                                                        </AreaChart>
                                                    </ResponsiveContainer>
                                                </div>
                                            </div>

                                            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col h-[400px]">
                                                <div className="flex items-center justify-between mb-6">
                                                    <h3 className="font-bold text-slate-800 flex items-center gap-2">
                                                        <BarChart3 size={18} className="text-indigo-600" />
                                                        Profit Distribution
                                                    </h3>
                                                </div>
                                                <div className="flex-1 min-h-0">
                                                    <ResponsiveContainer width="100%" height="100%">
                                                        <BarChart data={pnlDistributionData}>
                                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                                            <XAxis dataKey="label" tick={{fontSize: 9, fill: '#94a3b8'}} axisLine={false} tickLine={false} tickFormatter={(v) => `₹${v}`} />
                                                            <YAxis tick={{fontSize: 10, fill: '#94a3b8'}} axisLine={false} tickLine={false} />
                                                            <Tooltip cursor={{fill: '#f8fafc'}} contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }} />
                                                            <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                                                                {pnlDistributionData.map((entry, index) => (
                                                                    <Cell key={`cell-${index}`} fill={entry.label >= 0 ? '#10b981' : '#f43f5e'} />
                                                                ))}
                                                            </Bar>
                                                        </BarChart>
                                                    </ResponsiveContainer>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
                                            {/* Insights */}
                                            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col">
                                                <div className="flex items-center gap-2 mb-6">
                                                    <TrendingUp size={20} className="text-emerald-500" />
                                                    <h3 className="font-bold text-slate-800 uppercase tracking-tight text-sm">Top 5 Most Profitable Setups</h3>
                                                </div>
                                                <div className="space-y-4">
                                                    {insights.topSetups.map((s, i) => (
                                                        <div key={i} className="flex items-center justify-between p-3 bg-emerald-50/50 rounded-xl border border-emerald-100/50">
                                                            <div className="flex flex-col">
                                                                <span className="text-xs font-black text-slate-700">{s.name}</span>
                                                                <span className="text-[10px] text-slate-500 font-bold">{s.count} trades • {s.winRate.toFixed(1)}% Win Rate</span>
                                                            </div>
                                                            <div className="text-sm font-black text-emerald-600">+{formatCurrency(s.pnl)}</div>
                                                        </div>
                                                    ))}
                                                    {insights.topSetups.length === 0 && <p className="text-center text-slate-400 text-sm py-8 font-medium italic">Analyzing setup data...</p>}
                                                </div>
                                            </div>

                                            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col">
                                                <div className="flex items-center gap-2 mb-6">
                                                    <TrendingDown size={20} className="text-rose-500" />
                                                    <h3 className="font-bold text-slate-800 uppercase tracking-tight text-sm">Top 5 Scenarios to Avoid</h3>
                                                </div>
                                                <div className="space-y-4">
                                                    {insights.worstSetups.map((s, i) => (
                                                        <div key={i} className="flex items-center justify-between p-3 bg-rose-50/50 rounded-xl border border-rose-100/50">
                                                            <div className="flex flex-col">
                                                                <span className="text-xs font-black text-slate-700">{s.name}</span>
                                                                <span className="text-[10px] text-slate-500 font-bold">{s.count} trades • {s.winRate.toFixed(1)}% Win Rate</span>
                                                            </div>
                                                            <div className="text-sm font-black text-rose-600">{formatCurrency(s.pnl)}</div>
                                                        </div>
                                                    ))}
                                                    {insights.worstSetups.length === 0 && <p className="text-center text-slate-400 text-sm py-8 font-medium italic">Analyzing risk patterns...</p>}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
                                            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col h-[350px]">
                                                <h4 className="font-bold text-slate-800 mb-6 text-sm flex items-center gap-2 uppercase tracking-tighter">
                                                    <Target size={18} className="text-blue-500" />
                                                    Entry Signal Effectiveness
                                                 </h4>
                                                <div className="flex-1 min-h-0">
                                                    <ResponsiveContainer width="100%" height="100%">
                                                        <BarChart data={contextualStats.entrySign} layout="vertical">
                                                            <XAxis type="number" hide />
                                                            <YAxis dataKey="name" type="category" width={100} tick={{fontSize: 9, fontWeight: 'bold'}} axisLine={false} tickLine={false} />
                                                            <Tooltip cursor={{fill: 'transparent'}} />
                                                            <Bar dataKey="pnl" radius={[0, 4, 4, 0]}>
                                                                {contextualStats.entrySign.map((entry, index) => (
                                                                    <Cell key={`cell-${index}`} fill={entry.pnl >= 0 ? '#10b981' : '#f43f5e'} />
                                                                ))}
                                                            </Bar>
                                                        </BarChart>
                                                    </ResponsiveContainer>
                                                </div>
                                            </div>

                                            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col h-[350px]">
                                                <h4 className="font-bold text-slate-800 mb-6 text-sm flex items-center gap-2 uppercase tracking-tighter">
                                                    <Activity size={18} className="text-indigo-500" />
                                                    Hourly Performance (Net PnL)
                                                </h4>
                                                <div className="flex-1 min-h-0">
                                                    <ResponsiveContainer width="100%" height="100%">
                                                        <AreaChart data={contextualStats.hourly}>
                                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                                            <XAxis dataKey="hour" tickFormatter={(h) => `${h}:00`} tick={{fontSize: 10}} axisLine={false} tickLine={false} />
                                                            <YAxis tick={{fontSize: 10}} axisLine={false} tickLine={false} />
                                                            <Tooltip />
                                                            <Area type="monotone" dataKey="pnl" stroke="#6366f1" fill="#6366f1" fillOpacity={0.1} strokeWidth={3} />
                                                        </AreaChart>
                                                    </ResponsiveContainer>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
                                            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col h-[350px]">
                                                <h4 className="font-bold text-slate-800 mb-6 text-sm flex items-center gap-2 uppercase tracking-tighter">
                                                    <Layers size={18} className="text-purple-500" />
                                                    LLHH Pivot Pattern Performance
                                                 </h4>
                                                <div className="flex-1 min-h-0">
                                                    <ResponsiveContainer width="100%" height="100%">
                                                        <BarChart data={contextualStats.pivotPattern} layout="vertical">
                                                            <XAxis type="number" hide />
                                                            <YAxis dataKey="name" type="category" width={100} tick={{fontSize: 9, fontWeight: 'bold'}} axisLine={false} tickLine={false} />
                                                            <Tooltip cursor={{fill: 'transparent'}} />
                                                            <Bar dataKey="pnl" radius={[0, 4, 4, 0]}>
                                                                {contextualStats.pivotPattern.map((entry, index) => (
                                                                    <Cell key={`cell-${index}`} fill={entry.pnl >= 0 ? '#10b981' : '#f43f5e'} />
                                                                ))}
                                                            </Bar>
                                                        </BarChart>
                                                    </ResponsiveContainer>
                                                </div>
                                            </div>

                                            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col h-[350px]">
                                                <h4 className="font-bold text-slate-800 mb-6 text-sm flex items-center gap-2 uppercase tracking-tighter">
                                                    <Target size={18} className="text-amber-500" />
                                                    Entry Position Performance
                                                 </h4>
                                                <div className="flex-1 min-h-0">
                                                    <ResponsiveContainer width="100%" height="100%">
                                                        <BarChart data={contextualStats.entryPos} layout="vertical">
                                                            <XAxis type="number" hide />
                                                            <YAxis dataKey="name" type="category" width={100} tick={{fontSize: 9, fontWeight: 'bold'}} axisLine={false} tickLine={false} />
                                                            <Tooltip cursor={{fill: 'transparent'}} />
                                                            <Bar dataKey="pnl" radius={[0, 4, 4, 0]}>
                                                                {contextualStats.entryPos.map((entry, index) => (
                                                                    <Cell key={`cell-${index}`} fill={entry.pnl >= 0 ? '#10b981' : '#f43f5e'} />
                                                                ))}
                                                            </Bar>
                                                        </BarChart>
                                                    </ResponsiveContainer>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Original Heatmap & Categorical */}
                                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
                                            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col">
                                                <h4 className="font-bold text-slate-800 mb-6 text-sm uppercase tracking-wide">Category Split</h4>
                                                <div className="flex-1 flex flex-col items-center justify-center">
                                                    <ResponsiveContainer width="100%" height={200}>
                                                        <RePieChart>
                                                            <Pie
                                                                data={categoryPerformance}
                                                                cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="count"
                                                            >
                                                                <Cell fill="#3b82f6" />
                                                                <Cell fill="#8b5cf6" />
                                                            </Pie>
                                                            <Tooltip />
                                                            <Legend verticalAlign="bottom" height={36}/>
                                                        </RePieChart>
                                                    </ResponsiveContainer>
                                                    <div className="w-full space-y-3 mt-4">
                                                        {categoryPerformance.map((cat, idx) => (
                                                            <div key={cat.name} className="flex items-center justify-between text-xs border-b border-slate-50 pb-2">
                                                                <div className="flex items-center gap-2 font-bold text-slate-600">
                                                                    <div className={`w-2 h-2 rounded-full ${idx === 0 ? 'bg-blue-500' : 'bg-purple-500'}`}></div>
                                                                    {cat.name}
                                                                </div>
                                                                <div className="font-black text-slate-800">{formatCurrency(cat.pnl)}</div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
                                                <h4 className="font-bold text-slate-800 text-sm uppercase tracking-wide mb-6">Market Structure Matrix (LT vs HT)</h4>
                                                <div className="flex-1 overflow-x-auto">
                                                    <table className="w-full text-[10px]">
                                                        <thead>
                                                            <tr>
                                                                <th className="p-2 text-slate-400 uppercase font-black text-left">LT \ HT</th>
                                                                {MARKET_STRUCTURES.map(ht => (
                                                                    <th key={ht} className="p-2 text-slate-500 font-bold text-center border-l border-slate-50">
                                                                        {ht.split('-').map(s => s[0]).join('')}
                                                                        <span className="block text-[8px] font-medium opacity-60 mt-0.5">{ht}</span>
                                                                    </th>
                                                                ))}
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {MARKET_STRUCTURES.map(lt => (
                                                                <tr key={lt} className="border-t border-slate-50">
                                                                    <td className="p-2 font-bold text-slate-600 bg-slate-50">{lt}</td>
                                                                    {MARKET_STRUCTURES.map(ht => {
                                                                        const val = heatmapData[lt][ht];
                                                                        const intensity = val.count > 0 ? Math.min(Math.abs(val.pnl) / 10000, 1) : 0;
                                                                        const bgColor = val.count === 0 ? 'transparent' : 
                                                                                        val.pnl >=0 ? `rgba(16, 185, 129, ${0.05 + intensity * 0.4})` : 
                                                                                        `rgba(244, 63, 94, ${0.05 + intensity * 0.4})`;
                                                                        return (
                                                                            <td key={`${lt}-${ht}`} className="p-2 text-center border-l border-slate-50" style={{ backgroundColor: bgColor }}>
                                                                                <div className={`font-black ${val.pnl >=0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                                                                                    {val.count > 0 ? (val.pnl >= 0 ? '+' : '') + Math.round(val.pnl/1000) + 'k' : '-'}
                                                                                </div>
                                                                            </td>
                                                                        );
                                                                    })}
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            </div>
                                        </div>
                                    </>
                                ) : activeTab === 'entry' ? (
                                    <div className="max-w-3xl">
                                        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                                            <div className="flex items-center gap-3 mb-6">
                                                <div className="bg-indigo-600 p-2 rounded-xl text-white">
                                                    <BarChart3 size={18} />
                                                </div>
                                                <div>
                                                    <h3 className="font-bold text-slate-800">Entry Position Analytics</h3>
                                                    <p className="text-xs text-slate-500">Performance breakdown by entry position, LTF regime, HTF trend, exit reason and pivot sequence</p>
                                                </div>
                                            </div>
                                            <EntryMetricsDashboardFromPositions positions={filteredPositions} />
                                        </div>
                                    </div>
                                ) : (
                                    <DetailedLogView positions={filteredPositions} searchQuery={searchQuery} onSearch={setSearchQuery} />
                                )}
                            </>
                        )}
                    </div>
                </div>
        </div>
    );
}

function DetailedLogView({ positions, searchQuery, onSearch }: { positions: GroupedPosition[], searchQuery: string, onSearch: (s: string) => void }) {
    const [sortField, setSortField] = useState<keyof GroupedPosition>('entryTime');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

    const sortedPositions = useMemo(() => {
        return [...positions]
            .filter(p => {
                const search = searchQuery.toLowerCase();
                const journal = p.executions[0]?.journal;
                return p.instrument.toLowerCase().includes(search) || 
                       (journal?.notes || '').toLowerCase().includes(search) ||
                       (journal?.entrySign || '').toLowerCase().includes(search) ||
                       p.direction.toLowerCase().includes(search);
            })
            .sort((a, b) => {
                const valA = a[sortField];
                const valB = b[sortField];
                if (valA === undefined || valB === undefined) return 0;
                if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
                if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
                return 0;
            });
    }, [positions, searchQuery, sortField, sortOrder]);

    const toggleExpand = (id: string) => {
        const next = new Set(expandedIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setExpandedIds(next);
    };

    const handleSort = (field: keyof GroupedPosition) => {
        if (sortField === field) {
            setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortOrder('desc');
        }
    };

    return (
        <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between">
                <div className="relative w-96">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    <input 
                        type="text" 
                        placeholder="Search notes, signals, instruments..." 
                        className="w-full bg-white border border-slate-200 rounded-xl pl-10 pr-4 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-medium"
                        value={searchQuery}
                        onChange={(e) => onSearch(e.target.value)}
                    />
                </div>
                <div className="text-slate-500 text-sm font-bold">
                    {sortedPositions.length} Positions found
                </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-slate-50/50 border-b border-slate-100">
                                <th className="p-4 w-10"></th>
                                <TableHead label="Time" field="entryTime" currentField={sortField} onSort={handleSort} />
                                <th className="p-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Inst</th>
                                <th className="p-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Dir</th>
                                <TableHead label="PnL" field="realizedPnL" currentField={sortField} onSort={handleSort} />
                                <th className="p-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Signal</th>
                                <th className="p-4 text-xs font-bold text-slate-400 uppercase tracking-wider">LT Market</th>
                                <th className="p-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Exit Reason</th>
                                <th className="p-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Notes</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {sortedPositions.map(p => (
                                <PositionRow key={p.id} pos={p} isExpanded={expandedIds.has(p.id)} onToggle={() => toggleExpand(p.id)} />
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

function TableHead({ label, field, currentField, onSort }: { label: string, field: keyof GroupedPosition, currentField: string, onSort: (f: any) => void }) {
    return (
        <th 
            className="p-4 text-xs font-bold text-slate-400 uppercase tracking-wider cursor-pointer hover:bg-slate-100/50 transition-colors"
            onClick={() => onSort(field)}
        >
            <div className="flex items-center gap-1">
                {label}
                <ArrowUpDown size={12} className={currentField === field ? 'text-blue-500' : 'opacity-20'} />
            </div>
        </th>
    );
}

function PositionRow({ pos, isExpanded, onToggle }: { pos: GroupedPosition, isExpanded: boolean, onToggle: () => void }) {
    const journal = pos.executions[0]?.journal;
    
    return (
        <>
            <tr className={`hover:bg-slate-50/50 transition-colors cursor-pointer ${isExpanded ? 'bg-slate-50/30' : ''}`} onClick={onToggle}>
                <td className="p-4">
                    {isExpanded ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
                </td>
                <td className="p-4">
                    <div className="text-sm font-bold text-slate-700">{new Date(pos.entryTime).toLocaleDateString()}</div>
                    <div className="text-[10px] text-slate-400 font-medium">{new Date(pos.entryTime).toLocaleTimeString()}</div>
                </td>
                <td className="p-4 text-sm font-black text-slate-600 uppercase tracking-tighter">{pos.instrument}</td>
                <td className="p-4">
                    <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${pos.direction === 'LONG' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                        {pos.direction}
                    </span>
                </td>
                <td className={`p-4 text-sm font-black ${pos.realizedPnL >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {formatCurrency(pos.realizedPnL)}
                </td>
                <td className="p-4 text-xs font-bold text-slate-600">{journal?.entrySign || '-'}</td>
                <td className="p-4 text-xs font-medium text-slate-500">{journal?.ltMarket || '-'}</td>
                <td className="p-4 text-xs font-bold text-slate-600 italic uppercase opacity-60">{pos.exitReason || '-'}</td>
                <td className="p-4 text-xs text-slate-400 truncate max-w-[200px]" title={journal?.notes}>{journal?.notes || '-'}</td>
            </tr>
            {isExpanded && (
                <tr>
                    <td colSpan={9} className="p-0 bg-slate-50/20">
                        <div className="p-6 border-b border-slate-100">
                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 mb-6">
                                <div>
                                    <div className="text-[10px] font-black text-slate-400 uppercase mb-2 tracking-widest">Contextual Data</div>
                                    <div className="space-y-2">
                                        <div className="flex justify-between text-xs"><span className="text-slate-500">HT Market:</span> <span className="font-bold text-slate-700">{journal?.htMarket}</span></div>
                                        <div className="flex justify-between text-xs"><span className="text-slate-500">Entry Pos:</span> <span className="font-bold text-slate-700">{journal?.entryPosition}</span></div>
                                        <div className="flex justify-between text-xs"><span className="text-slate-500">LLHH Pivot:</span> <span className="font-bold text-slate-700">{journal?.llhhPivot}</span></div>
                                    </div>
                                </div>
                                <div>
                                    <div className="text-[10px] font-black text-slate-400 uppercase mb-2 tracking-widest">Alignment</div>
                                    <div className="space-y-2">
                                        <div className="flex justify-between text-xs"><span className="text-slate-500">Sys Entry:</span> <span className={`font-bold ${journal?.systemEntryAlign === 'Yes' ? 'text-emerald-500' : 'text-rose-500'}`}>{journal?.systemEntryAlign}</span></div>
                                        <div className="flex justify-between text-xs"><span className="text-slate-500">View Entry:</span> <span className={`font-bold ${journal?.myViewEntryAlign === 'Yes' ? 'text-emerald-500' : 'text-rose-500'}`}>{journal?.myViewEntryAlign}</span></div>
                                    </div>
                                </div>
                                <div className="col-span-2">
                                    <div className="text-[10px] font-black text-slate-400 uppercase mb-2 tracking-widest">Journal Notes</div>
                                    <p className="text-sm text-slate-600 leading-relaxed italic">"{journal?.notes || 'No notes provided for this trade.'}"</p>
                                </div>
                            </div>
                            
                            <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
                                <table className="w-full text-left">
                                    <thead className="bg-slate-50 text-[10px] uppercase font-black text-slate-400 border-b border-slate-100">
                                        <tr>
                                            <th className="p-3">Execution Time</th>
                                            <th className="p-3">Type</th>
                                            <th className="p-3 text-right">Price</th>
                                            <th className="p-3 text-right">Qty</th>
                                            <th className="p-3 text-right">Action P&L</th>
                                            <th className="p-3 text-center">Screenshot</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-50">
                                        {pos.executions.map((ex, i) => (
                                            <tr key={i} className="text-xs">
                                                <td className="p-3 text-slate-500">{new Date(ex.timestamp).toLocaleString()}</td>
                                                <td className="p-3"><span className={`font-bold ${ex.type === 'BUY' ? 'text-emerald-600' : 'text-rose-600'}`}>{ex.type}</span></td>
                                                <td className="p-3 text-right font-mono text-slate-700">{formatCurrency(ex.price)}</td>
                                                <td className="p-3 text-right font-mono text-slate-500">{ex.quantity}</td>
                                                <td className={`p-3 text-right font-bold ${ex.pnl && ex.pnl > 0 ? 'text-emerald-600' : ex.pnl && ex.pnl < 0 ? 'text-rose-600' : 'text-slate-400'}`}>
                                                    {ex.pnl ? formatCurrency(ex.pnl) : '-'}
                                                </td>
                                                <td className="p-3 text-center">
                                                    {ex.journal?.screenshotUrl && (
                                                        <a href={ex.journal.screenshotUrl} target="_blank" rel="noreferrer" className="text-blue-500 hover:text-blue-700 transition-colors">
                                                            <LinkIcon size={14} />
                                                        </a>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </td>
                </tr>
            )}
        </>
    );
}
