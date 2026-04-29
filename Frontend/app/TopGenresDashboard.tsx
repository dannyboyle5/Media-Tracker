import React, { useState } from 'react';

// ── TYPES ────────────────────────────────────────────────────────────────────
interface StatData { name: string; percent: number; }
interface CategoryStats { id: string; title: string; topStat: StatData; topStats: StatData[]; color: string; }

// ── MAIN EXPORT COMPONENT ───────────────────────────────────────────────────
export function TopGenresDashboard({ backendData }: { backendData?: any }) {
  
  // ── DYNAMIC DATA PARSING ──
  // This helper function maps the raw backend dictionary into the structure our widgets expect
  const buildCategoryStats = (data: Record<string, StatData[]> = {}, fallbackLabel: string): CategoryStats[] => {
    const configs = [
      { id: 'movies', title: 'Movies', color: '#3DB4F2' },
      { id: 'shows', title: 'TV Shows', color: '#9B72CF' },
      { id: 'albums', title: 'Music', color: '#C2D62E' },
      { id: 'books', title: 'Books', color: '#ef4444' }
    ];

    return configs.map(c => {
      const items = data[c.id] || [];
      return {
        ...c,
        // If the user has no entries yet, supply a polite fallback so it doesn't crash
        topStat: items.length > 0 ? items[0] : { name: `No ${fallbackLabel}s Yet`, percent: 0 },
        topStats: items
      };
    });
  };

  // Convert the live backend payload
  const genreData = buildCategoryStats(backendData?.dashboard_genres, 'Genre');
  const eraData = buildCategoryStats(backendData?.dashboard_eras, 'Era');
  // Provide empty grid fallback for ratings if undefined
  const ratingData = backendData?.dashboard_ratings || { movies: [0,0,0,0,0], shows: [0,0,0,0,0], albums: [0,0,0,0,0], books: [0,0,0,0,0] };

  return (
    <div className="w-full">
      {/* 3-Column Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 w-full">
        
        {/* COLUMN 1: GENRES */}
        <div className="w-full flex flex-col items-center text-center">
          <h3 className="text-[#8ba0b2] text-sm uppercase tracking-widest font-bold mb-4">Genre</h3>
          <InsightWidget data={genreData} statLabel="GENRE" />
        </div>

        {/* COLUMN 2: ERAS */}
        <div className="w-full flex flex-col items-center text-center">
          <h3 className="text-[#8ba0b2] text-sm uppercase tracking-widest font-bold mb-4">Top Era</h3>
          <InsightWidget data={eraData} statLabel="ERA" />
        </div>

        {/* COLUMN 3: RATINGS */}
        <div className="w-full flex flex-col items-center text-center">
          <h3 className="text-[#8ba0b2] text-sm uppercase tracking-widest font-bold mb-4">Rating Overview</h3>
          <RatingOverviewCard ratingData={ratingData} />
        </div>

      </div>
    </div>
  );
}

