"use client";

interface ActivityDay {
  date: string;
  count: number;
}

export function ActivityChart({ data }: { data: ActivityDay[] }) {
  const maxCount = Math.max(...data.map((d) => d.count), 1);
  const barHeight = 120;

  return (
    <div className="flex items-end gap-2 h-[140px]">
      {data.map((day, i) => {
        const height = (day.count / maxCount) * barHeight;
        const dateLabel = day.date.slice(5); // MM-DD
        return (
          <div key={day.date} className="flex-1 flex flex-col items-center gap-1">
            <span className="text-xs text-pi-ink-muted tabular-nums">
              {day.count}
            </span>
            <div
              className="w-full rounded-t-md bg-pi-gold/20 relative overflow-hidden"
              style={{ height: `${height}px` }}
            >
              <div
                className="absolute bottom-0 w-full bg-pi-gold rounded-t-md animate-fill"
                style={{
                  height: "100%",
                  animationDelay: `${0.3 + i * 0.1}s`,
                }}
              />
            </div>
            <span className="text-xs text-pi-ink-muted">{dateLabel}</span>
          </div>
        );
      })}
    </div>
  );
}
