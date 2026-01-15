
import { GoogleGenAI, Type } from "@google/genai";
import { PrepItem, ForecastData, VelocityMetric, WasteEntry } from "../types";

export class PrepAgentService {
  private ai: GoogleGenAI;

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
  }

  async getInsights(
    query: string, 
    currentItems: PrepItem[], 
    forecast: ForecastData[], 
    velocity: VelocityMetric[],
    wasteLogs: WasteEntry[]
  ) {
    const context = `
      Current Prep List: ${JSON.stringify(currentItems)}
      Sales Forecast: ${JSON.stringify(forecast)}
      Menu Velocity: ${JSON.stringify(velocity)}
      Recent Waste History: ${JSON.stringify(wasteLogs)}
      
      User is asking: "${query}"
      
      You are the PrepList Agent™. Your goal is to optimize kitchen efficiency and reduce food waste.
      Analyze the data and provide a helpful, concise response. 
      Pay special attention to the Waste History; if certain items are consistently wasted, suggest reducing their prep volume.
      If adjustments are needed, specify which items and why.
    `;

    try {
      const response = await this.ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: context,
        config: {
          temperature: 0.7,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              message: { type: Type.STRING },
              suggestions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    prepNeeded: { type: Type.NUMBER },
                    priority: { type: Type.STRING },
                  }
                }
              },
              analysis: { type: Type.STRING }
            },
            required: ["message"]
          }
        }
      });

      return JSON.parse(response.text);
    } catch (error) {
      console.error("Gemini API Error:", error);
      return { message: "I'm having trouble connecting to my central brain. Please check your network." };
    }
  }

  async generateDailyList(forecast: ForecastData[], velocity: VelocityMetric[], wasteLogs: WasteEntry[]) {
    const prompt = `
      Based on this sales forecast: ${JSON.stringify(forecast)}
      This menu velocity: ${JSON.stringify(velocity)}
      And this recent waste: ${JSON.stringify(wasteLogs)}
      
      Generate a comprehensive daily prep list for a modern fast-casual restaurant.
      Crucial: If an item has high waste, reduce the "forecastNeeded" slightly below historical levels to prevent future loss.
      Focus on produce, proteins, and sauces.
    `;

    try {
      const response = await this.ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                name: { type: Type.STRING },
                category: { type: Type.STRING },
                unit: { type: Type.STRING },
                currentStock: { type: Type.NUMBER },
                forecastNeeded: { type: Type.NUMBER },
                prepNeeded: { type: Type.NUMBER },
                status: { type: Type.STRING },
                priority: { type: Type.STRING },
              },
              required: ["id", "name", "category", "unit", "forecastNeeded", "prepNeeded", "status", "priority"]
            }
          }
        }
      });
      return JSON.parse(response.text);
    } catch (error) {
      console.error("Prep Generation Error:", error);
      return null;
    }
  }
}
