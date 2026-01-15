
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
import { PrepItem, InventoryItem, WasteEntry, MenuItem, SpecialEvent, DaypartConfig } from './types';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';

// Audio Utility Functions
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
  const [activeTab, setActiveTab] = useState('dashboard');
  const [prepItems, setPrepItems] = useState<PrepItem[]>(INITIAL_PREP_ITEMS);
  const [inventory, setInventory] = useState<InventoryItem[]>(INITIAL_INVENTORY);
  const [wasteLogs, setWasteLogs] = useState<WasteEntry[]>(INITIAL_WASTE);
  const [menuItems, setMenuItems] = useState<MenuItem[]>(MENU_ITEMS);
  
  // Daypart Configuration (Volume and Editable Avg Check)
  const [dayparts, setDayparts] = useState<Record<string, DaypartConfig>>({
    breakfast: { volume: 50, avgCheck: 12.50 },
    lunch: { volume: 120, avgCheck: 18.75 },
    dinner: { volume: 180, avgCheck: 28.50 }
  });

  const [specialEvents, setSpecialEvents] = useState<SpecialEvent[]>([
    { id: 'e1', name: 'Downtown Farmers Market', coverIncrease: 1.15, menuFocus: 'Breakfast' }
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
  
  const [isLiveActive, setIsLiveActive] = useState(false);
  const [transcription, setTranscription] = useState<{user: string, agent: string}[]>([]);
  const [currentAgentText, setCurrentAgentText] = useState('');
  const [currentUserText, setCurrentUserText] = useState('');
  
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const sessionRef = useRef<any>(null);
  const nextStartTimeRef = useRef(0);
  const sourcesRef = useRef(new Set<AudioBufferSourceNode>());

  // Rules-Based Deterministic Prep Engine
  const calculatePrepNeed = (item: PrepItem, totalTarget: number) => {
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long' });
    const isWeekend = ['Thursday', 'Friday', 'Saturday', 'Sunday'].includes(today);
    
    // Baseline Need based on historical PMIX average
    let baseNeed = (totalTarget / 350) * item.forecastNeeded; 
    
    const multiplier = isWeekend ? 1.5 : 0.5;
    baseNeed = baseNeed * multiplier;

    const buffer = item.category === 'Protein' ? 1.25 : 1.15;
    let bufferedNeed = baseNeed * buffer;

    let toPrep = Math.max(0, bufferedNeed - item.currentStock);

    if (item.shelfLifeDays <= 1) {
      toPrep = Math.min(toPrep, baseNeed * 1.5);
    }
    
    return {
      amount: parseFloat(toPrep.toFixed(2)),
      explanation: `${today} ${isWeekend ? 'Weekend' : 'Weekday'} multiplier (${multiplier}x) + ${item.category} buffer (${((buffer-1)*100).toFixed(0)}%)`
    };
  };

  const stations = useMemo(() => {
    const groups: Record<string, PrepItem[]> = {};
    prepItems.forEach(item => {
      const calc = calculatePrepNeed(item, totalTargetVolume);
      const updated = { ...item, prepNeeded: calc.amount, whyExplanation: calc.explanation };
      if (!groups[item.station]) groups[item.station] = [];
      groups[item.station].push(updated);
    });
    return groups;
  }, [prepItems, totalTargetVolume]);

  const toggleItemStatus = (id: string) => {
    setPrepItems(prev => prev.map(item => item.id === id ? { ...item, status: item.status === 'Pending' ? 'In-Progress' : item.status === 'In-Progress' ? 'Completed' : 'Pending' } : item));
  };

  const handleDaypartChange = (dp: string, field: keyof DaypartConfig, val: string) => {
    const num = parseFloat(val) || 0;
    setDayparts(prev => ({
      ...prev,
      [dp]: { ...prev[dp], [field]: num }
    }));
  };

  const startLiveSession = async () => {
    if (isLiveActive) { sessionRef.current?.close(); setIsLiveActive(false); return; }
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
    inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    const sessionPromise = ai.live.connect({
      model: 'gemini-2.5-flash-native-audio-preview-12-2025',
      callbacks: {
        onopen: () => {
          setIsLiveActive(true);
          const source = inputAudioContextRef.current!.createMediaStreamSource(stream);
          const scriptProcessor = inputAudioContextRef.current!.createScriptProcessor(4096, 1, 1);
          scriptProcessor.onaudioprocess = (e) => {
            const inputData = e.inputBuffer.getChannelData(0);
            const int16 = new Int16Array(inputData.length);
            for (let i = 0; i < inputData.length; i++) int16[i] = inputData[i] * 32768;
            sessionPromise.then(s => s.sendRealtimeInput({ media: { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' } }));
          };
          source.connect(scriptProcessor);
          scriptProcessor.connect(inputAudioContextRef.current!.destination);
        },
        onmessage: async (message: LiveServerMessage) => {
          if (message.serverContent?.outputTranscription) setCurrentAgentText(prev => prev + message.serverContent!.outputTranscription!.text);
          else if (message.serverContent?.inputTranscription) setCurrentUserText(prev => prev + message.serverContent!.inputTranscription!.text);
          if (message.serverContent?.turnComplete) { setTranscription(prev => [...prev, { user: currentUserText, agent: currentAgentText }]); setCurrentUserText(''); setCurrentAgentText(''); }
          const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
          if (base64Audio && outputAudioContextRef.current) {
            const ctx = outputAudioContextRef.current;
            nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
            const buffer = await decodeAudioData(decode(base64Audio), ctx, 24000, 1);
            const source = ctx.createBufferSource();
            source.buffer = buffer;
            source.connect(ctx.destination);
            source.start(nextStartTimeRef.current);
            nextStartTimeRef.current += buffer.duration;
            sourcesRef.current.add(source);
            source.onended = () => sourcesRef.current.delete(source);
          }
          if (message.serverContent?.interrupted) { sourcesRef.current.forEach(s => s.stop()); sourcesRef.current.clear(); nextStartTimeRef.current = 0; }
        },
        onclose: () => setIsLiveActive(false),
      },
      config: {
        responseModalities: [Modality.AUDIO],
        outputAudioTranscription: {},
        inputAudioTranscription: {},
        systemInstruction: `You are the PrepList Agent™, an intelligent sous-chef advisor. 
        Logic: Use Product Mix data and total forecast of ${totalTargetVolume} meals. Sales projection is $${totalSalesForecast.toFixed(2)}.
        All your responses must clearly label AI suggestions vs. deterministic rules.`
      }
    });
    sessionRef.current = await sessionPromise;
  };

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-[#f8fafc]">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      
      <main className="flex-1 md:ml-64 flex flex-col h-screen overflow-hidden">
        <header className="p-4 md:p-6 bg-white border-b flex justify-between items-center shrink-0">
          <div>
            <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <span className="p-1.5 bg-indigo-600 text-white rounded-lg"><Icons.ChefHat /></span>
              PrepList Agent™
            </h1>
            <p className="text-xs text-slate-500 font-medium">Deterministic Kitchen Control System</p>
          </div>
          <button onClick={startLiveSession} className={`flex items-center gap-2 px-6 py-2 rounded-full font-bold transition-all shadow-lg ${isLiveActive ? 'bg-rose-500 text-white animate-pulse' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}>
            {isLiveActive ? <Icons.MicOff /> : <Icons.Mic />}
            {isLiveActive ? 'Listening...' : 'Talk to Agent'}
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-8">
          
          {activeTab === 'dashboard' && (
            <div className="space-y-6 max-w-7xl mx-auto animate-in fade-in duration-500">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white p-6 rounded-3xl border shadow-sm relative overflow-visible">
                   <h3 className="text-slate-500 text-sm font-medium mb-1">Low Stock Alerts <Tooltip what="Ingredients below Par Levels." source="IMS Counts." why="Prevents 86ing items." align="left" /></h3>
                   <p className="text-3xl font-bold text-slate-900">3 Items</p>
                </div>
                <div className="bg-white p-6 rounded-3xl border shadow-sm overflow-visible">
                   <h3 className="text-slate-500 text-sm font-medium mb-1">Daily Sales Forecast <Tooltip what="Projected revenue calculation." source="Meals x Avg Check." why="Staffing and production targets." align="center" /></h3>
                   <p className="text-3xl font-bold text-slate-900">${totalSalesForecast.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                </div>
                <div className="bg-white p-6 rounded-3xl border shadow-sm overflow-visible">
                   <h3 className="text-slate-500 text-sm font-medium mb-1">Waste (OVERPREP) <Tooltip what="Items discarded due to high par levels." source="Waste Sheets." why="Signals need for rule adjustments." align="right" /></h3>
                   <p className="text-3xl font-bold text-rose-600">$142.50</p>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 bg-white p-6 rounded-3xl border shadow-sm overflow-visible">
                  <div className="flex flex-col md:flex-row md:items-end justify-between mb-6 gap-4">
                    <h3 className="font-bold text-slate-900">Historical Demand Visualization <Tooltip what="Actual vs Predicted Sales." source="POS data." why="AI and Rules verification." align="left" /></h3>
                  </div>
                  <ForecastChart data={MOCK_FORECAST} />
                </div>

                <div className="bg-white p-6 rounded-3xl border shadow-sm overflow-visible">
                  <h3 className="font-bold text-slate-900 mb-6 flex items-center gap-2">
                    <Icons.Search /> Active Data Pipelines
                    <Tooltip what="Live connections to your restaurant technology stack." source="API Webhooks." why="Ensures real-time accuracy of prep recommendations." align="right" />
                  </h3>
                  <div className="space-y-4">
                    {[
                      { name: 'Toast POS', status: 'Live', time: 'Real-time', color: 'bg-emerald-500' },
                      { name: 'MarketMan IMS', status: 'Healthy', time: '12m ago', color: 'bg-emerald-500' },
                      { name: '7shifts Labor', status: 'Syncing', time: 'Just now', color: 'bg-indigo-500' },
                      { name: 'Weather API', status: 'Healthy', time: '1h ago', color: 'bg-emerald-500' }
                    ].map(source => (
                      <div key={source.name} className="flex items-center gap-4 p-4 border rounded-2xl bg-slate-50/50">
                        <div className={`w-3 h-3 rounded-full ${source.color} animate-pulse shadow-[0_0_8px_rgba(0,0,0,0.1)]`}></div>
                        <div>
                          <p className="text-sm font-bold text-slate-900">{source.name}</p>
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{source.status} • {source.time}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-8 pt-6 border-t">
                     <p className="text-[10px] font-black text-slate-400 uppercase mb-2">System Health</p>
                     <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 bg-slate-100 rounded-full overflow-hidden">
                           <div className="h-full bg-indigo-500 w-[98%]"></div>
                        </div>
                        <span className="text-[10px] font-bold text-indigo-600">98%</span>
                     </div>
                  </div>
                </div>
              </div>
            </div>
          )}
          
          {activeTab === 'inputs' && (
            <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in duration-500">
              <div className="flex justify-between items-center">
                <h2 className="text-2xl font-black text-slate-900">Required Daily Inputs</h2>
                <div className="text-right">
                  <p className="text-[10px] font-black text-slate-400 uppercase">Today's Total Forecast</p>
                  <p className="text-2xl font-black text-indigo-600">${totalSalesForecast.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {Object.entries(dayparts).map(([name, config]) => (
                  <div key={name} className="bg-white rounded-3xl border shadow-sm p-6 space-y-6">
                    <h3 className="font-black text-slate-900 uppercase tracking-widest text-sm flex items-center justify-between">
                      {name} Service
                      <span className="text-[10px] text-slate-400">Daypart {Object.keys(dayparts).indexOf(name) + 1}</span>
                    </h3>
                    
                    <div className="space-y-4">
                      <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">Projected Meals</label>
                        <input 
                          type="number" 
                          value={config.volume} 
                          onChange={(e) => handleDaypartChange(name, 'volume', e.target.value)}
                          className="w-full bg-slate-50 border-slate-200 border-2 rounded-2xl px-4 py-3 text-2xl font-black text-slate-900 focus:ring-2 focus:ring-indigo-500 outline-none transition-all" 
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">Avg Guest Check ($)</label>
                        <input 
                          type="number" 
                          step="0.01"
                          value={config.avgCheck} 
                          onChange={(e) => handleDaypartChange(name, 'avgCheck', e.target.value)}
                          className="w-full bg-slate-50 border-slate-200 border-2 rounded-2xl px-4 py-3 text-2xl font-black text-slate-900 focus:ring-2 focus:ring-indigo-500 outline-none transition-all" 
                        />
                      </div>
                    </div>

                    <div className="pt-4 border-t border-slate-50">
                      <p className="text-[10px] font-black text-slate-400 uppercase">Projected Sales</p>
                      <p className="text-lg font-black text-slate-800">${(config.volume * config.avgCheck).toLocaleString()}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white rounded-3xl border shadow-sm p-6 overflow-visible">
                  <h3 className="font-black text-slate-900 uppercase tracking-widest text-sm mb-4 flex items-center gap-2">
                    <Icons.Search /> Special Event Flags
                    <Tooltip what="Manual overrides for local events." source="Manager Input." why="Factors in outlier spikes." align="left" />
                  </h3>
                  <div className="space-y-3">
                    {specialEvents.map(event => (
                      <div key={event.id} className="flex items-center justify-between p-4 bg-indigo-50 rounded-2xl border border-indigo-100">
                        <div>
                          <p className="font-bold text-indigo-900">{event.name}</p>
                          <p className="text-xs text-indigo-700">Focus: {event.menuFocus} | Impact: +{Math.round((event.coverIncrease - 1) * 100)}% covers</p>
                        </div>
                        <button className="text-indigo-400 hover:text-rose-500 transition-colors"><Icons.Trash /></button>
                      </div>
                    ))}
                    <button className="w-full py-3 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400 font-bold text-sm hover:border-indigo-400 hover:text-indigo-500 transition-all">+ Add Special Event</button>
                  </div>
                </div>

                <div className="bg-slate-900 rounded-3xl p-6 text-white shadow-xl relative overflow-hidden">
                  <div className="relative z-10">
                    <h3 className="font-black uppercase tracking-widest text-sm mb-6 text-slate-400">Forecast Summary</h3>
                    <div className="grid grid-cols-2 gap-8">
                      <div>
                        <p className="text-[10px] font-black text-slate-500 uppercase">Base Covers</p>
                        <p className="text-3xl font-black">{dayparts.breakfast.volume + dayparts.lunch.volume + dayparts.dinner.volume}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-black text-slate-500 uppercase">Event Impact</p>
                        <p className="text-3xl font-black text-indigo-400">x{eventMultiplier.toFixed(2)}</p>
                      </div>
                      <div className="col-span-2 pt-4 border-t border-slate-800">
                        <p className="text-[10px] font-black text-slate-500 uppercase mb-1">Final Prep Target (Covers)</p>
                        <p className="text-5xl font-black">{totalTargetVolume}</p>
                      </div>
                    </div>
                  </div>
                  <div className="absolute -bottom-10 -right-10 w-48 h-48 bg-indigo-600 rounded-full blur-3xl opacity-20"></div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'preplist' && (
            <div className="max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500">
              <div className="flex justify-between items-end">
                 <div><h2 className="text-2xl font-black text-slate-900">Digital Prep List</h2><p className="text-sm text-slate-500 italic">Source: Deterministic rules-engine based on {totalTargetVolume} projected covers</p></div>
                 <div className="bg-white border p-3 rounded-2xl shadow-sm text-right">
                    <span className="text-[10px] font-black text-slate-400 uppercase">Approval Required</span>
                    <button className="block text-sm font-bold text-indigo-600 hover:text-indigo-800">Generate Final PDF</button>
                 </div>
              </div>
              
              {(Object.entries(stations) as [string, PrepItem[]][]).map(([station, items]) => (
                <div key={station} className="bg-white rounded-3xl border shadow-sm overflow-visible mb-8">
                  <div className="p-6 border-b bg-slate-50 rounded-t-3xl flex justify-between items-center">
                    <h3 className="font-black text-indigo-900 uppercase tracking-widest text-sm flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-indigo-600 animate-pulse"></div>
                      Station: {station}
                    </h3>
                    <span className="text-xs font-bold text-slate-500">{items.length} Tasks Assigned</span>
                  </div>
                  <div className="divide-y overflow-visible">
                    {items.map(item => (
                      <div key={item.id} className="p-6 hover:bg-slate-50 transition-colors flex flex-col md:flex-row gap-6 relative overflow-visible">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-1">
                            <h4 className="text-lg font-bold text-slate-900">{item.name}</h4>
                            <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${item.priority === 'High' ? 'bg-rose-50 text-rose-600' : 'bg-slate-100 text-slate-500'}`}>{item.priority}</span>
                          </div>
                          <p className="text-xs text-slate-500 font-medium leading-relaxed">{item.whyExplanation}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-4">
                          <div className="bg-indigo-50 px-4 py-2 rounded-2xl text-center min-w-[100px]">
                            <span className="text-[9px] font-black text-indigo-400 uppercase block">Need</span>
                            <span className="text-lg font-black text-indigo-700">{item.prepNeeded} {item.unit}</span>
                          </div>
                          <div className="bg-slate-50 px-4 py-2 rounded-2xl text-center min-w-[100px]">
                            <span className="text-[9px] font-black text-slate-400 uppercase block">Due By</span>
                            <span className="text-lg font-black text-slate-700">{item.dueBy}</span>
                          </div>
                          <button onClick={() => toggleItemStatus(item.id)} className={`px-5 py-2 rounded-xl border-2 font-black transition-all text-sm uppercase tracking-widest ${item.status === 'Completed' ? 'bg-emerald-500 border-emerald-500 text-white shadow-lg shadow-emerald-100' : 'bg-white border-slate-200 text-slate-400 hover:border-indigo-600 hover:text-indigo-600'}`}>
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

          {activeTab === 'pmix' && (
            <div className="max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500">
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                <div className="lg:col-span-1 space-y-6">
                  <div className="bg-white rounded-3xl border shadow-sm p-6 overflow-visible">
                    <h3 className="font-bold text-slate-900 mb-4 flex items-center gap-2"><Icons.Trend /> Product Mix <Tooltip what="7-day moving averages of POS transaction data." source="Direct POS API." why="Determines baseline prep requirements." align="left" /></h3>
                    <div className="space-y-6">
                      {menuItems.map(item => (
                        <div key={item.id} className="space-y-2 border-b border-slate-50 pb-4 last:border-0">
                          <div className="flex justify-between text-xs font-bold"><span className="text-slate-600">{item.name}</span><span className="text-indigo-600">{(item.productMix * 100).toFixed(0)}%</span></div>
                          <div className="w-full bg-slate-100 rounded-full h-1.5"><div className="bg-indigo-500 h-full rounded-full" style={{ width: `${item.productMix * 100}%` }}></div></div>
                          <div className="flex items-center justify-between"><span className="text-[9px] font-black text-slate-400 uppercase">7d Trend</span><div className="w-2/3"><MiniTrendChart data={item.history7Days} /></div></div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="bg-slate-900 text-white rounded-3xl p-6 shadow-xl">
                    <h3 className="text-xs font-bold text-slate-400 uppercase mb-1">Projected Sales</h3>
                    <p className="text-3xl font-black">${totalSalesForecast.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                    <p className="text-[10px] text-slate-400 mt-2 font-bold uppercase tracking-widest">{totalTargetVolume} Projected Meals Today</p>
                  </div>
                </div>
                <div className="lg:col-span-3">
                  <div className="bg-white p-6 rounded-3xl border shadow-sm overflow-visible">
                    <h3 className="font-bold text-slate-900 mb-6">Volume Explosion Analysis</h3>
                    <div className="space-y-4">
                       {menuItems.map(item => (
                         <div key={item.id} className="p-4 border rounded-2xl flex justify-between items-center">
                            <div>
                               <p className="font-bold text-slate-800">{item.name}</p>
                               <p className="text-xs text-slate-500">{(item.productMix * 100).toFixed(0)}% of {totalTargetVolume} covers</p>
                            </div>
                            <div className="text-right">
                               <p className="text-lg font-black text-indigo-600">{Math.round(totalTargetVolume * item.productMix)} units</p>
                            </div>
                         </div>
                       ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'agent' && (
            <div className="max-w-4xl mx-auto space-y-6">
              <div className="bg-white rounded-3xl border shadow-sm p-8 flex flex-col items-center relative overflow-hidden">
                <div className={`w-24 h-24 rounded-full flex items-center justify-center mb-4 transition-all ${isLiveActive ? 'bg-indigo-50 animate-pulse scale-110' : 'bg-slate-50'}`}>
                  <div className="w-12 h-12 bg-indigo-600 text-white rounded-full flex items-center justify-center shadow-lg"><Icons.Bot /></div>
                </div>
                <h2 className="text-lg font-bold">Prep Agent Interface</h2>
                <p className="text-sm text-slate-500 mb-8">Guided conversation for meal planning & par adjustments.</p>
                <div className="w-full space-y-4">
                  {transcription.map((t, i) => (
                    <div key={i} className="space-y-4">
                      <div className="flex justify-end"><div className="bg-indigo-600 text-white px-4 py-2 rounded-2xl rounded-tr-none text-sm max-w-[80%]">{t.user}</div></div>
                      <div className="flex justify-start">
                        <div className="bg-slate-100 text-slate-800 px-4 py-2 rounded-2xl rounded-tl-none text-sm max-w-[80%] border border-slate-200">
                          {t.agent.includes('[AI SUGGESTION]') ? (
                            <span className="block"><span className="text-[10px] font-black text-indigo-600 uppercase mb-1 block">✨ AI Suggestion</span>{t.agent.replace('[AI SUGGESTION]', '')}</span>
                          ) : t.agent}
                        </div>
                      </div>
                    </div>
                  ))}
                  {currentAgentText && <div className="text-xs text-slate-400 italic">Agent is typing...</div>}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'inventory' && (
            <div className="bg-white border rounded-2xl shadow-sm overflow-visible animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-5xl mx-auto">
               <div className="p-6 border-b flex justify-between items-center bg-slate-50 rounded-t-2xl">
                <h3 className="font-bold text-slate-900">Inventory Status <Tooltip what="Current counts." source="IMS Sync." why="Baseline logic." align="left" /></h3>
                <button className="text-sm bg-white border border-slate-200 px-3 py-1.5 rounded-lg font-semibold hover:bg-slate-50 transition-colors shadow-sm">Manual Update</button>
              </div>
              <div className="divide-y overflow-visible">
                {inventory.map(item => (
                  <div key={item.id} className="p-6 flex justify-between items-center hover:bg-slate-50">
                    <div>
                      <p className="font-bold text-slate-900">{item.name}</p>
                      <p className="text-xs text-slate-500">{item.category}</p>
                    </div>
                    <div className="text-right">
                      <p className={`font-bold ${item.currentStock < item.threshold ? 'text-rose-600' : 'text-slate-700'}`}>
                        {item.currentStock} / {item.threshold} {item.unit}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'help' && (
            <div className="max-w-4xl mx-auto space-y-12 animate-in fade-in duration-500 pb-20">
              <div className="text-center">
                <h2 className="text-4xl font-black text-slate-900 mb-4">How to use PrepList Agent™</h2>
                <p className="text-slate-500 max-w-2xl mx-auto">Master the deterministic kitchen intelligence system to reduce waste and boost efficiency.</p>
              </div>

              <div className="space-y-8">
                <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest border-b pb-4">Module Instructions</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {[
                    { title: 'Dashboard', icon: <Icons.Dashboard />, text: 'View high-level restaurant health. Monitor low-stock alerts and historical sales trends at a glance.' },
                    { title: 'Daily Inputs', icon: <Icons.Search />, text: 'CRITICAL: Enter projected meal volume and average checks for each daypart. Add special events to apply multipliers.' },
                    { title: 'Prep List', icon: <Icons.ChefHat />, text: 'Your actionable tasks grouped by station. Mark items as in-progress or completed as you work.' },
                    { title: 'P-Mix Analysis', icon: <Icons.Trend />, text: 'See which menu items are driving prep needs based on historical POS sales data and trends.' },
                    { title: 'Inventory', icon: <Icons.Inventory />, text: 'Live sync with your IMS. Shows current stock vs thresholds to ensure you never run out.' },
                    { title: 'Waste Tracking', icon: <Icons.Trash />, text: 'Log over-prepped items. The engine uses this data to automatically reduce future prep volumes.' }
                  ].map((help, i) => (
                    <div key={i} className="bg-white p-6 rounded-3xl border shadow-sm flex gap-4">
                      <div className="bg-indigo-50 text-indigo-600 p-3 rounded-2xl h-fit">{help.icon}</div>
                      <div>
                        <h4 className="font-bold text-slate-900 mb-1">{help.title}</h4>
                        <p className="text-sm text-slate-500 leading-relaxed">{help.text}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-6">
                <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest border-b pb-4">Frequently Asked Questions</h3>
                <div className="space-y-4">
                  {[
                    { q: 'How is the Prep Needed value calculated?', a: 'Our engine uses a deterministic formula: (Base Cover Target / Historical Avg) * Item Forecast * Weekend/Weekday Multiplier * Station Buffer. It then subtracts current stock.' },
                    { q: 'What are Special Event Flags?', a: 'Manual overrides for local events (e.g., Farmers Markets). They apply a percentage multiplier to your base covers to account for expected spikes.' },
                    { q: 'Does the Prep Agent learn from my kitchen?', a: 'Yes. By logging waste data, the AI identifies over-prepping patterns and suggests adjustments to your rules to save on food costs.' },
                    { q: 'How do I mark an item as 86\'d?', a: 'Navigate to Inventory and update the manual count to zero. The Prep Agent will flag the item as critical on the Dashboard.' }
                  ].map((faq, i) => (
                    <div key={i} className="bg-slate-50 p-6 rounded-3xl border border-slate-100">
                      <p className="font-bold text-slate-900 mb-2">Q: {faq.q}</p>
                      <p className="text-sm text-slate-600 leading-relaxed">A: {faq.a}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-indigo-600 rounded-[2rem] p-10 text-white text-center shadow-2xl shadow-indigo-100 relative overflow-hidden">
                <div className="relative z-10">
                  <h3 className="text-2xl font-black mb-4">Still need assistance?</h3>
                  <p className="opacity-80 mb-8 max-w-lg mx-auto">Chef Anthony is available for 1-on-1 kitchen workflow optimization. Use the Prep Agent voice interface to ask specific tactical questions.</p>
                  <button onClick={() => setActiveTab('agent')} className="bg-white text-indigo-600 px-8 py-3 rounded-full font-black hover:bg-indigo-50 transition-colors">Talk to Prep Agent</button>
                </div>
                <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500 rounded-full -mr-20 -mt-20 blur-3xl opacity-30"></div>
                <div className="absolute bottom-0 left-0 w-64 h-64 bg-indigo-400 rounded-full -ml-20 -mb-20 blur-3xl opacity-20"></div>
              </div>
            </div>
          )}
        </div>
        
        <div className="md:hidden bg-white border-t flex justify-around p-3 pb-6 shrink-0 z-50">
          <button onClick={() => setActiveTab('dashboard')} className={activeTab === 'dashboard' ? 'text-indigo-600' : 'text-slate-400'}><Icons.Dashboard /></button>
          <button onClick={() => setActiveTab('inputs')} className={activeTab === 'inputs' ? 'text-indigo-600' : 'text-slate-400'}><Icons.Search /></button>
          <button onClick={() => setActiveTab('preplist')} className={activeTab === 'preplist' ? 'text-indigo-600' : 'text-slate-400'}><Icons.ChefHat /></button>
          <button onClick={() => setActiveTab('pmix')} className={activeTab === 'pmix' ? 'text-indigo-600' : 'text-slate-400'}><Icons.Trend /></button>
          <button onClick={() => setActiveTab('agent')} className={activeTab === 'agent' ? 'text-indigo-600 scale-125' : 'text-slate-400'}><Icons.Bot /></button>
        </div>
      </main>
      
      <style>{`
        @keyframes shimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }
        .animate-in { animation: fadeIn 0.4s ease-out; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
};

export default App;
