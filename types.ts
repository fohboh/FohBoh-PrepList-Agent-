
export interface PrepItem {
  id: string;
  name: string;
  category: 'Produce' | 'Protein' | 'Dairy' | 'Sauce' | 'Other';
  station: 'Garde Manger' | 'Butchery' | 'Sauté' | 'Bar' | 'General Prep';
  unit: string;
  currentStock: number;
  forecastNeeded: number;
  prepNeeded: number;
  status: 'Pending' | 'In-Progress' | 'Completed';
  priority: 'High' | 'Medium' | 'Low';
  assignedTo?: string;
  dueBy: string; // e.g. "10:30 AM"
  shelfLifeDays: number;
  requiresKnifeSkills: number; // 1-10
  costPerUnit: number;
  whyExplanation?: string;
}

export interface MenuItem {
  id: string;
  name: string;
  productMix: number;
  history7Days: number[];
  ingredients: { prepItemId: string; amountPerUnit: number }[];
}

export interface DaypartConfig {
  volume: number;
  avgCheck: number;
}

export interface SpecialEvent {
  id: string;
  name: string;
  coverIncrease: number; // e.g. 1.2 for 20% increase
  menuFocus?: string;
}

export interface InventoryItem {
  id: string;
  name: string;
  currentStock: number;
  unit: string;
  threshold: number;
  category: string;
}

export type WasteReasonCode = 
  | 'SPOILAGE' 
  | 'OVERPRODUCTION' 
  | 'PREP_ERROR' 
  | 'PORTIONING' 
  | 'SERVICE' 
  | 'STORAGE' 
  | 'OTHER';

export type WasteCategory = 'Pre-Consumer' | 'Post-Consumer';

export interface WasteEntry {
  id: string;
  itemName: string;
  itemType: 'Raw Ingredient' | 'Prepared Item' | 'Finished Dish';
  quantity: number;
  unit: string;
  reason: string;
  reasonCode: WasteReasonCode;
  category: WasteCategory;
  station: string;
  shift: 'AM' | 'PM' | 'Overnight';
  staffInitials: string;
  timestamp: string;
  costPerUnit: number;
  totalCost: number;
  disposalMethod: 'Landfill' | 'Compost' | 'Animal Feed' | 'Donation' | 'Biofuel' | 'Other';
}

export interface ForecastData {
  time: string;
  actual: number;
  predicted: number;
}

export interface VelocityMetric {
  item: string;
  velocity: number;
  trend: 'up' | 'down' | 'stable';
}

export interface AIResponse {
  message: string;
  suggestions?: Partial<PrepItem>[];
  analysis?: string;
  isAiSuggestion: boolean;
}
