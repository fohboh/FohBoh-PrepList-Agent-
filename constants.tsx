
import React from 'react';
import { PrepItem, ForecastData, VelocityMetric, InventoryItem, WasteEntry, MenuItem } from './types';

export const INITIAL_PREP_ITEMS: PrepItem[] = [
  { 
    id: '1', name: 'Diced Onions', category: 'Produce', station: 'Garde Manger', unit: 'kg', 
    currentStock: 0.5, forecastNeeded: 5.0, prepNeeded: 4.5, status: 'Pending', 
    priority: 'Medium', dueBy: '10:30 AM', shelfLifeDays: 2, requiresKnifeSkills: 4, costPerUnit: 1.20 
  },
  { 
    id: '2', name: 'Marinated Chicken', category: 'Protein', station: 'Butchery', unit: 'kg', 
    currentStock: 2.0, forecastNeeded: 12.0, prepNeeded: 10.0, status: 'In-Progress', 
    priority: 'High', assignedTo: 'Marco', dueBy: '11:30 AM', shelfLifeDays: 3, requiresKnifeSkills: 7, costPerUnit: 8.50 
  },
  { 
    id: '3', name: 'House Balsamic', category: 'Sauce', station: 'General Prep', unit: 'L', 
    currentStock: 0.8, forecastNeeded: 2.0, prepNeeded: 1.2, status: 'Completed', 
    priority: 'Medium', dueBy: '10:00 AM', shelfLifeDays: 7, requiresKnifeSkills: 2, costPerUnit: 4.50 
  },
  { 
    id: '4', name: 'Shredded Romaine', category: 'Produce', station: 'Garde Manger', unit: 'heads', 
    currentStock: 1.0, forecastNeeded: 8.0, prepNeeded: 7.0, status: 'Pending', 
    priority: 'High', dueBy: '11:00 AM', shelfLifeDays: 1, requiresKnifeSkills: 3, costPerUnit: 0.95 
  },
  { 
    id: '5', name: 'NY Strip Steaks', category: 'Protein', station: 'Butchery', unit: 'portions', 
    currentStock: 5.0, forecastNeeded: 30.0, prepNeeded: 25.0, status: 'Pending', 
    priority: 'High', dueBy: '12:00 PM', shelfLifeDays: 3, requiresKnifeSkills: 9, costPerUnit: 14.00 
  }
];

export const MENU_ITEMS: MenuItem[] = [
  { 
    id: 'm1', name: 'Chicken Bowl', productMix: 0.45, 
    history7Days: [0.42, 0.44, 0.43, 0.46, 0.45, 0.47, 0.45],
    ingredients: [{ prepItemId: '2', amountPerUnit: 0.15 }, { prepItemId: '1', amountPerUnit: 0.05 }] 
  },
  { 
    id: 'm2', name: 'Caesar Salad', productMix: 0.30, 
    history7Days: [0.35, 0.32, 0.33, 0.28, 0.29, 0.30, 0.30],
    ingredients: [{ prepItemId: '4', amountPerUnit: 1.0 }, { prepItemId: '3', amountPerUnit: 0.05 }] 
  },
  { 
    id: 'm3', name: 'Garden Wrap', productMix: 0.25, 
    history7Days: [0.23, 0.24, 0.24, 0.26, 0.26, 0.23, 0.25],
    ingredients: [{ prepItemId: '1', amountPerUnit: 0.02 }, { prepItemId: '4', amountPerUnit: 0.5 }] 
  }
];

export const INITIAL_INVENTORY: InventoryItem[] = [
  { id: 'inv_1', name: 'Whole Onions', currentStock: 15.0, threshold: 20.0, unit: 'kg', category: 'Produce' },
  { id: 'inv_2', name: 'Raw Chicken Breast', currentStock: 45.0, threshold: 30.0, unit: 'kg', category: 'Protein' },
  { id: 'inv_3', name: 'Balsamic Vinegar', currentStock: 5.0, threshold: 2.0, unit: 'L', category: 'Dry Goods' },
  { id: 'inv_4', name: 'Romaine Heads', currentStock: 12.0, threshold: 15.0, unit: 'heads', category: 'Produce' },
];

export const INITIAL_WASTE: WasteEntry[] = [
  { 
    id: 'w_1', 
    itemName: 'Diced Onions', 
    itemType: 'Prepared Item',
    quantity: 1.2, 
    unit: 'kg', 
    reason: 'Prepped for Friday but slow sales', 
    reasonCode: 'OVERPRODUCTION',
    category: 'Pre-Consumer',
    station: 'Garde Manger',
    shift: 'PM',
    staffInitials: 'JKR',
    timestamp: '2026-01-16T22:00:00Z',
    costPerUnit: 1.20,
    totalCost: 1.44,
    disposalMethod: 'Compost'
  },
  { 
    id: 'w_2', 
    itemName: 'Marinated Chicken', 
    itemType: 'Prepared Item',
    quantity: 2.5, 
    unit: 'kg', 
    reason: 'Temperature abuse in reach-in', 
    reasonCode: 'STORAGE',
    category: 'Pre-Consumer',
    station: 'Butchery',
    shift: 'AM',
    staffInitials: 'MA',
    timestamp: '2026-01-15T09:30:00Z',
    costPerUnit: 8.50,
    totalCost: 21.25,
    disposalMethod: 'Landfill'
  }
];

export const MOCK_FORECAST: ForecastData[] = [
  { time: '7:00 AM', actual: 40, predicted: 45 },
  { time: '9:00 AM', actual: 180, predicted: 160 },
  { time: '11:00 AM', actual: 450, predicted: 420 },
  { time: '1:00 PM', actual: 720, predicted: 700 },
  { time: '3:00 PM', actual: 310, predicted: 350 },
  { time: '5:00 PM', actual: 580, predicted: 600 },
  { time: '7:00 PM', actual: 940, predicted: 910 },
  { time: '9:00 PM', actual: 420, predicted: 480 },
  { time: '11:00 PM', actual: 150, predicted: 200 },
  { time: '12:00 AM', actual: 50, predicted: 80 },
];

export const MOCK_VELOCITY: VelocityMetric[] = [
  { item: 'Chicken Bowl', velocity: 45, trend: 'up' },
  { item: 'Caesar Salad', velocity: 32, trend: 'stable' },
];

export const Icons = {
  Dashboard: () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>
  ),
  ChefHat: () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 13.87A4 4 0 0 1 7.41 6a5.11 5.11 0 0 1 1.05-1.54 5 5 0 0 1 7.08 0A5.11 5.11 0 0 1 16.59 6 4 4 0 0 1 18 13.87V21H6Z"/><line x1="6" x2="18" y1="17" y2="17"/></svg>
  ),
  Trend: () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>
  ),
  Bot: () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>
  ),
  Check: () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
  ),
  Search: () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
  ),
  Inventory: () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>
  ),
  Trash: () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
  ),
  Alert: () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>
  ),
  Mic: () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
  ),
  MicOff: () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="2" x2="22" y1="2" y2="22"/><path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2"/><path d="M5 10v2a7 7 0 0 0 12 5"/><path d="M15 9.34V5a3 3 0 0 0-5.68-1.33"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
  ),
  Info: () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
  )
};
