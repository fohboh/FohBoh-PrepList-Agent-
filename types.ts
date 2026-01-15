
export interface PrepItem {
  id: string;
  name: string;
  category: 'Produce' | 'Protein' | 'Dairy' | 'Sauce' | 'Other';
  unit: string;
  currentStock: number;
  forecastNeeded: number;
  prepNeeded: number;
  status: 'Pending' | 'In-Progress' | 'Completed';
  priority: 'High' | 'Medium' | 'Low';
  assignedTo?: string;
}

export interface MenuItem {
  id: string;
  name: string;
  productMix: number; // Percentage (e.g. 0.35 for 35%)
  ingredients: { prepItemId: string; amountPerUnit: number }[];
}

export interface DaypartConfig {
  name: string;
  projectedMeals: number;
}

export interface InventoryItem {
  id: string;
  name: string;
  currentStock: number;
  unit: string;
  threshold: number;
  category: string;
}

export interface WasteEntry {
  id: string;
  itemName: string;
  quantity: number;
  unit: string;
  reason: string;
  timestamp: string;
}

export interface ForecastData {
  time: string;
  actual: number;
  predicted: number;
}

export interface VelocityMetric {
  item: string;
  velocity: number; // units per hour
  trend: 'up' | 'down' | 'stable';
}

export interface AIResponse {
  message: string;
  suggestions?: Partial<PrepItem>[];
  analysis?: string;
}