// ── REUSABLE INSIGHT WIDGET (3D FLIP LOGIC) ─────────────────────────────────
function InsightWidget({ data, statLabel }: { data: CategoryStats[], statLabel: string }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [expandedCategory, setExpandedCategory] = useState<CategoryStats | null>(null);

  const handleNext = () => setActiveIndex((prev) => (prev + 1) % data.length);
  
  const handleExpand = (category: CategoryStats) => {
    setExpandedCategory(category);
    setIsFlipped(true); 
  };
  
  const handleBack = () => {
    setIsFlipped(false); 
    setTimeout(() => setExpandedCategory(null), 500); 
  };

  const backCategory = expandedCategory || data[activeIndex];

  return (
    <div className="w-full max-w-sm relative [perspective:1000px]">
      <div 
        className="grid transition-transform duration-700 ease-in-out w-full [transform-style:preserve-3d]"
        style={{ transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)' }}
      >
        {/* FRONT SIDE (CAROUSEL) */}
        <div 
          className="col-start-1 row-start-1 w-full h-full [backface-visibility:hidden]"
          style={{ 
            pointerEvents: isFlipped ? 'none' : 'auto',
            zIndex: isFlipped ? 0 : 10 
          }}
        >
          <StackedCarousel data={data} activeIndex={activeIndex} onNext={handleNext} onExpand={handleExpand} statLabel={statLabel} />
        </div>

        {/* BACK SIDE (TOP 5 LIST) */}
        <div 
          className="col-start-1 row-start-1 w-full h-full [backface-visibility:hidden]"
          style={{ 
            transform: 'rotateY(180deg)',
            pointerEvents: isFlipped ? 'auto' : 'none',
            zIndex: isFlipped ? 10 : 0 
          }}
        >
          <ExpandedStatView category={backCategory} onBack={handleBack} />
        </div>
      </div>
    </div>
  );
}

// ── FRONT OF CARD: STACKED CAROUSEL ─────────────────────────────────────────
function StackedCarousel({ data, activeIndex, onNext, onExpand, statLabel }: { data: CategoryStats[], activeIndex: number, onNext: () => void, onExpand: (cat: CategoryStats) => void, statLabel: string }) {
  return (
    <div className="relative w-full h-[280px]">
      {data.map((category, i) => {
        const offset = (i - activeIndex + data.length) % data.length;
        const isFront = offset === 0;
        
        return (
          <div
            key={category.id}
            className="absolute top-0 left-0 w-full rounded-2xl border border-[#2A394A] p-6 shadow-2xl transition-all duration-500 ease-in-out cursor-pointer"
            style={{
              backgroundColor: '#151F2E',
              transform: `translateY(${offset * 24}px) scale(${1 - offset * 0.05})`,
              zIndex: data.length - offset,
              opacity: 1 - offset * 0.2,
              pointerEvents: isFront ? 'auto' : 'none' 
            }}
          >
            <div className="flex justify-between items-center mb-8">
              <h3 className="text-xl font-bold text-white tracking-wide uppercase">{category.title}</h3>
              {isFront && (
                <button onClick={(e) => { e.stopPropagation(); onNext(); }} className="w-8 h-8 rounded-full bg-[#2A394A] hover:bg-[#3DB4F2] text-white flex items-center justify-center transition-colors shadow-lg">
                  <span className="text-sm">➔</span>
                </button>
              )}
            </div>

            <div className="text-center mb-8">
              <p className="text-[#7A858F] text-xs uppercase tracking-widest font-bold mb-2">#1 TOP {statLabel}</p>
              <h2 className="text-5xl font-extrabold text-white mb-2 truncate" style={{ color: category.color }}>
                {category.topStat.name}
              </h2>
              <p className="text-sm text-[#8ba0b2] font-medium">
                Accounts for {category.topStat.percent}% of your library
              </p>
            </div>

            {isFront && (
              <button
                onClick={(e) => { e.stopPropagation(); onExpand(category); }}
                className="w-full py-3 rounded-lg text-white font-bold transition-opacity hover:opacity-80 shadow-lg"
                style={{ backgroundColor: category.color }}
              >
                Discover Top 5
              </button>
            )}
          </div>
        );
      })}
      <div className="absolute inset-0 z-0 cursor-pointer" onClick={onNext} />
    </div>
  );
}

// ── BACK OF CARD: EXPANDED LIST (ELONGATES) ─────────────────────────────────
function ExpandedStatView({ category, onBack }: { category: CategoryStats, onBack: () => void }) {
  return (
    <div className="w-full min-h-[280px] h-full bg-[#151F2E] border border-[#2A394A] rounded-2xl p-6 shadow-2xl flex flex-col relative z-20">
      <div className="flex items-center gap-4 mb-6">
        <button onClick={(e) => { e.stopPropagation(); onBack(); }} className="p-2 -ml-2 text-[#7A858F] hover:text-white transition-colors relative z-50 cursor-pointer">←</button>
        <div className="text-left">
          <h2 className="text-white text-lg font-bold">Top 5</h2>
          <p className="text-xs text-[#8ba0b2] uppercase tracking-wider font-semibold">{category.title}</p>
        </div>
      </div>

      <div className="space-y-4 flex-1 relative z-20">
        {category.topStats.map((stat, idx) => (
          <div key={stat.name} className="relative">
            <div className="flex justify-between items-end mb-1.5">
              <div className="flex items-center gap-3">
                <span className="text-[#7A858F] text-xs font-bold w-4">#{idx + 1}</span>
                <span className="text-white font-semibold text-sm truncate max-w-[150px]">{stat.name}</span>
              </div>
              <span className="text-xs font-bold" style={{ color: category.color }}>
                {stat.percent}%
              </span>
            </div>
            <div className="w-full h-1.5 bg-[#0B1622] rounded-full overflow-hidden">
              <div 
                className="h-full rounded-full transition-all duration-1000 ease-out"
                style={{ width: `${stat.percent}%`, backgroundColor: category.color }} 
              />
            </div>
          </div>
        ))}
        {category.topStats.length === 0 && (
          <div className="text-[#7A858F] text-sm text-center pt-8">Not enough data yet.</div>
        )}
      </div>
    </div>
  );
}

// ── RATING OVERVIEW CARD (CUSTOM LINE CHART) ────────────────────────────────
function RatingOverviewCard({ ratingData }: { ratingData: Record<string, number[]> }) {
  const [activeTab, setActiveTab] = useState<'movies' | 'shows' | 'albums' | 'books'>('movies');

  const tabs = [
    { id: 'movies', label: 'Movies', color: '#3DB4F2' },
    { id: 'shows', label: 'Shows', color: '#9B72CF' },
    { id: 'albums', label: 'Music', color: '#C2D62E' },
    { id: 'books', label: 'Books', color: '#ef4444' }
  ];

  const currentTabObj = tabs.find(t => t.id === activeTab)!;
  // Fallback to array of [0,0,0,0,0] if undefined
  const currentDataArray = ratingData[activeTab] || [0, 0, 0, 0, 0];
  
  // Math for SVG
  const maxVal = Math.max(...currentDataArray, 10); 
  const width = 300;
  const height = 150;
  const padX = 20;
  const padY = 20;
  const chartW = width - padX * 2;
  const chartH = height - padY * 2;

  const points = currentDataArray.map((val, i) => {
    const x = padX + (i / (currentDataArray.length - 1)) * chartW;
    const y = height - padY - (val / maxVal) * chartH;
    return { x, y, val };
  });

  const pathD = `M ${points.map(p => `${p.x},${p.y}`).join(' L ')}`;
  const fillD = `${pathD} L ${width - padX},${height - padY} L ${padX},${height - padY} Z`;

  return (
    <div className="w-full max-w-sm h-[280px] bg-[#151F2E] border border-[#2A394A] rounded-2xl p-6 shadow-2xl flex flex-col">
      <div className="flex justify-between items-center bg-[#0B1622] p-1 rounded-lg mb-6 border border-[#2A394A]">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`flex-1 py-1.5 text-xs font-bold rounded transition-colors ${
              activeTab === tab.id 
                ? 'bg-[#151F2E] text-white shadow-sm' 
                : 'text-[#7A858F] hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 w-full relative flex flex-col justify-end">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full overflow-visible">
          <defs>
            <linearGradient id={`grad-${activeTab}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={currentTabObj.color} stopOpacity="0.3" />
              <stop offset="100%" stopColor={currentTabObj.color} stopOpacity="0.0" />
            </linearGradient>
          </defs>

          <path d={fillD} fill={`url(#grad-${activeTab})`} className="transition-all duration-500 ease-out" />
          <path d={pathD} fill="none" stroke={currentTabObj.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="transition-all duration-500 ease-out" />

          {points.map((p, i) => (
            <g key={i} className="group transition-all duration-500 ease-out">
              <circle cx={p.x} cy={p.y} r="4" fill="#151F2E" stroke={currentTabObj.color} strokeWidth="2" className="transition-all duration-500 ease-out group-hover:r-6" />
              <text x={p.x} y={p.y - 12} fill="white" fontSize="10" fontWeight="bold" textAnchor="middle" className="opacity-0 group-hover:opacity-100 transition-opacity">
                {p.val}
              </text>
            </g>
          ))}
        </svg>

        <div className="flex justify-between mt-2 px-3">
          {[1, 2, 3, 4, 5].map(star => (
            <span key={star} className="text-[#7A858F] text-[10px] font-bold">
              {star}★
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}