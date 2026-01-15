
import React, { useState, useEffect, useRef, useMemo } from 'react';
import Sidebar from './components/Sidebar';
import ForecastChart from './components/ForecastChart';
import { 
  INITIAL_PREP_ITEMS, 
  INITIAL_INVENTORY, 
  INITIAL_WASTE, 
  MOCK_FORECAST, 
  MOCK_VELOCITY, 
  MENU_ITEMS,
  Icons 
} from './constants';
import { PrepItem, InventoryItem, WasteEntry, VelocityMetric, ForecastData, AIResponse, MenuItem } from './types';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';

// Audio Utility Functions
function decode(base64: string) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function encode(bytes: Uint8Array) {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function decodeAudioData(data: Uint8Array, ctx: AudioContext, sampleRate: number, numChannels: number): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

// Fixed Tooltip Component: Strictly drops DOWN and aligns smartly
const Tooltip: React.FC<{ what: string, source: string, why: string, align?: 'left' | 'right' | 'center' }> = ({ what, source, why, align = 'center' }) => {
  const alignClasses = {
    left: 'left-0 translate-x-0',
    right: 'right-0 -translate-x-full left-full',
    center: 'left-1/2 -translate-x-1/2'
  };
  const arrowClasses = {
    left: 'left-2',
    right: 'right-2',
    center: 'left-1/2 -translate-x-1/2'
  };

  return (
    <div className="group relative inline-block ml-1">
      <div className="cursor-help text-slate-400 hover:text-indigo-600 transition-colors">
        <Icons.Info />
      </div>
      {/* Positioned at TOP-FULL with MT-3 to strictly DROP DOWN */}
      <div className={`absolute top-full mt-3 hidden group-hover:block w-72 p-4 bg-slate-900 text-white text-[11px] rounded-2xl shadow-2xl z-[100] ${alignClasses[align]}`}>
        <div className="space-y-3">
          <div>
            <span className="font-bold text-indigo-400 block uppercase tracking-widest text-[9px] mb-1">What it is</span>
            <p className="leading-relaxed opacity-90">{what}</p>
          </div>
          <div>
            <span className="font-bold text-indigo-400 block uppercase tracking-widest text-[9px] mb-1">Source</span>
            <p className="leading-relaxed opacity-90">{source}</p>
          </div>
          <div>
            <span className="font-bold text-indigo-400 block uppercase tracking-widest text-[9px] mb-1">Why needed</span>
            <p className="leading-relaxed opacity-90">{why}</p>
          </div>
        </div>
        {/* Arrow points UP at the icon */}
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
  
  const [daypartVolumes, setDaypartVolumes] = useState({
    breakfast: 50,
    lunch: 120,
    dinner: 180
  });

  const totalTargetVolume = useMemo(() => 
    daypartVolumes.breakfast + daypartVolumes.lunch + daypartVolumes.dinner
  , [daypartVolumes]);
  
  const [isLiveActive, setIsLiveActive] = useState(false);
  const [transcription, setTranscription] = useState<{user: string, agent: string}[]>([]);
  const [currentAgentText, setCurrentAgentText] = useState('');
  const [currentUserText, setCurrentUserText] = useState('');
  
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const sessionRef = useRef<any>(null);
  const nextStartTimeRef = useRef(0);
  const sourcesRef = useRef(new Set<AudioBufferSourceNode>());

  const lowStockItems = useMemo(() => inventory.filter(item => item.currentStock < item.threshold), [inventory]);

  const toggleItemStatus = (id: string) => {
    setPrepItems(prev => prev.map(item => item.id === id ? { ...item, status: item.status === 'Pending' ? 'In-Progress' : item.status === 'In-Progress' ? 'Completed' : 'Pending' } : item));
  };

  const startLiveSession = async () => {
    if (isLiveActive) {
      sessionRef.current?.close();
      setIsLiveActive(false);
      return;
    }

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
            sessionPromise.then(session => {
              session.sendRealtimeInput({ media: { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' } });
            });
          };
          source.connect(scriptProcessor);
          scriptProcessor.connect(inputAudioContextRef.current!.destination);
        },
        onmessage: async (message: LiveServerMessage) => {
          if (message.serverContent?.outputTranscription) {
            setCurrentAgentText(prev => prev + message.serverContent!.outputTranscription!.text);
          } else if (message.serverContent?.inputTranscription) {
            setCurrentUserText(prev => prev + message.serverContent!.inputTranscription!.text);
          }

          if (message.serverContent?.turnComplete) {
            setTranscription(prev => [...prev, { user: currentUserText, agent: currentAgentText }]);
            setCurrentUserText('');
            setCurrentAgentText('');
          }

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

          if (message.serverContent?.interrupted) {
            sourcesRef.current.forEach(s => s.stop());
            sourcesRef.current.clear();
            nextStartTimeRef.current = 0;
          }
        },
        onclose: () => setIsLiveActive(false),
        onerror: (e) => console.error("Live Error", e),
      },
      config: {
        responseModalities: [Modality.AUDIO],
        outputAudioTranscription: {},
        inputAudioTranscription: {},
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } },
        systemInstruction: `You are the PrepList Agent™, an intelligent sous-chef advisor. 
        Your conversation MUST start with: "What are we prepping for?" 
        Then follow this specific sequence:
        1. Ask which daypart they are planning (Lunch, Dinner, Late Night, All Day).
        2. Ask how many total meals are projected for that daypart.
        3. Once they give a number, say: "Understood. Based on your Product Mix of ${menuItems.map(m => `${m.name} at ${m.productMix*100}%`).join(', ')}, I've calculated the necessary prep for those ${totalTargetVolume} meals."
        4. Summarize the biggest prep tasks (e.g. "We'll need to prep 20kg of chicken...").
        Be professional, concise, and helpful.`
      }
    });

    sessionRef.current = await sessionPromise;
  };

  const pmixCalculations = useMemo(() => {
    return menuItems.map(menuItem => {
      const units = Math.round(totalTargetVolume * menuItem.productMix);
      const ingredientsNeeded = menuItem.ingredients.map(ing => {
        const prepItem = prepItems.find(p => p.id === ing.prepItemId);
        return {
          name: prepItem?.name || 'Unknown',
          amount: (ing.amountPerUnit * units).toFixed(2),
          unit: prepItem?.unit || ''
        };
      });
      return { ...menuItem, units, ingredientsNeeded };
    });
  }, [menuItems, totalTargetVolume, prepItems]);

  const updateVolume = (daypart: keyof typeof daypartVolumes, val: string) => {
    setDaypartVolumes(prev => ({ ...prev, [daypart]: parseInt(val) || 0 }));
  };

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-[#f8fafc]">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      
      <main className="flex-1 md:ml-64 flex flex-col h-screen overflow-hidden">
        {/* Top Header */}
        <header className="p-4 md:p-6 bg-white border-b flex justify-between items-center shrink-0">
          <div>
            <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <span className="p-1.5 bg-indigo-600 text-white rounded-lg"><Icons.ChefHat /></span>
              PrepList Agent™
            </h1>
            <p className="text-xs text-slate-500 font-medium">Kitchen Intelligence & P-Mix Forecasting</p>
          </div>
          <div className="flex gap-2">
             <button 
              onClick={startLiveSession}
              className={`flex items-center gap-2 px-6 py-2 rounded-full font-bold transition-all shadow-lg shadow-indigo-100 ${
                isLiveActive ? 'bg-rose-500 text-white animate-pulse' : 'bg-indigo-600 text-white hover:bg-indigo-700'
              }`}
            >
              {isLiveActive ? <Icons.MicOff /> : <Icons.Mic />}
              {isLiveActive ? 'Live Planning' : 'Start Prep Talk'}
            </button>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-8">
          
          {activeTab === 'agent' && (
            <div className="max-w-4xl mx-auto flex flex-col h-full space-y-6">
              <div className="bg-white rounded-3xl border shadow-sm p-8 flex flex-col items-center justify-center space-y-6 relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-indigo-50 overflow-hidden">
                    {isLiveActive && <div className="h-full bg-indigo-500 animate-[shimmer_2s_infinite]"></div>}
                </div>
                
                <div className={`w-32 h-32 rounded-full flex items-center justify-center transition-all duration-500 relative ${
                  isLiveActive ? 'bg-indigo-50 border-4 border-indigo-100' : 'bg-slate-50 border-4 border-slate-50'
                }`}>
                  <div className={`w-16 h-16 bg-indigo-600 rounded-full flex items-center justify-center text-white shadow-xl shadow-indigo-100 z-10 ${
                    isLiveActive ? 'animate-bounce' : ''
                  }`}>
                    <Icons.Bot />
                  </div>
                  {isLiveActive && (
                    <>
                        <div className="absolute w-32 h-32 border-2 border-indigo-400 rounded-full animate-ping opacity-25"></div>
                        <div className="absolute w-40 h-40 border-2 border-indigo-200 rounded-full animate-pulse opacity-20"></div>
                    </>
                  )}
                </div>
                <div className="text-center z-10">
                  <h2 className="text-xl font-bold text-slate-900">
                    {isLiveActive ? "Listening to Chef..." : transcription.length > 0 ? "Insights Ready" : "Hello Chef! Tap to start planning."}
                  </h2>
                  <p className="text-sm text-slate-500 max-sm mx-auto">
                    {isLiveActive ? "Tell me what we're prepping for. I'll handle the math." : "I use your Product Mix data to transform meal forecasts into specific prep tasks."}
                  </p>
                </div>
              </div>

              <div className="flex-1 flex flex-col space-y-4">
                {transcription.map((t, i) => (
                  <div key={i} className="space-y-4">
                    <div className="flex justify-end">
                      <div className="bg-indigo-600 text-white px-5 py-3 rounded-2xl rounded-tr-none text-sm max-w-[85%] shadow-sm">
                        {t.user}
                      </div>
                    </div>
                    <div className="flex justify-start">
                      <div className="bg-white border border-slate-100 text-slate-800 px-5 py-3 rounded-2xl rounded-tl-none text-sm max-w-[85%] shadow-sm font-medium">
                        {t.agent}
                      </div>
                    </div>
                  </div>
                ))}
                
                {currentUserText && (
                  <div className="flex justify-end">
                    <div className="bg-indigo-500 text-white px-5 py-3 rounded-2xl rounded-tr-none text-sm max-w-[85%] animate-pulse">
                      {currentUserText}
                    </div>
                  </div>
                )}
                {currentAgentText && (
                  <div className="flex justify-start">
                    <div className="bg-white border border-indigo-100 text-slate-800 px-5 py-3 rounded-2xl rounded-tl-none text-sm max-w-[85%] shadow-sm">
                      {currentAgentText}
                    </div>
                  </div>
                )}
                
                {transcription.length === 0 && !isLiveActive && (
                  <div className="flex flex-col items-center py-10 opacity-40 space-y-2">
                    <Icons.Bot />
                    <p className="text-sm italic">"What are we prepping for?"</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'pmix' && (
            <div className="max-w-7xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                
                <div className="lg:col-span-1 space-y-6">
                  <div className="bg-white rounded-3xl border shadow-sm p-6 overflow-visible">
                    <h3 className="font-bold text-slate-900 mb-4 flex items-center gap-2">
                        <Icons.Trend /> Product Mix
                        <Tooltip 
                          what="The statistical distribution of menu item sales over time." 
                          source="Integrated POS transaction history." 
                          why="Essential for calculating ingredient requirements for guest counts." 
                          align="left"
                        />
                    </h3>
                    <div className="space-y-4">
                      {menuItems.map(item => (
                        <div key={item.id} className="space-y-1.5">
                          <div className="flex justify-between text-xs font-bold">
                            <span className="text-slate-600">{item.name}</span>
                            <span className="text-indigo-600">{(item.productMix * 100).toFixed(0)}%</span>
                          </div>
                          <div className="w-full bg-slate-100 rounded-full h-1.5">
                            <div className="bg-indigo-500 h-full rounded-full" style={{ width: `${item.productMix * 100}%` }}></div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="bg-slate-900 text-white rounded-3xl p-6 shadow-xl">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Daily Total Forecast</h3>
                    <p className="text-4xl font-black text-white">{totalTargetVolume}</p>
                    <p className="text-[10px] text-slate-400 mt-2 italic">Sum of all planned dayparts</p>
                  </div>
                </div>

                <div className="lg:col-span-3 grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="bg-amber-50 rounded-3xl border border-amber-100 p-6 flex flex-col justify-between relative overflow-visible shadow-sm">
                    <div>
                      <h3 className="font-bold text-amber-900 flex items-center gap-2">
                        🍳 Breakfast/Brunch
                        <Tooltip 
                          what="Prep targets specifically for the morning and brunch rush." 
                          source="POS patterns (06:00 - 11:00)." 
                          why="Items like eggs and pastries require daily morning-fresh prep." 
                          align="left"
                        />
                      </h3>
                      <p className="text-[10px] text-amber-700 font-bold uppercase tracking-wider mt-1 opacity-70">Daypart Planning</p>
                    </div>
                    <div className="mt-8">
                      <label className="block text-[10px] font-black text-amber-800 uppercase mb-1">Projected Meals</label>
                      <input 
                        type="number" 
                        value={daypartVolumes.breakfast}
                        onChange={(e) => updateVolume('breakfast', e.target.value)}
                        className="w-full bg-white/50 border-amber-200 border-2 rounded-2xl px-4 py-3 text-2xl font-black text-amber-900 focus:ring-2 focus:ring-amber-400 outline-none"
                      />
                    </div>
                  </div>

                  <div className="bg-indigo-50 rounded-3xl border border-indigo-100 p-6 flex flex-col justify-between relative overflow-visible shadow-sm">
                    <div>
                      <h3 className="font-bold text-indigo-900 flex items-center gap-2">
                        ☀️ Lunch Rush
                        <Tooltip 
                          what="Prep targets for the highest volume shift." 
                          source="POS velocity (11:30 - 14:30)." 
                          why="Lunch requires peak mise en place to maintain quick turn times." 
                          align="center"
                        />
                      </h3>
                      <p className="text-[10px] text-indigo-700 font-bold uppercase tracking-wider mt-1 opacity-70">Daypart Planning</p>
                    </div>
                    <div className="mt-8">
                      <label className="block text-[10px] font-black text-indigo-800 uppercase mb-1">Projected Meals</label>
                      <input 
                        type="number" 
                        value={daypartVolumes.lunch}
                        onChange={(e) => updateVolume('lunch', e.target.value)}
                        className="w-full bg-white/50 border-indigo-200 border-2 rounded-2xl px-4 py-3 text-2xl font-black text-indigo-900 focus:ring-2 focus:ring-indigo-400 outline-none"
                      />
                    </div>
                  </div>

                  <div className="bg-slate-50 rounded-3xl border border-slate-200 p-6 flex flex-col justify-between relative overflow-visible shadow-sm">
                    <div>
                      <h3 className="font-bold text-slate-900 flex items-center gap-2">
                        🌙 Dinner Service
                        <Tooltip 
                          what="Prep targets for the evening service." 
                          source="POS peaks (17:00 - 22:00)." 
                          why="Dinner often involves complex prep and larger portion sizes." 
                          align="right"
                        />
                      </h3>
                      <p className="text-[10px] text-slate-700 font-bold uppercase tracking-wider mt-1 opacity-70">Daypart Planning</p>
                    </div>
                    <div className="mt-8">
                      <label className="block text-[10px] font-black text-slate-800 uppercase mb-1">Projected Meals</label>
                      <input 
                        type="number" 
                        value={daypartVolumes.dinner}
                        onChange={(e) => updateVolume('dinner', e.target.value)}
                        className="w-full bg-white border-slate-300 border-2 rounded-2xl px-4 py-3 text-2xl font-black text-slate-900 focus:ring-2 focus:ring-slate-400 outline-none"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-3xl border shadow-sm overflow-visible">
                <div className="p-6 border-b bg-slate-50 rounded-t-3xl flex justify-between items-center">
                  <h3 className="font-bold text-slate-900">
                    Volume Explosion (Aggregated Daily)
                    <Tooltip 
                      what="Daily ingredient requirements for all daypart forecasts combined." 
                      source="Recipe explosion x total daily volume." 
                      why="Provides a single consolidated target for morning prep teams." 
                      align="left"
                    />
                  </h3>
                  <div className="flex gap-4 items-center">
                    <div className="flex flex-col items-end">
                      <span className="text-[10px] font-bold text-slate-400 uppercase">Total Day Target</span>
                      <span className="text-sm font-black text-indigo-600">{totalTargetVolume} Meals</span>
                    </div>
                  </div>
                </div>
                <div className="divide-y">
                  {pmixCalculations.map(item => (
                    <div key={item.id} className="p-6 space-y-4 hover:bg-slate-50 transition-colors overflow-visible">
                      <div className="flex justify-between items-start">
                        <div>
                          <h4 className="text-lg font-bold text-slate-900">{item.name}</h4>
                          <p className="text-sm text-slate-500 italic">Expected Daily Units: <span className="font-bold text-indigo-600">{item.units}</span></p>
                        </div>
                        <div className="text-right">
                          <span className="text-xs font-bold bg-indigo-50 text-indigo-600 px-3 py-1 rounded-full uppercase">PMix {(item.productMix * 100).toFixed(0)}%</span>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 overflow-visible">
                        {item.ingredientsNeeded.map((ing, idx) => (
                          <div key={idx} className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm flex flex-col items-center text-center group hover:border-indigo-200 transition-colors">
                            <span className="text-[10px] text-slate-400 uppercase font-black mb-1 group-hover:text-indigo-400">{ing.name}</span>
                            <span className="text-xl font-black text-slate-800">{ing.amount} <span className="text-xs font-medium text-slate-500">{ing.unit}</span></span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'dashboard' && (
            <div className="space-y-6">
              <div className="bg-white p-6 rounded-3xl border shadow-sm overflow-visible">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-slate-900 flex items-center gap-2">
                    <Icons.Dashboard /> AI Data Hub Connectivity
                  </h3>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Real-time Sync Active</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {[
                    { label: 'POS System', status: 'Connected', source: 'Simulated API' },
                    { label: 'Inventory', status: 'Linked', source: 'IMS Direct' },
                    { label: 'Recipes', status: 'Synced', source: 'Digital Book' },
                    { label: 'Waste Logs', status: 'Active', source: 'Manual' },
                  ].map((item, idx) => (
                    <div key={idx} className="p-3 bg-slate-50 rounded-2xl border border-slate-100">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-bold text-slate-500 uppercase">{item.label}</span>
                        <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                      </div>
                      <p className="text-xs font-bold text-emerald-600 mb-0.5">{item.status}</p>
                      <p className="text-[9px] text-slate-400">{item.source}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white p-6 rounded-3xl border shadow-sm relative overflow-visible">
                   <h3 className="text-slate-500 text-sm font-medium mb-1">
                     Low Stock Alerts
                     <Tooltip 
                        what="Ingredients below preset 'Par Levels' for upcoming forecasts." 
                        source="Live IMS counts." 
                        why="Prevents '86ing' menu items during peaks." 
                        align="left"
                      />
                   </h3>
                   <p className="text-3xl font-bold text-slate-900">{lowStockItems.length}</p>
                   {lowStockItems.map(i => <div key={i.id} className="mt-2 text-xs text-rose-600 font-bold uppercase flex items-center gap-1"><Icons.Alert /> {i.name}</div>)}
                </div>
                <div className="bg-white p-6 rounded-3xl border shadow-sm overflow-visible">
                   <h3 className="text-slate-500 text-sm font-medium mb-1">
                     Daily Forecast
                     <Tooltip 
                        what="AI-driven prediction of total sales revenue." 
                        source="Predictive Models + Historical POS." 
                        why="Determines total production targets." 
                        align="center"
                      />
                   </h3>
                   <p className="text-3xl font-bold text-slate-900">$4,820</p>
                   <p className="text-xs text-emerald-600">+5% above average</p>
                </div>
                <div className="bg-white p-6 rounded-3xl border shadow-sm overflow-visible">
                   <h3 className="text-slate-500 text-sm font-medium mb-1">
                     Waste Logs
                     <Tooltip 
                        what="Food discarded due to spoilage or over-prep." 
                        source="Manual Kitchen Waste tracking." 
                        why="Identifies 'Over-Prep' patterns to reduce costs." 
                        align="right"
                      />
                   </h3>
                   <p className="text-3xl font-bold text-slate-900">{wasteLogs.length}</p>
                   <p className="text-xs text-slate-400">Total entries today</p>
                </div>
              </div>
              <div className="bg-white p-6 rounded-3xl border shadow-sm overflow-visible">
                <h3 className="font-bold text-slate-900 mb-6">
                  Historical Demand Visualization
                  <Tooltip 
                    what="Chart comparing predicted vs actual sales." 
                    source="POS and Forecaster Data." 
                    why="Used to verify AI accuracy." 
                    align="left"
                  />
                </h3>
                <ForecastChart data={MOCK_FORECAST} />
              </div>
            </div>
          )}

          {activeTab === 'inventory' && (
            <div className="bg-white border rounded-2xl shadow-sm overflow-visible animate-in fade-in slide-in-from-bottom-4 duration-500">
               <div className="p-6 border-b flex justify-between items-center bg-slate-50 rounded-t-2xl">
                <h3 className="font-bold text-slate-900">
                  Inventory Status
                  <Tooltip 
                    what="Current raw material counts prior to daily prep." 
                    source="Digital IMS Sync." 
                    why="The starting point for all prep logic." 
                    align="left"
                  />
                </h3>
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
        </div>
        
        {/* Mobile Navigation */}
        <div className="md:hidden bg-white border-t flex justify-around p-3 pb-6 shrink-0 z-50">
          <button onClick={() => setActiveTab('dashboard')} className={activeTab === 'dashboard' ? 'text-indigo-600' : 'text-slate-400'}><Icons.Dashboard /></button>
          <button onClick={() => setActiveTab('preplist')} className={activeTab === 'preplist' ? 'text-indigo-600' : 'text-slate-400'}><Icons.ChefHat /></button>
          <button onClick={() => setActiveTab('pmix')} className={activeTab === 'pmix' ? 'text-indigo-600' : 'text-slate-400'}><Icons.Trend /></button>
          <button onClick={() => setActiveTab('agent')} className={activeTab === 'agent' ? 'text-indigo-600 scale-125 transition-transform' : 'text-slate-400'}><Icons.Bot /></button>
          <button onClick={() => setActiveTab('inventory')} className={activeTab === 'inventory' ? 'text-indigo-600' : 'text-slate-400'}><Icons.Inventory /></button>
        </div>
      </main>
      
      <style>{`
        @keyframes shimmer {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  );
};

export default App;
