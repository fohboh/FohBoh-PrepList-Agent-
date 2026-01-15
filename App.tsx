
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
        systemInstruction: "You are the PrepList Agent™. Logic: Base × Day Multiplier × Buffer - Inventory."
      }
    });
    sessionRef.current = await sessionPromise;
  };

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-[#f1f5f9]">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      
      <main className="flex-1 md:ml-64 flex flex-col h-screen overflow-hidden">
        <header className="p-4 md:p-6 bg-white border-b flex justify-between items-center shrink-0 shadow-md relative z-30">
          <div>
            <h1 className="text-2xl font-black text-slate-900 flex items-center gap-3">
              <span className="p-2 bg-indigo-600 text-white rounded-xl shadow-lg shadow-indigo-100"><Icons.ChefHat /></span>
              PrepList Agent™
            </h1>
            <p className="text-[10px] text-indigo-600 font-black uppercase tracking-[0.2em]">Deterministic Kitchen Intelligence</p>
          </div>
          <button onClick={startLiveSession} className={`flex items-center gap-3 px-8 py-3 rounded-2xl font-black transition-all shadow-xl active:scale-95 ${isLiveActive ? 'bg-rose-500 text-white animate-pulse' : 'bg-slate-900 text-white hover:bg-indigo-600'}`}>
            {isLiveActive ? <Icons.MicOff /> : <Icons.Mic />}
            {isLiveActive ? 'Agent Listening' : 'Talk to Agent'}
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 md:p-10 space-y-12 flex flex-col relative z-10 bg-gradient-to-b from-white to-[#f1f5f9]">
          {activeTab === 'home' && (
            <div className="max-w-6xl mx-auto space-y-20 animate-in pb-20">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center pt-8">
                <div className="space-y-8">
                  <div className="inline-flex items-center gap-2 bg-indigo-100 text-indigo-700 px-5 py-2 rounded-full text-[11px] font-black uppercase tracking-widest border border-indigo-200">
                    <span className="w-2 h-2 bg-indigo-600 rounded-full animate-ping"></span>
                    Operational Intelligence Active
                  </div>
                  <h2 className="text-6xl md:text-7xl font-black text-slate-900 leading-[0.95] tracking-tight">
                    Never <span className="text-indigo-600 italic">86</span> <br/>
                    a Menu Item <br/>
                    Again.
                  </h2>
                  <p className="text-xl text-slate-700 font-medium max-w-lg leading-relaxed">
                    FohBoh PrepList Agent™ synchronizes sales forecasts, inventory levels, and menu velocity into a perfectly prioritized daily execution plan.
                  </p>
                  <div className="flex flex-wrap gap-5 pt-4">
                    <button onClick={() => setActiveTab('get-started')} className="bg-emerald-600 hover:bg-emerald-700 text-white px-10 py-5 rounded-[2rem] font-black text-lg shadow-2xl shadow-emerald-200 transition-all hover:-translate-y-1 active:scale-95">Get Started Today</button>
                    <button onClick={() => setActiveTab('dashboard')} className="bg-white border-4 border-slate-900 text-slate-900 px-10 py-5 rounded-[2rem] font-black text-lg hover:bg-slate-900 hover:text-white transition-all hover:-translate-y-1 active:scale-95">View Dashboard</button>
                  </div>
                </div>
                <div className="relative">
                  <div className="absolute -inset-4 bg-indigo-500/20 rounded-[4rem] blur-3xl -z-10"></div>
                  <div className="bg-slate-900 p-10 rounded-[3.5rem] shadow-2xl rotate-2 hover:rotate-0 transition-all duration-700 border-8 border-white">
                    <div className="flex items-center gap-5 mb-8">
                      <div className="w-16 h-16 bg-emerald-500 text-white rounded-3xl flex items-center justify-center font-black text-2xl shadow-lg">KM</div>
                      <div>
                        <p className="font-black text-white text-xl uppercase tracking-tight">Agent Forecast</p>
                        <p className="text-[10px] font-black text-emerald-400 uppercase tracking-widest">Confidence: 99.4%</p>
                      </div>
                    </div>
                    <p className="text-slate-300 text-lg italic leading-relaxed font-medium">
                      "System detected Downtown Farmers Market event. Automatic Breakfast buffer applied. NYC Strip Steak par increased to 25 units based on Friday historical velocity."
                    </p>
                    <div className="mt-8 pt-8 border-t border-slate-700 flex justify-between">
                       <div className="text-center"><p className="text-white font-black text-2xl">+$1.2k</p><p className="text-[9px] text-slate-500 font-black uppercase">Waste Saved</p></div>
                       <div className="text-center"><p className="text-white font-black text-2xl">88%</p><p className="text-[9px] text-slate-500 font-black uppercase">Efficiency</p></div>
                       <div className="text-center"><p className="text-white font-black text-2xl">0%</p><p className="text-[9px] text-slate-500 font-black uppercase">Outages</p></div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
                {[
                  { title: "Smart Par Management", desc: "Dynamic par levels adjusted daily based on daypart volume and item velocity.", icon: <Icons.Trend />, color: "bg-indigo-600" },
                  { title: "Waste Learning Loop", desc: "Logged overprep automatically triggers reduction rules to fix future par calculations.", icon: <Icons.Trash />, color: "bg-rose-500" },
                  { title: "Station Orchestration", desc: "Prep tasks grouped by kitchen station and prioritized by prep-time and shelf-life.", icon: <Icons.ChefHat />, color: "bg-emerald-600" }
                ].map((feature, i) => (
                  <div key={i} className="bg-white p-10 rounded-[3rem] border-4 border-slate-50 shadow-xl hover:shadow-2xl transition-all group hover:-translate-y-2">
                    <div className={`w-16 h-16 ${feature.color} text-white rounded-2xl flex items-center justify-center mb-8 group-hover:scale-110 transition-transform shadow-lg`}>{feature.icon}</div>
                    <h4 className="text-2xl font-black text-slate-900 mb-4 tracking-tight uppercase leading-none">{feature.title}</h4>
                    <p className="text-slate-600 font-medium leading-relaxed">{feature.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'get-started' && (
            <div className="max-w-4xl mx-auto space-y-16 animate-in pb-20">
              <div className="text-center space-y-4">
                <h2 className="text-5xl font-black text-slate-900 tracking-tight">Sync Your Kitchen</h2>
                <p className="text-slate-600 text-xl font-medium">Complete these 4 critical steps for today's service.</p>
              </div>
              <div className="relative space-y-12 before:absolute before:left-10 before:top-10 before:bottom-10 before:w-2 before:bg-indigo-100 before:-z-10">
                {[
                  { step: 1, title: "Configure Forecasts", desc: "Enter meal counts for Breakfast, Lunch, and Dinner. Rules applied instantly.", tab: "inputs", action: "Go to Inputs" },
                  { step: 2, title: "Verify On-Hand Stock", desc: "Confirm current inventory levels to calculate final 'Prep-Need' delta.", tab: "inventory", action: "Update Inventory" },
                  { step: 3, title: "Execute Prep List", desc: "Review prioritized tasks sorted by station and knife-skill level.", tab: "preplist", action: "View Prep List" },
                  { step: 4, title: "Analyze & Log Waste", desc: "Close the loop by logging overprep. System learns and adjusts for tomorrow.", tab: "waste", action: "Review Waste" }
                ].map((item, i) => (
                  <div key={i} className="flex gap-10 items-start group">
                    <div className="w-20 h-20 rounded-full bg-white border-8 border-indigo-600 flex items-center justify-center text-indigo-600 font-black text-2xl shadow-2xl shrink-0 group-hover:scale-110 transition-transform">{item.step}</div>
                    <div className="bg-white p-10 rounded-[3rem] border-4 border-slate-100 shadow-xl flex-1 hover:border-indigo-600 transition-all">
                      <h4 className="text-2xl font-black text-slate-900 mb-3 uppercase tracking-tight">{item.title}</h4>
                      <p className="text-slate-600 font-medium mb-8 text-lg">{item.desc}</p>
                      <button onClick={() => setActiveTab(item.tab)} className="bg-slate-900 text-white px-8 py-4 rounded-2xl font-black hover:bg-indigo-600 transition-all shadow-lg active:scale-95">{item.action}</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

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

          {activeTab === 'pmix' && (
            <div className="max-w-7xl mx-auto space-y-12 animate-in pb-20">
              <div className="flex flex-col md:flex-row justify-between items-end gap-4 border-b-8 border-slate-900 pb-6">
                <div>
                   <h2 className="text-5xl font-black text-slate-900 tracking-tight uppercase">Volume Explosion Grid</h2>
                   <p className="text-indigo-600 font-black uppercase tracking-widest text-xs">Section 5: Menu Mix Extrapolation</p>
                </div>
                <div className="bg-slate-900 text-white px-8 py-3 rounded-2xl font-black uppercase tracking-widest text-[10px]">
                   Target Covers: {totalTargetVolume}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {menuItems.map(item => (
                  <div key={item.id} className="bg-white border-4 border-slate-900 rounded-[3rem] shadow-xl overflow-hidden group hover:shadow-2xl transition-all">
                    <div className="p-8 bg-slate-50 border-b-4 border-slate-900 flex justify-between items-start">
                      <p className="font-black text-slate-900 text-2xl uppercase tracking-tight leading-none">{item.name}</p>
                      <span className="bg-indigo-600 text-white text-[10px] font-black px-4 py-1 rounded-full uppercase tracking-widest">{(item.productMix * 100).toFixed(0)}% PMix</span>
                    </div>
                    <div className="p-10 space-y-8">
                       <div className="flex items-end gap-3">
                         <p className="text-7xl font-black text-slate-950 leading-none tracking-tighter">{Math.round(totalTargetVolume * item.productMix)}</p>
                         <p className="text-sm font-black text-slate-400 uppercase tracking-widest mb-2">Portions</p>
                       </div>
                       <div className="h-16 border-2 rounded-2xl p-2 bg-slate-50"><MiniTrendChart data={item.history7Days} /></div>
                       <div className="pt-8 border-t-4 border-dotted border-slate-200 space-y-4">
                          <p className="text-[10px] font-black text-indigo-600 uppercase tracking-widest flex items-center gap-2">
                             <Icons.Search /> Ingredient Drag Breakdown
                          </p>
                          <div className="space-y-3">
                            {item.ingredients.map(ing => (
                              <div key={ing.prepItemId} className="flex justify-between text-sm font-black items-center">
                                <span className="text-slate-500 uppercase tracking-tight">{prepItems.find(p => p.id === ing.prepItemId)?.name}</span>
                                <span className="text-slate-950 bg-indigo-50 px-4 py-1.5 rounded-xl border-2 border-indigo-100 italic">{(Math.round(totalTargetVolume * item.productMix) * ing.amountPerUnit).toFixed(1)} {prepItems.find(p => p.id === ing.prepItemId)?.unit}</span>
                              </div>
                            ))}
                          </div>
                       </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

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
                  <p className="text-indigo-800 font-medium leading-relaxed">PrepList Agent™ uses a 100% traceable engine. We never hide the 'why' behind a par level.</p>
                  <ul className="space-y-4">
                    {[
                      { l: "Base Demand", v: "Derived from Daypart volume targets." },
                      { l: "DOW Multiplier", v: "Applies weekday-specific scaling (e.g., 1.3x Saturday)." },
                      { l: "Buffer Logic", v: "Safety pars based on ingredient category (Protein/Produce)." },
                      { l: "Inventory Offset", v: "Net reduction based on verified morning counts." }
                    ].map((row, i) => (
                      <li key={i} className="flex justify-between items-center p-5 bg-white rounded-2xl border-2 border-indigo-100">
                        <span className="font-black text-indigo-900 uppercase text-xs tracking-widest">{row.l}</span>
                        <span className="text-indigo-600 font-black">{row.v}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="bg-rose-50 p-12 rounded-[4rem] border-4 border-rose-600 shadow-xl space-y-8">
                  <div className="w-20 h-20 bg-rose-600 text-white rounded-3xl flex items-center justify-center shadow-lg"><Icons.Trash /></div>
                  <h4 className="text-3xl font-black text-rose-900 uppercase tracking-tight leading-none italic">The Learning Loop</h4>
                  <p className="text-rose-800 font-medium leading-relaxed">Logged waste events directly influence tomorrow's production pars to stabilize food cost variance.</p>
                  <div className="space-y-6">
                    <div className="p-6 bg-white rounded-3xl border-2 border-rose-100 shadow-sm">
                      <p className="text-[11px] font-black text-rose-600 uppercase mb-2 tracking-[0.2em]">High Waste Override</p>
                      <p className="text-slate-900 font-bold leading-snug text-lg">If Waste > 25% of prep, system forces a 20% reduction across the next 3 days.</p>
                    </div>
                    <div className="p-6 bg-white rounded-3xl border-2 border-emerald-100 shadow-sm">
                      <p className="text-[11px] font-black text-emerald-600 uppercase mb-2 tracking-[0.2em]">Low Stock Override</p>
                      <p className="text-slate-900 font-bold leading-snug text-lg">If an item '86s' before service end, pars are boosted by 15% for the next cycle.</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-8 pt-10">
                 <h3 className="text-4xl font-black text-slate-900 px-4 uppercase tracking-tighter italic">FAQ - Common Scenarios</h3>
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                   {[
                     { q: "What is an 'Assigned To' task?", a: "Prep lists can be split by staff member. These sync in real-time to mobile tablets on the line." },
                     { q: "How are knife skills weighted?", a: "Tasks are graded 1-10. PrepList Agent™ suggests complex butchery tasks for your senior line cooks first." },
                     { q: "Can I adjust multipliers manually?", a: "Yes, use the Voice Interface to say 'Boost protein pars by 10% today'—the Agent will update all relevant items." },
                     { q: "Is this integrated with my POS?", a: "By default, yes. If Toast or NCR sync fails, the system falls back to historical day-of-week averages." }
                   ].map((faq, i) => (
                     <div key={i} className="bg-white p-10 rounded-[3rem] border-4 border-slate-100 shadow-lg hover:border-indigo-600 transition-all">
                       <p className="font-black text-slate-950 text-xl mb-4 leading-tight uppercase tracking-tight">{faq.q}</p>
                       <p className="text-slate-600 font-medium leading-relaxed">{faq.a}</p>
                     </div>
                   ))}
                 </div>
              </div>
            </div>
          )}

          {activeTab === 'waste' && (
            <div className="max-w-6xl mx-auto space-y-12 animate-in pb-20">
              <div className="flex flex-col md:flex-row justify-between items-end gap-6 border-b-8 border-slate-900 pb-8">
                <div>
                   <h2 className="text-6xl font-black text-slate-900 tracking-tight uppercase">Waste Analysis</h2>
                   <p className="text-rose-600 font-black uppercase tracking-widest text-xs">Section 6: Adaptive Correction Engine</p>
                </div>
                <button onClick={() => setShowWasteForm(true)} className="bg-rose-600 text-white px-10 py-5 rounded-[2rem] font-black text-lg shadow-2xl hover:bg-rose-700 transition-all active:scale-95">Log Waste Event</button>
              </div>

              {showWasteForm && (
                <div className="bg-white border-8 border-rose-600 rounded-[4rem] p-12 shadow-[0_35px_60px_-15px_rgba(225,29,72,0.3)] space-y-10 animate-in zoom-in duration-300 relative z-40">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
                    <div className="space-y-3">
                      <label className="text-xs font-black text-slate-950 uppercase tracking-widest block">Item Name</label>
                      <select className="w-full bg-slate-50 border-4 border-slate-950 rounded-[1.5rem] px-6 py-5 text-xl font-black text-black outline-none focus:bg-white" onChange={(e) => setNewWaste({...newWaste, itemName: e.target.value})}>
                        <option value="">Select Item...</option>
                        {prepItems.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
                      </select>
                    </div>
                    <div className="space-y-3">
                      <label className="text-xs font-black text-slate-950 uppercase tracking-widest block">Logged Qty (kg)</label>
                      <input type="number" className="w-full bg-slate-50 border-4 border-slate-950 rounded-[1.5rem] px-6 py-5 text-xl font-black text-black outline-none focus:bg-white" placeholder="0.0" onChange={(e) => setNewWaste({...newWaste, quantity: Number(e.target.value)})} />
                    </div>
                    <div className="space-y-3">
                      <label className="text-xs font-black text-slate-950 uppercase tracking-widest block">Reason Code</label>
                      <select className="w-full bg-slate-50 border-4 border-slate-950 rounded-[1.5rem] px-6 py-5 text-xl font-black text-black outline-none focus:bg-white" onChange={(e) => setNewWaste({...newWaste, reasonCode: (e.target.value as WasteReasonCode)})}>
                        <option value="OVERPRODUCTION">OVERPRODUCTION</option>
                        <option value="SPOILAGE">SPOILAGE</option>
                        <option value="PREP_ERROR">PREP_ERROR</option>
                        <option value="STORAGE">STORAGE</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex justify-end gap-5">
                    <button onClick={() => setShowWasteForm(false)} className="text-slate-500 font-black uppercase text-sm px-8">Cancel</button>
                    <button onClick={logWasteEntry} className="bg-slate-900 text-white px-12 py-5 rounded-[2rem] font-black text-lg hover:bg-rose-600 transition-colors shadow-xl">Commit to Ledger</button>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                <div className="bg-slate-950 p-12 rounded-[4rem] text-white space-y-2">
                  <p className="text-slate-500 font-black uppercase tracking-widest text-[11px]">Period Loss Impact</p>
                  <p className="text-8xl font-black tracking-tighter text-rose-500 italic leading-none">${totalWasteCost.toFixed(2)}</p>
                  <p className="text-slate-400 font-medium pt-4">Calculated across {wasteLogs.length} recent events.</p>
                </div>
                <div className="bg-white border-4 border-slate-900 p-10 rounded-[4rem] space-y-6">
                  <p className="font-black text-slate-950 uppercase tracking-widest text-[11px] border-b-2 border-slate-100 pb-4">Recent Entry Logs</p>
                  <div className="space-y-5 max-h-[300px] overflow-y-auto pr-4 custom-scrollbar">
                    {wasteLogs.map(log => (
                      <div key={log.id} className="flex justify-between items-center p-6 bg-slate-50 rounded-[2rem] border-2 border-slate-100 hover:border-rose-200 transition-colors">
                        <div>
                          <p className="font-black text-slate-900 text-lg uppercase leading-none mb-1">{log.itemName}</p>
                          <p className="text-[10px] font-black text-rose-500 uppercase tracking-widest">{log.reasonCode} • {log.shift} Shift</p>
                        </div>
                        <div className="text-right">
                          <p className="font-black text-slate-950 text-xl leading-none">-{log.quantity} {log.unit}</p>
                          <p className="text-[11px] font-black text-slate-400 uppercase tracking-tight italic">Cost: ${log.totalCost.toFixed(2)}</p>
                        </div>
                      </div>
                    ))}
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
