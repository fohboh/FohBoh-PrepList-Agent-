
import React, { useState, useEffect, useRef, useMemo } from 'react';
import Sidebar from './components/Sidebar';
import ForecastChart from './components/ForecastChart';
import MiniTrendChart from './components/MiniTrendChart';
import { 
  INITIAL_PREP_ITEMS, 
  INITIAL_INVENTORY, 
  INITIAL_WASTE, 
  MOCK_FORECAST, 
  MENU_ITEMS,
  Icons 
} from './constants';
import { PrepItem, InventoryItem, WasteEntry, MenuItem, SpecialEvent, DaypartConfig, WasteReasonCode, WasteCategory } from './types';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';

// Audio Utility Functions (Manual Base64 and PCM handling)
function decode(base64: string) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
  return bytes;
}
function encode(bytes: Uint8Array) {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
async function decodeAudioData(data: Uint8Array, ctx: AudioContext, sampleRate: number, numChannels: number): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
  }
  return buffer;
}

const Tooltip: React.FC<{ what: string, source: string, why: string, align?: 'left' | 'right' | 'center' }> = ({ what, source, why, align = 'center' }) => {
  const alignClasses = { left: 'left-0 translate-x-0', right: 'right-0 -translate-x-full left-full', center: 'left-1/2 -translate-x-1/2' };
  const arrowClasses = { left: 'left-2', right: 'right-2', center: 'left-1/2 -translate-x-1/2' };
  return (
    <div className="group relative inline-block ml-1">
      <div className="cursor-help text-slate-400 hover:text-indigo-600 transition-colors"><Icons.Info /></div>
      <div className={`absolute top-full mt-3 hidden group-hover:block w-72 p-4 bg-slate-900 text-white text-[11px] rounded-2xl shadow-2xl z-[100] ${alignClasses[align]}`}>
        <div className="space-y-3">
          <div><span className="font-bold text-indigo-400 block uppercase tracking-widest text-[9px] mb-1">What it is</span><p className="leading-relaxed opacity-90">{what}</p></div>
          <div><span className="font-bold text-indigo-400 block uppercase tracking-widest text-[9px] mb-1">Source</span><p className="leading-relaxed opacity-90">{source}</p></div>
          <div><span className="font-bold text-indigo-400 block uppercase tracking-widest text-[9px] mb-1">Why needed</span><p className="leading-relaxed opacity-90">{why}</p></div>
        </div>
        <div className={`absolute bottom-full border-8 border-transparent border-b-slate-900 ${arrowClasses[align]}`}></div>
      </div>
    </div>
  );
};

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState('home');
  const [prepItems, setPrepItems] = useState<PrepItem[]>(INITIAL_PREP_ITEMS);
  const [inventory, setInventory] = useState<InventoryItem[]>(INITIAL_INVENTORY);
  const [wasteLogs, setWasteLogs] = useState<WasteEntry[]>(INITIAL_WASTE);
  const [menuItems, setMenuItems] = useState<MenuItem[]>(MENU_ITEMS);
  
  // Daypart Configuration
  const [dayparts, setDayparts] = useState<Record<string, DaypartConfig>>({
    breakfast: { volume: 50, avgCheck: 12.50 },
    lunch: { volume: 120, avgCheck: 18.75 },
    dinner: { volume: 180, avgCheck: 28.50 }
  });

  const [specialEvents, setSpecialEvents] = useState<SpecialEvent[]>([
    { id: 'e1', name: 'Downtown Farmers Market', coverIncrease: 1.15, menuFocus: 'Breakfast' },
    { id: 'e2', name: 'Marathon Sunday', coverIncrease: 1.40, menuFocus: 'Carb Loading' }
  ]);

  const eventMultiplier = useMemo(() => {
    return specialEvents.reduce((acc, event) => acc * event.coverIncrease, 1);
  }, [specialEvents]);

  const totalTargetVolume = useMemo(() => {
    const rawVolume = dayparts.breakfast.volume + dayparts.lunch.volume + dayparts.dinner.volume;
    return Math.round(rawVolume * eventMultiplier);
  }, [dayparts, eventMultiplier]);

  const totalSalesForecast = useMemo(() => {
    const rawSales = 
      (dayparts.breakfast.volume * dayparts.breakfast.avgCheck) +
      (dayparts.lunch.volume * dayparts.lunch.avgCheck) +
      (dayparts.dinner.volume * dayparts.dinner.avgCheck);
    return rawSales * eventMultiplier;
  }, [dayparts, eventMultiplier]);
  
  const calculatePrepNeed = (item: PrepItem, totalTarget: number, wasteData: WasteEntry[]) => {
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long' });
    const historicalAvg = item.forecastNeeded;
    const multipliers: Record<string, number> = { 
      'Monday': 0.70, 'Tuesday': 0.75, 'Wednesday': 0.80, 
      'Thursday': 1.05, 'Friday': 1.25, 'Saturday': 1.30, 'Sunday': 1.15 
    };
    const dowMultiplier = multipliers[today] || 1.0;
    
    let adjustedNeed = historicalAvg;
    if (['Monday', 'Tuesday', 'Wednesday'].includes(today)) {
      adjustedNeed = historicalAvg * 0.333; 
    }
    adjustedNeed *= dowMultiplier;

    const buffers: Record<string, number> = {
      'Protein': item.costPerUnit > 10 ? 1.15 : 1.20,
      'Produce': 1.25,
      'Staples': 1.10,
      'Sauce': 1.30,
      'Other': 1.20
    };
    const buffer = buffers[item.category] || 1.20;
    let bufferedNeed = adjustedNeed * buffer;

    const itemWaste = wasteData.filter(w => w.itemName === item.name);
    const totalWasted = itemWaste.reduce((sum, w) => sum + w.quantity, 0);
    const wasteRatio = totalWasted / (item.prepNeeded || 1);
    
    if (wasteRatio > 0.25) bufferedNeed *= 0.80; 
    else if (wasteRatio > 0.15 && item.costPerUnit > 10) bufferedNeed *= 0.85; 
    else if (wasteRatio > 0.15) bufferedNeed *= 0.90; 
    else if (wasteRatio < 0.05) bufferedNeed *= 1.10; 

    let toPrep = Math.ceil(bufferedNeed - item.currentStock);
    toPrep = Math.max(0, toPrep);

    if (item.shelfLifeDays <= 1) {
      toPrep = Math.min(toPrep, Math.ceil(historicalAvg * 1.5));
    }
    
    const explanation = `${historicalAvg} (Avg) × ${dowMultiplier} (DOW) × ${buffer} (Buf) - ${item.currentStock} (Inv) = ${toPrep}`;
    return { amount: toPrep, explanation };
  };

  const calculatePriorityScore = (item: PrepItem) => {
    const shelfLifeMod = item.shelfLifeDays < 1 ? 5 : item.shelfLifeDays <= 2 ? 3 : 1;
    return (item.itemCriticality * 2) + (item.prepTimeMinutes / 10) + shelfLifeMod;
  };

  const stations = useMemo(() => {
    const groups: Record<string, PrepItem[]> = {};
    prepItems.forEach(item => {
      const calc = calculatePrepNeed(item, totalTargetVolume, wasteLogs);
      const score = calculatePriorityScore(item);
      const updated = { 
        ...item, 
        prepNeeded: calc.amount, 
        whyExplanation: calc.explanation,
        priority: score > 15 ? 'High' : score > 8 ? 'Medium' : 'Low'
      } as PrepItem;
      if (!groups[item.station]) groups[item.station] = [];
      groups[item.station].push(updated);
    });
    Object.keys(groups).forEach(k => groups[k].sort((a, b) => calculatePriorityScore(b) - calculatePriorityScore(a)));
    return groups;
  }, [prepItems, totalTargetVolume, wasteLogs]);

  const toggleItemStatus = (id: string) => {
    setPrepItems(prev => prev.map(item => item.id === id ? { ...item, status: item.status === 'Pending' ? 'In-Progress' : item.status === 'In-Progress' ? 'Completed' : 'Pending' } : item));
  };

  const handleDaypartChange = (dp: string, field: keyof DaypartConfig, val: string) => {
    const num = parseFloat(val) || 0;
    setDayparts(prev => ({ ...prev, [dp]: { ...prev[dp], [field]: num } }));
  };

  const [showWasteForm, setShowWasteForm] = useState(false);
  const [newWaste, setNewWaste] = useState<Partial<WasteEntry>>({
    reasonCode: 'OVERPRODUCTION',
    category: 'Pre-Consumer',
    shift: 'PM',
    disposalMethod: 'Compost'
  });

  const logWasteEntry = () => {
    if (!newWaste.itemName || !newWaste.quantity) return;
    const entry: WasteEntry = {
      id: `w_${Date.now()}`,
      itemName: newWaste.itemName as string,
      itemType: 'Prepared Item',
      quantity: Number(newWaste.quantity),
      unit: 'kg',
      reason: newWaste.reason || 'Overproduction detected',
      reasonCode: (newWaste.reasonCode as WasteReasonCode) || 'OVERPRODUCTION',
      category: 'Pre-Consumer',
      station: 'Kitchen',
      shift: 'PM',
      staffInitials: 'CH',
      timestamp: new Date().toISOString(),
      costPerUnit: 1.5,
      totalCost: Number(newWaste.quantity) * 1.5,
      disposalMethod: 'Compost'
    };
    setWasteLogs(prev => [entry, ...prev]);
    setShowWasteForm(false);
  };

  const totalWasteCost = useMemo(() => wasteLogs.reduce((sum, w) => sum + w.totalCost, 0), [wasteLogs]);

  const [isLiveActive, setIsLiveActive] = useState(false);
  const [transcription, setTranscription] = useState<{user: string, agent: string}[]>([]);
  const [currentAgentText, setCurrentAgentText] = useState('');
  const [currentUserText, setCurrentUserText] = useState('');
  const sessionRef = useRef<any>(null);

  const startLiveSession = async () => {
    if (isLiveActive) { sessionRef.current?.close(); setIsLiveActive(false); return; }
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    
    const sessionPromise = ai.live.connect({
      model: 'gemini-2.5-flash-native-audio-preview-12-2025',
      callbacks: {
        onopen: () => setIsLiveActive(true),
        onmessage: async (message: LiveServerMessage) => {
          if (message.serverContent?.outputTranscription) setCurrentAgentText(p => p + message.serverContent!.outputTranscription!.text);
          else if (message.serverContent?.inputTranscription) setCurrentUserText(p => p + message.serverContent!.inputTranscription!.text);
          if (message.serverContent?.turnComplete) { 
            setTranscription(prev => [...prev, { user: currentUserText, agent: currentAgentText }]); 
            setCurrentUserText(''); setCurrentAgentText(''); 
          }
        },
        onclose: () => setIsLiveActive(false),
      },
      config: {
        responseModalities: [Modality.AUDIO],
        outputAudioTranscription: {},
        inputAudioTranscription: {},
        systemInstruction: "You are the PrepList Agent™. Logic: Base × Day Multiplier × Buffer - Inventory. Total sales forecast is $" + totalSalesForecast.toFixed(2)
      }
    });
    sessionRef.current = await sessionPromise;
  };

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-[#f8fafc]">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      
      <main className="flex-1 md:ml-64 flex flex-col h-screen overflow-hidden">
        <header className="p-4 md:p-6 bg-white border-b flex justify-between items-center shrink-0 shadow-sm relative z-40">
          <div>
            <h1 className="text-xl font-black text-slate-900 flex items-center gap-2">
              <span className="p-1.5 bg-indigo-600 text-white rounded-lg"><Icons.ChefHat /></span>
              PrepList Agent™
            </h1>
            <p className="text-[10px] text-indigo-600 font-black uppercase tracking-wider">Deterministic Intelligence</p>
          </div>
          <button onClick={startLiveSession} className={`flex items-center gap-2 px-6 py-2.5 rounded-2xl font-black transition-all shadow-lg active:scale-95 ${isLiveActive ? 'bg-rose-500 text-white animate-pulse' : 'bg-slate-900 text-white hover:bg-indigo-600'}`}>
            {isLiveActive ? <Icons.MicOff /> : <Icons.Mic />}
            {isLiveActive ? 'Listening...' : 'Talk to Agent'}
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-12 flex flex-col relative z-10 bg-[#f8fafc]">
          {activeTab === 'home' && (
            <div className="max-w-6xl mx-auto space-y-16 animate-in pb-10">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center mt-8">
                <div className="space-y-6">
                  <div className="inline-block bg-indigo-50 text-indigo-700 px-4 py-1.5 rounded-full text-xs font-black uppercase tracking-widest border border-indigo-100">Welcome to FohBoh™</div>
                  <h2 className="text-5xl md:text-6xl font-black text-slate-900 leading-[1.1]">The Future of <span className="text-indigo-600">Kitchen Execution.</span></h2>
                  <p className="text-lg text-slate-700 font-medium max-w-lg leading-relaxed">PrepList Agent™ uses deterministic rules and sales forecasts to synchronize your kitchen operations perfectly.</p>
                  <div className="flex flex-wrap gap-4 pt-4">
                    <button onClick={() => setActiveTab('get-started')} className="bg-emerald-600 hover:bg-emerald-700 text-white px-8 py-4 rounded-2xl font-black shadow-xl transition-all active:scale-95">Get Started Now</button>
                    <button onClick={() => setActiveTab('dashboard')} className="bg-white border-4 border-slate-900 text-slate-900 px-8 py-4 rounded-2xl font-black hover:bg-slate-900 hover:text-white transition-all active:scale-95">View Dashboard</button>
                  </div>
                </div>
                <div className="bg-slate-900 p-8 rounded-[3rem] shadow-2xl border-4 border-white rotate-2 hover:rotate-0 transition-all duration-500">
                  <div className="flex items-center gap-4 mb-6">
                    <div className="w-12 h-12 bg-indigo-600 text-white rounded-2xl flex items-center justify-center font-black">KM</div>
                    <div><p className="font-bold text-white">Agent Insight</p><p className="text-xs text-indigo-400 font-black uppercase tracking-widest">99% RULE-MATCH</p></div>
                  </div>
                  <p className="italic text-slate-300 leading-relaxed font-medium">"System detected Friday multi-event spike. Recommended Protein buffer adjusted to 1.15x to ensure zero stockouts during peak service."</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                {[
                  { title: "Reduce Waste", desc: "Automated adjustments based on historical overprep logs.", icon: <Icons.Trash />, color: "bg-rose-600" },
                  { title: "Boost Efficiency", desc: "Station-specific tasks sorted by priority and knife-skill level.", icon: <Icons.ChefHat />, color: "bg-indigo-600" },
                  { title: "Deterministic Logic", desc: "Hard rules paired with AI insights for 100% reliable pars.", icon: <Icons.Dashboard />, color: "bg-emerald-600" }
                ].map((feature, i) => (
                  <div key={i} className="bg-white p-8 rounded-3xl border-4 border-slate-50 shadow-sm hover:shadow-xl transition-all group">
                    <div className={`w-14 h-14 ${feature.color} text-white rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform shadow-lg`}>{feature.icon}</div>
                    <h4 className="text-xl font-black text-slate-900 mb-2 uppercase tracking-tight">{feature.title}</h4>
                    <p className="text-slate-600 font-medium text-sm leading-relaxed">{feature.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'dashboard' && (
            <div className="max-w-7xl mx-auto space-y-8 animate-in pb-10">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                <div className="bg-white p-8 rounded-3xl border-4 border-slate-900 shadow-xl">
                  <h3 className="text-slate-500 font-black uppercase tracking-widest text-xs mb-2">Inventory Outages</h3>
                  <p className="text-5xl font-black text-rose-600">3 Items</p>
                  <p className="text-xs text-slate-400 font-bold mt-2 uppercase tracking-tight">Requires Immediate Butcher Sync</p>
                </div>
                <div className="bg-white p-8 rounded-3xl border-4 border-slate-900 shadow-xl">
                  <h3 className="text-slate-500 font-black uppercase tracking-widest text-xs mb-2">Period Sales Forecast</h3>
                  <p className="text-5xl font-black text-slate-950">${totalSalesForecast.toLocaleString()}</p>
                  <p className="text-xs text-indigo-600 font-bold mt-2 uppercase tracking-tight">Based on {totalTargetVolume} Target Covers</p>
                </div>
                <div className="bg-slate-950 p-8 rounded-3xl shadow-xl text-white">
                  <h3 className="text-slate-400 font-black uppercase tracking-widest text-xs mb-2">Waste Prevention (24h)</h3>
                  <p className="text-5xl font-black text-emerald-400">${(totalWasteCost * 0.4).toFixed(2)}</p>
                  <p className="text-xs text-slate-500 font-bold mt-2 uppercase tracking-tight">Rules Adjusted: -12% Overprep</p>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 bg-white p-10 rounded-[3rem] border-4 border-slate-900 shadow-xl overflow-visible">
                  <h3 className="font-black text-slate-900 text-xl mb-8 uppercase tracking-tighter italic">Sales Variance Map</h3>
                  <ForecastChart data={MOCK_FORECAST} />
                </div>
                <div className="bg-white p-10 rounded-[3rem] border-4 border-slate-900 shadow-xl overflow-visible">
                  <h3 className="font-black text-slate-900 text-xl mb-8 uppercase tracking-tighter italic">Operational Data Hub</h3>
                  <div className="space-y-6">
                    {[
                      { name: 'Toast POS Sync', status: 'Healthy', time: 'Real-time', color: 'bg-emerald-500' },
                      { name: 'IMS Inventory', status: 'Synced', time: '14m ago', color: 'bg-emerald-500' },
                      { name: 'Labor Matrix', status: 'Updating', time: 'Just now', color: 'bg-indigo-500' },
                      { name: 'Weather Local', status: 'Healthy', time: '1h ago', color: 'bg-emerald-500' }
                    ].map(source => (
                      <div key={source.name} className="flex items-center gap-5 p-5 border-2 border-slate-100 rounded-3xl bg-slate-50/50">
                        <div className={`w-3.5 h-3.5 rounded-full ${source.color} animate-pulse shadow-lg`}></div>
                        <div>
                          <p className="text-sm font-black text-slate-950 uppercase tracking-tight">{source.name}</p>
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{source.status} • {source.time}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'preplist' && (
            <div className="max-w-7xl mx-auto space-y-10 animate-in pb-10">
              <div className="flex justify-between items-end border-b-8 border-slate-900 pb-6">
                <div>
                   <h2 className="text-5xl font-black text-slate-900 tracking-tight uppercase">Daily Prep Execution</h2>
                   <p className="text-indigo-600 font-black uppercase tracking-widest text-xs">Synchronized by PrepList Agent™</p>
                </div>
              </div>

              {Object.entries(stations).map(([station, items]) => (
                <div key={station} className="bg-white rounded-[3rem] border-4 border-slate-900 shadow-xl overflow-hidden mb-12 hover:border-indigo-600 transition-all">
                  <div className="p-8 border-b-4 border-slate-900 bg-slate-50 flex justify-between items-center">
                     <h3 className="font-black text-slate-950 uppercase tracking-[0.2em] text-sm">Station: {station}</h3>
                     <span className="text-[10px] font-black text-slate-400 uppercase">{items.length} Items Pending</span>
                  </div>
                  <div className="divide-y-4 divide-slate-100">
                    {items.map(item => (
                      <div key={item.id} className="p-8 hover:bg-slate-50 transition-colors flex flex-col md:flex-row gap-8">
                        <div className="flex-1">
                          <div className="flex items-center gap-4 mb-2">
                            <h4 className="text-2xl font-black text-slate-950 uppercase tracking-tight">{item.name}</h4>
                            <span className={`text-[10px] font-black uppercase px-3 py-1 rounded-full ${item.priority === 'High' ? 'bg-rose-100 text-rose-600' : 'bg-slate-100 text-slate-500'}`}>{item.priority} Priority</span>
                          </div>
                          <p className="text-xs text-indigo-700 font-bold font-mono tracking-tight bg-indigo-50 inline-block px-2 py-1 rounded-lg">Rule: {item.whyExplanation}</p>
                        </div>
                        <div className="flex items-center gap-6">
                          <div className="bg-slate-950 px-6 py-3 rounded-2xl text-center min-w-[140px] shadow-lg">
                            <span className="text-[10px] font-black text-slate-500 uppercase block tracking-widest mb-1">Target Prep</span>
                            <span className="text-2xl font-black text-white">{item.prepNeeded} {item.unit}</span>
                          </div>
                          <button onClick={() => toggleItemStatus(item.id)} className={`px-8 py-3 rounded-2xl border-4 font-black transition-all text-sm uppercase tracking-widest active:scale-95 ${item.status === 'Completed' ? 'bg-emerald-500 border-emerald-600 text-white shadow-lg' : 'bg-white border-slate-200 text-slate-400 hover:border-slate-900 hover:text-slate-900'}`}>
                            {item.status === 'Completed' ? 'Finished' : 'Mark Done'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'inventory' && (
            <div className="max-w-5xl mx-auto space-y-10 animate-in pb-10">
              <div className="flex justify-between items-end border-b-8 border-slate-900 pb-6">
                <div>
                   <h2 className="text-5xl font-black text-slate-900 tracking-tight uppercase">Current Shelf Stock</h2>
                   <p className="text-indigo-600 font-black uppercase tracking-widest text-xs">Section 2: Inventory Offset Engine</p>
                </div>
              </div>

              <div className="bg-white rounded-[3.5rem] border-4 border-slate-900 shadow-xl overflow-hidden divide-y-4 divide-slate-100">
                {inventory.map(item => (
                  <div key={item.id} className="p-8 flex justify-between items-center hover:bg-slate-50 transition-colors group">
                    <div className="flex items-center gap-6">
                      <div className={`w-14 h-14 rounded-2xl flex items-center justify-center font-black ${item.currentStock < item.threshold ? 'bg-rose-100 text-rose-600 animate-pulse' : 'bg-indigo-100 text-indigo-600'}`}>
                        {item.currentStock < item.threshold ? '!' : '✓'}
                      </div>
                      <div>
                        <p className="font-black text-slate-950 text-2xl uppercase tracking-tight">{item.name}</p>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Cat: {item.category}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="flex items-end gap-2 justify-end">
                        <p className={`font-black text-4xl leading-none ${item.currentStock < item.threshold ? 'text-rose-600' : 'text-slate-950'}`}>{item.currentStock}</p>
                        <p className="text-sm font-black text-slate-400 uppercase tracking-widest mb-1">/ {item.threshold} {item.unit}</p>
                      </div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mt-2">Available vs Threshold</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'agent' && (
            <div className="max-w-4xl mx-auto space-y-8 animate-in pb-10">
              <div className="bg-white rounded-[4rem] border-4 border-slate-900 shadow-2xl p-12 flex flex-col items-center relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-2 bg-indigo-600"></div>
                
                <div className={`w-32 h-32 rounded-full flex items-center justify-center mb-8 relative ${isLiveActive ? 'bg-indigo-50' : 'bg-slate-50'}`}>
                   {isLiveActive && <div className="absolute inset-0 rounded-full border-4 border-indigo-600 animate-ping opacity-20"></div>}
                   <div className="w-20 h-20 bg-slate-900 text-white rounded-full flex items-center justify-center shadow-2xl relative z-10"><Icons.Bot /></div>
                </div>

                <h2 className="text-4xl font-black text-slate-950 uppercase tracking-tighter italic mb-2 text-center">PrepList Agent™ <br/> Interface</h2>
                <p className="text-slate-600 font-medium mb-10 text-center text-lg max-w-md">Conversational intelligence for par adjustments and inventory logging.</p>
                
                <div className="w-full space-y-6 max-h-[500px] overflow-y-auto px-6 custom-scrollbar pb-10 bg-slate-50 rounded-[3rem] p-10 border-2 border-slate-100">
                  {transcription.length === 0 && !currentAgentText && !currentUserText && (
                    <div className="text-center py-20 space-y-4">
                       <p className="text-slate-400 font-black uppercase tracking-widest text-xs">Waiting for voice session...</p>
                       <p className="text-slate-300 italic font-medium">Try asking: "What are the protein pars for Saturday?"</p>
                    </div>
                  )}
                  {transcription.map((t, i) => (
                    <div key={i} className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
                      <div className="flex justify-end">
                        <div className="bg-indigo-600 text-white px-8 py-5 rounded-[2.5rem] rounded-tr-none text-lg font-bold shadow-xl max-w-[85%] border-b-4 border-indigo-800">
                          {t.user}
                        </div>
                      </div>
                      <div className="flex justify-start">
                        <div className="bg-white border-4 border-slate-900 text-slate-950 px-8 py-5 rounded-[2.5rem] rounded-tl-none text-lg font-black shadow-xl max-w-[85%] italic">
                          {t.agent}
                        </div>
                      </div>
                    </div>
                  ))}
                  {(currentAgentText || currentUserText) && (
                    <div className="flex flex-col items-center gap-4 py-8">
                       <div className="flex gap-1">
                          <span className="w-2 h-2 bg-indigo-600 rounded-full animate-bounce"></span>
                          <span className="w-2 h-2 bg-indigo-600 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                          <span className="w-2 h-2 bg-indigo-600 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                       </div>
                       <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest">Processing Real-time Audio Stream</p>
                    </div>
                  )}
                </div>
                
                {!isLiveActive && (
                  <button onClick={startLiveSession} className="mt-10 bg-indigo-600 text-white px-12 py-5 rounded-[2rem] font-black text-xl shadow-2xl hover:bg-indigo-700 transition-all active:scale-95 flex items-center gap-4">
                     <Icons.Mic /> Initiate Voice Command
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Restored Inputs (High Contrast) */}
          {activeTab === 'inputs' && (
            <div className="max-w-6xl mx-auto space-y-12 animate-in pb-20">
              <div className="flex justify-between items-end border-b-8 border-slate-900 pb-6">
                 <div>
                   <h2 className="text-5xl font-black text-slate-900 tracking-tight uppercase">Daily Required Fields</h2>
                   <p className="text-indigo-600 font-black uppercase tracking-widest text-xs">Section 1: Forecasting Variables</p>
                 </div>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                {Object.entries(dayparts).map(([name, config]) => (
                  <div key={name} className="bg-white rounded-[3.5rem] border-8 border-slate-900 shadow-2xl p-10 space-y-8 hover:-translate-y-2 transition-transform">
                    <h3 className="font-black text-slate-950 uppercase tracking-[0.2em] text-sm flex items-center gap-2">
                       <span className="w-3 h-3 bg-indigo-600 rounded-full"></span>
                       {name} Shift
                    </h3>
                    <div className="space-y-6">
                      <div className="group">
                        <label className="block text-xs font-black text-slate-950 uppercase mb-2 tracking-widest">Projected Covers</label>
                        <input 
                          type="number" 
                          value={config.volume} 
                          onChange={(e) => handleDaypartChange(name, 'volume', e.target.value)} 
                          className="w-full bg-slate-50 border-4 border-slate-900 rounded-[1.5rem] px-6 py-5 text-4xl font-black text-black focus:bg-indigo-50 focus:border-indigo-600 transition-all outline-none" 
                        />
                      </div>
                      <div className="group">
                        <label className="block text-xs font-black text-slate-950 uppercase mb-2 tracking-widest">Target Avg Check ($)</label>
                        <input 
                          type="number" 
                          step="0.01" 
                          value={config.avgCheck} 
                          onChange={(e) => handleDaypartChange(name, 'avgCheck', e.target.value)} 
                          className="w-full bg-slate-50 border-4 border-slate-900 rounded-[1.5rem] px-6 py-5 text-4xl font-black text-black focus:bg-indigo-50 focus:border-indigo-600 transition-all outline-none" 
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="bg-indigo-600 rounded-[4rem] p-12 shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 right-0 p-10 opacity-10"><Icons.Bot /></div>
                <div className="flex flex-col md:flex-row justify-between items-center gap-10">
                  <div className="text-white">
                    <h3 className="text-3xl font-black uppercase tracking-tight mb-2 italic underline decoration-indigo-300 decoration-8 underline-offset-8">Special Event Flags</h3>
                    <p className="text-indigo-100 font-medium">Events detected by PrepList Agent™ based on your location and calendar.</p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full md:w-auto">
                    {specialEvents.map(event => (
                      <div key={event.id} className="bg-white/10 backdrop-blur-md border-2 border-white/20 p-6 rounded-[2rem] flex flex-col justify-center min-w-[240px]">
                        <p className="font-black text-white text-lg tracking-tight leading-none mb-1">{event.name}</p>
                        <p className="text-[10px] font-black text-indigo-200 uppercase tracking-widest">+{Math.round((event.coverIncrease - 1) * 100)}% Forecast Multiplier</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Restored Help/FAQ (High Contrast) */}
          {activeTab === 'help' && (
            <div className="max-w-5xl mx-auto space-y-16 animate-in pb-20">
              <div className="text-center space-y-4 border-b-8 border-slate-900 pb-10">
                <h2 className="text-6xl font-black text-slate-900 tracking-tighter uppercase">Operations Hub</h2>
                <p className="text-slate-700 text-xl font-bold italic">Mastering the Deterministic Logic Framework</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                <div className="bg-indigo-50 p-12 rounded-[4rem] border-4 border-indigo-600 shadow-xl space-y-8">
                  <div className="w-20 h-20 bg-indigo-600 text-white rounded-3xl flex items-center justify-center shadow-lg"><Icons.Trend /></div>
                  <h4 className="text-3xl font-black text-indigo-900 uppercase tracking-tight leading-none italic">How Pars are Calculated</h4>
                  <p className="text-indigo-800 font-medium leading-relaxed text-lg">PrepList Agent™ uses a 100% traceable engine. We never hide the 'why' behind a par level.</p>
                  <ul className="space-y-4">
                    {[
                      { l: "Base Demand", v: "Derived from Daypart volume targets." },
                      { l: "DOW Multiplier", v: "Applies weekday-specific scaling (e.g., 1.3x Saturday)." },
                      { l: "Buffer Logic", v: "Safety pars based on ingredient category (Protein/Produce)." },
                      { l: "Inventory Offset", v: "Net reduction based on verified morning counts." }
                    ].map((row, i) => (
                      <li key={i} className="flex justify-between items-center p-6 bg-white rounded-2xl border-2 border-indigo-100">
                        <span className="font-black text-indigo-900 uppercase text-xs tracking-widest">{row.l}</span>
                        <span className="text-indigo-700 font-black text-lg">{row.v}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="bg-rose-50 p-12 rounded-[4rem] border-4 border-rose-600 shadow-xl space-y-8">
                  <div className="w-20 h-20 bg-rose-600 text-white rounded-3xl flex items-center justify-center shadow-lg"><Icons.Trash /></div>
                  <h4 className="text-3xl font-black text-rose-900 uppercase tracking-tight leading-none italic">The Learning Loop</h4>
                  <p className="text-rose-800 font-medium leading-relaxed text-lg">Logged waste events directly influence tomorrow's production pars to stabilize food cost variance.</p>
                  <div className="space-y-6">
                    <div className="p-6 bg-white rounded-3xl border-2 border-rose-100 shadow-sm">
                      <p className="text-[11px] font-black text-rose-600 uppercase mb-2 tracking-[0.2em]">High Waste Override</p>
                      <p className="text-slate-950 font-black leading-snug text-xl">If Waste > 25% of prep, system forces a 20% reduction across the next 3 days.</p>
                    </div>
                    <div className="p-6 bg-white rounded-3xl border-2 border-emerald-100 shadow-sm">
                      <p className="text-[11px] font-black text-emerald-600 uppercase mb-2 tracking-[0.2em]">Low Stock Override</p>
                      <p className="text-slate-950 font-black leading-snug text-xl">If an item '86s' before service end, pars are boosted by 15% for the next cycle.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          <footer className="mt-auto pt-20 pb-12 border-t-4 border-slate-900">
            <div className="flex flex-col md:flex-row items-center justify-between gap-8 text-[12px] font-black text-slate-950 uppercase tracking-[0.3em]">
              <div className="flex items-center gap-4">
                <span className="bg-slate-900 text-white px-3 py-1 rounded">FOHBOH</span>
                <span>© 2026. All Rights Reserved.</span>
              </div>
              <div className="flex items-center gap-10">
                <a href="#" className="hover:text-indigo-600 transition-colors">Documentation</a>
                <a href="#" className="hover:text-indigo-600 transition-colors">Privacy</a>
                <a href="#" className="hover:text-indigo-600 transition-colors">Terms</a>
              </div>
            </div>
          </footer>
        </div>
        
        {/* Mobile Navigation */}
        <div className="md:hidden bg-slate-900 border-t flex justify-around p-4 pb-8 shrink-0 z-50">
          <button onClick={() => setActiveTab('home')} className={`p-4 rounded-2xl ${activeTab === 'home' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}><Icons.Dashboard /></button>
          <button onClick={() => setActiveTab('preplist')} className={`p-4 rounded-2xl ${activeTab === 'preplist' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}><Icons.ChefHat /></button>
          <button onClick={() => setActiveTab('waste')} className={`p-4 rounded-2xl ${activeTab === 'waste' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}><Icons.Trash /></button>
          <button onClick={() => setActiveTab('agent')} className={`p-4 rounded-2xl ${activeTab === 'agent' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}><Icons.Bot /></button>
        </div>
      </main>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
        .animate-in { animation: fadeIn 0.8s cubic-bezier(0.16, 1, 0.3, 1); }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
};

export default App;
