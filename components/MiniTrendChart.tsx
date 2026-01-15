
import React from 'react';
import { BarChart, Bar, ResponsiveContainer, YAxis, Tooltip } from 'recharts';

interface MiniTrendChartProps {
  data: number[];
}

const MiniTrendChart: React.FC<MiniTrendChartProps> = ({ data }) => {
  const chartData = data.map((val, idx) => ({ day: idx, value: val * 100 }));

  return (
    <div className="h-12 w-full mt-2">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData}>
          <Bar 
            dataKey="value" 
            fill="#6366f1" 
            radius={[2, 2, 0, 0]} 
            isAnimationActive={false}
          />
          <Tooltip 
            cursor={{fill: '#f1f5f9'}}
            content={({ active, payload }) => {
              if (active && payload && payload.length) {
                return (
                  <div className="bg-slate-900 text-white text-[10px] px-2 py-1 rounded shadow-xl">
                    {payload[0].value?.toString().slice(0, 4)}%
                  </div>
                );
              }
              return null;
            }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

export default MiniTrendChart;
