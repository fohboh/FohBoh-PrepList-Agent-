
import React from 'react';
import { Icons } from '../constants';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab }) => {
  const menuItems = [
    { id: 'home', label: 'Home', icon: <Icons.Dashboard /> },
    { id: 'dashboard', label: 'Dashboard', icon: <Icons.Trend /> },
    { id: 'inputs', label: 'Daily Inputs', icon: <Icons.Search /> },
    { id: 'preplist', label: 'Prep List', icon: <Icons.ChefHat /> },
    { id: 'pmix', label: 'P-Mix Analysis', icon: <Icons.Trend /> },
    { id: 'inventory', label: 'Inventory', icon: <Icons.Inventory /> },
    { id: 'waste', label: 'Waste Tracking', icon: <Icons.Trash /> },
    { id: 'agent', label: 'Prep Agent', icon: <Icons.Bot /> },
    { id: 'help', label: 'Help & FAQ', icon: <Icons.Info /> },
  ];

  return (
    <div className="w-64 bg-white border-r h-full flex flex-col fixed left-0 top-0 hidden md:flex shadow-sm z-20">
      <div className="p-6 border-b">
        <h1 className="text-xl font-bold text-indigo-600 flex items-center gap-2">
          <div className="bg-indigo-600 text-white p-1 rounded-md">
            <Icons.ChefHat />
          </div>
          PrepList Agent<span className="text-[10px] align-top">™</span>
        </h1>
      </div>
      
      <div className="p-4 border-b">
        <button 
          onClick={() => setActiveTab('get-started')}
          className={`w-full bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition-all shadow-md shadow-emerald-100 group active:scale-95 ${activeTab === 'get-started' ? 'ring-2 ring-emerald-500 ring-offset-2' : ''}`}
        >
          <Icons.Check />
          Get Started
        </button>
      </div>
      
      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {menuItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
              activeTab === item.id 
                ? 'bg-indigo-50 text-indigo-700 font-bold shadow-sm' 
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </nav>

      <div className="p-4 border-t">
        <div className="bg-slate-50 rounded-xl p-4">
          <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Logged in as</p>
          <div className="flex items-center gap-3">
            <img 
              src="https://picsum.photos/seed/chef/32/32" 
              className="w-8 h-8 rounded-full shadow-sm" 
              alt="Avatar"
            />
            <div>
              <p className="text-sm font-medium text-slate-900 line-clamp-1">Chef Anthony</p>
              <p className="text-xs text-slate-500 uppercase font-black">KM Station 1</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Sidebar;
