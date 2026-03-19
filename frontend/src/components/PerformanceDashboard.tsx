import { useEffect, useMemo, useState } from 'react';
import { 
  X, TrendingUp, TrendingDown, Activity, Target, 
  BarChart3, Filter, Download as DownloadIcon,
  Layers, ArrowUpRight, ArrowDownRight, Info
} from 'lucide-react';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell, PieChart as RePieChart, Pie, Legend
} from 'recharts';
import { getStoredSessions, type TradeSession } from '../utils/tradeStorage';
import { groupTradesIntoPositions, calculatePerformanceStats, type GroupedPosition } from '../utils/tradeAnalysis';
import { formatCurrency } from '../utils/formatters';
import type { Trade } from '../types';

interface PerformanceDashboardProps {
    isOpen: boolean;
    onClose: () => void;
    liveTrades?: Trade[];
    liveInstrument?: string;
}

const MARKET_STRUCTURES = [
    'Bull-Trend', 'Range', 'Bear-Trend', 'Bear-Reversal', 
    'Bull-Reversal', 'Bear-Trending-range', 'Bull-Trending-range'
];

export function PerformanceDashboard({ isOpen, onClose, liveTrades, liveInstrument }: PerformanceDashboardProps) {
    const [sessions, setSessions] = useState<TradeSession[]>([]);
    const [selectedInstrument, setSelectedInstrument] = useState<string>('All');
    const [selectedCategory, setSelectedCategory] = useState<string>('All');
    const [dateRange, setDateRange] = useState<{ from: string; to: string }>({ from: '', to: '' });

    useEffect(() => {
        if (isOpen) {
            setSessions(getStoredSessions());
            if (liveInstrument) {
                setSelectedInstrument(liveInstrument);
            }
        }
    }, [isOpen, liveInstrument]);

    // Consolidate all trades from selected filters
    const filteredPositions = useMemo(() => {
        let allPos: GroupedPosition[] = [];
        
        // 1. Process Saved Sessions
        sessions.forEach(s => {
            const pos = groupTradesIntoPositions(s.trades);
            allPos = [...allPos, ...pos];
        });

        // 2. Process Live Session if available
        if (liveTrades && liveTrades.length > 0) {
            const livePos = groupTradesIntoPositions(liveTrades);
            allPos = [...allPos, ...livePos];
        }

        return allPos.filter(p => {
            const matchInstrument = selectedInstrument === 'All' || p.instrument === selectedInstrument;
            const entryExec = p.executions[0];
            const category = entryExec?.journal?.tradeCategory || 'Discretionary';
            const matchCategory = selectedCategory === 'All' || category === selectedCategory;
            
            const posDate = new Date(p.entryTime * 1000);
            
            // Robust date comparison using YYYY-MM-DD strings to avoid TZ issues
            // This matches the precision of the HTML5 date input
            const posDateStr = posDate.getFullYear() + '-' + 
                               String(posDate.getMonth() + 1).padStart(2, '0') + '-' + 
                               String(posDate.getDate()).padStart(2, '0');

            const matchFrom = !dateRange.from || posDateStr >= dateRange.from;
            const matchTo = !dateRange.to || posDateStr <= dateRange.to;

            return matchInstrument && matchCategory && matchFrom && matchTo;
        }).sort((a,b) => a.entryTime - b.entryTime);
    }, [sessions, selectedInstrument, selectedCategory, dateRange, liveTrades, liveInstrument]);

    const stats = useMemo(() => calculatePerformanceStats(filteredPositions), [filteredPositions]);

    const instruments = useMemo(() => {
        const set = new Set<string>();
        sessions.forEach(s => set.add(s.instrument));
        if (liveInstrument) set.add(liveInstrument);
        return ['All', ...Array.from(set)];
    }, [sessions, liveInstrument]);

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

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-[2500] p-4 font-sans">
            <div className="bg-slate-50 rounded-2xl shadow-2xl w-full max-w-7xl h-[95vh] flex flex-col overflow-hidden border border-white/20">
                {/* Header */}
                <div className="flex items-center justify-between p-6 bg-white border-b border-slate-200">
                    <div className="flex items-center gap-4">
                        <div className="bg-blue-600 p-2.5 rounded-xl text-white shadow-lg shadow-blue-200">
                            <Activity size={24} />
                        </div>
                        <div>
                            <h2 className="text-2xl font-bold text-slate-800 tracking-tight">Performance Analytics</h2>
                            <p className="text-slate-500 text-sm font-medium">Detailed insights into your backtesting strategy</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200">
                            <button className="px-4 py-1.5 text-sm font-bold text-blue-700 bg-white rounded-md shadow-sm">Dashboard</button>
                            <button className="px-4 py-1.5 text-sm font-bold text-slate-500 hover:text-slate-700">Detailed Log</button>
                        </div>
                        <button 
                            onClick={onClose}
                            className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-400"
                        >
                            <X size={24} />
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
                                    <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5 tracking-tighter">From Date</label>
                                    <input 
                                        type="date"
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-medium text-slate-600"
                                        value={dateRange.from}
                                        onChange={(e) => setDateRange(prev => ({ ...prev, from: e.target.value }))}
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5 tracking-tighter">To Date</label>
                                    <input 
                                        type="date"
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-medium text-slate-600"
                                        value={dateRange.to}
                                        onChange={(e) => setDateRange(prev => ({ ...prev, to: e.target.value }))}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="mt-auto pt-6 border-t border-slate-100">
                            <button className="w-full flex items-center justify-center gap-2 bg-slate-800 text-white rounded-xl py-3 text-sm font-bold shadow-lg shadow-slate-200 hover:bg-slate-900 transition-all cursor-pointer">
                                <DownloadIcon size={18} />
                                Export Report
                            </button>
                        </div>
                    </div>

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
                                                        labelFormatter={(ts) => new Date(ts).toLocaleString()}
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

                                {/* Heatmap & Categorical */}
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
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
