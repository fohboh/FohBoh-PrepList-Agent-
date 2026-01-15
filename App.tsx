
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
import { PrepItem, InventoryItem, WasteEntry, MenuItem, SpecialEvent } from './types';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';

const DAYPART_AVG_CHECK = { breakfast: 12.50, lunch: 18.75, dinner: 28.50 };

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
  const [activeTab, setActiveTab] = useState('agent');
  const [prepItems, setPrepItems] = useState<PrepItem[]>(INITIAL_PREP_ITEMS);
  const [inventory, setInventory] = useState<InventoryItem[]>(INITIAL_INVENTORY);
  const [wasteLogs, setWasteLogs] = useState<WasteEntry[]>(INITIAL_WASTE);
  const [menuItems, setMenuItems] = useState<MenuItem[]>(MENU_ITEMS);
  const [specialEvents, setSpecialEvents] = useState<SpecialEvent[]>([]);
  
  const [daypartVolumes, setDaypartVolumes] = useState({ breakfast: 50, lunch: 120, dinner: 180 });

  const totalTargetVolume = useMemo(() => daypartVolumes.breakfast + daypartVolumes.lunch + daypartVolumes.dinner, [daypartVolumes]);
  const totalSalesForecast = useMemo(() => 
    (daypartVolumes.breakfast * DAYPART_AVG_CHECK.breakfast) +
    (daypartVolumes.lunch * DAYPART_AVG_CHECK.lunch) +
    (daypartVolumes.dinner * DAYPART_AVG_CHECK.dinner), [daypartVolumes]);
  
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
    
    // Baseline Need based on historical PMIX average (Simulated as forecastNeeded here)
    let baseNeed = item.forecastNeeded;
    
    // Rule: Apply 75/25 rule for Thu-Sun vs Mon-Wed
    const multiplier = isWeekend ? 1.5 : 0.5; // Scaled specifically for daily variation
    baseNeed = baseNeed * multiplier;

    // Apply Buffer (25% standard for proteins, 15% others)
    const buffer = item.category === 'Protein' ? 1.25 : 1.15;
    let bufferedNeed = baseNeed * buffer;

    // Subtract Inventory
    let toPrep = Math.max(0, bufferedNeed - item.currentStock);

    // Perishable Limit
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
        MANDATORY START: "What are we prepping for?"
        Logic: Use Product Mix data (${menuItems.map(m => `${m.name} ${m.productMix*100}%`).join(', ')}) and total forecast of ${totalTargetVolume} meals.
        CRITICAL: All your responses must clearly label AI suggestions vs. deterministic rules.
        Example: "[AI SUGGESTION] I see sales of chicken bowls are up 15%, you may want to increase par by 2kg."`
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

          {activeTab === 'preplist' && (
            <div className="max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500">
              <div className="flex justify-between items-end">
                 <div><h2 className="text-2xl font-black text-slate-900">Digital Prep List</h2><p className="text-sm text-slate-500 italic">Source: Deterministic rules-engine + manual inventory counts</p></div>
                 <div className="bg-white border p-3 rounded-2xl shadow-sm text-right">
                    <span className="text-[10px] font-black text-slate-400 uppercase">Approval Required</span>
                    <button className="block text-sm font-bold text-indigo-600 hover:text-indigo-800">Generate Final PDF</button>
                 </div>
              </div>
              
              {/* Fix: Explicitly cast the values from Object.entries to PrepItem[] to satisfy TypeScript's unknown type inference */}
              {(Object.entries(stations) as [string, PrepItem[]][]).map(([station, items]) => (
                <div key={station} className="bg-white rounded-3xl border shadow-sm overflow-visible">
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
                <div className="lg:col-span-3 grid grid-cols-1 md:grid-cols-3 gap-6">
                  {['breakfast', 'lunch', 'dinner'].map((dp) => (
                    <div key={dp} className={`rounded-3xl border p-6 flex flex-col justify-between relative overflow-visible shadow-sm ${dp === 'breakfast' ? 'bg-amber-50 border-amber-100' : dp === 'lunch' ? 'bg-indigo-50 border-indigo-100' : 'bg-slate-50 border-slate-200'}`}>
                      <div>
                        <h3 className={`font-bold capitalize flex items-center gap-2 ${dp === 'breakfast' ? 'text-amber-900' : dp === 'lunch' ? 'text-indigo-900' : 'text-slate-900'}`}>
                          {dp} Service <Tooltip what={`Forecast for ${dp} rush.`} source="Historical averages." why="Production targets." align="center" />
                        </h3>
                        <p className="text-[10px] font-bold uppercase tracking-wider mt-1 opacity-70">Avg Check: ${DAYPART_AVG_CHECK[dp as keyof typeof DAYPART_AVG_CHECK].toFixed(2)}</p>
                      </div>
                      <div className="mt-8">
                        <label className="block text-[10px] font-black uppercase mb-1">Meals</label>
                        <input type="number" value={daypartVolumes[dp as keyof typeof daypartVolumes]} onChange={(e) => setDaypartVolumes(v => ({ ...v, [dp]: parseInt(e.target.value) || 0 }))} className="w-full bg-white/50 border-2 rounded-2xl px-4 py-3 text-2xl font-black focus:ring-2 outline-none" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'dashboard' && (
            <div className="space-y-6">
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
              <div className="bg-white p-6 rounded-3xl border shadow-sm overflow-visible">
                <div className="flex flex-col md:flex-row md:items-end justify-between mb-6 gap-4">
                  <h3 className="font-bold text-slate-900">Historical Demand Visualization <Tooltip what="Actual vs Predicted Sales." source="POS data." why="AI and Rules verification." align="left" /></h3>
                </div>
                <ForecastChart data={MOCK_FORECAST} />
              </div>
            </div>
          )}
        </div>
        
        <div className="md:hidden bg-white border-t flex justify-around p-3 pb-6 shrink-0 z-50">
          <button onClick={() => setActiveTab('dashboard')} className={activeTab === 'dashboard' ? 'text-indigo-600' : 'text-slate-400'}><Icons.Dashboard /></button>
          <button onClick={() => setActiveTab('preplist')} className={activeTab === 'preplist' ? 'text-indigo-600' : 'text-slate-400'}><Icons.ChefHat /></button>
          <button onClick={() => setActiveTab('pmix')} className={activeTab === 'pmix' ? 'text-indigo-600' : 'text-slate-400'}><Icons.Trend /></button>
          <button onClick={() => setActiveTab('agent')} className={activeTab === 'agent' ? 'text-indigo-600 scale-125' : 'text-slate-400'}><Icons.Bot /></button>
          <button onClick={() => setActiveTab('inventory')} className={activeTab === 'inventory' ? 'text-indigo-600' : 'text-slate-400'}><Icons.Inventory /></button>
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
