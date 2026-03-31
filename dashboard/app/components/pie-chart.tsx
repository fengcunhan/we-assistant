"use client";

interface PieSlice {
  label: string;
  value: number;
  color: string;
}

export function PieChart({ data }: { data: PieSlice[] }) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  if (total === 0) return null;

  const size = 160;
  const cx = size / 2;
  const cy = size / 2;
  const r = 60;

  let currentAngle = -Math.PI / 2;

  const slices = data.map((slice) => {
    const angle = (slice.value / total) * Math.PI * 2;
    const startX = cx + r * Math.cos(currentAngle);
    const startY = cy + r * Math.sin(currentAngle);
    const endX = cx + r * Math.cos(currentAngle + angle);
    const endY = cy + r * Math.sin(currentAngle + angle);
    const largeArc = angle > Math.PI ? 1 : 0;

    const path = [
      `M ${cx} ${cy}`,
      `L ${startX} ${startY}`,
      `A ${r} ${r} 0 ${largeArc} 1 ${endX} ${endY}`,
      "Z",
    ].join(" ");

    currentAngle += angle;

    return { ...slice, path, percentage: ((slice.value / total) * 100).toFixed(0) };
  });

  return (
    <div className="flex items-center gap-6">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="animate-rotate-in"
        style={{ animationDelay: "0.3s" }}
      >
        {slices.map((slice, i) => (
          <path
            key={i}
            d={slice.path}
            fill={slice.color}
            className="transition-opacity hover:opacity-80"
          />
        ))}
        <circle cx={cx} cy={cy} r="30" fill="var(--pi-cream)" />
        <text
          x={cx}
          y={cy - 4}
          textAnchor="middle"
          fontSize="20"
          fontWeight="600"
          fill="var(--pi-ink)"
        >
          {total}
        </text>
        <text
          x={cx}
          y={cy + 12}
          textAnchor="middle"
          fontSize="10"
          fill="var(--pi-ink-muted)"
        >
          total
        </text>
      </svg>

      <div className="space-y-2">
        {slices.map((slice, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <div
              className="w-3 h-3 rounded-sm"
              style={{ background: slice.color }}
            />
            <span className="text-pi-ink-soft">{slice.label}</span>
            <span className="text-pi-ink-muted ml-auto tabular-nums">
              {slice.percentage}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
