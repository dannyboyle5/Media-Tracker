"use client";
import React, { useEffect, useState, useRef, useCallback, Fragment } from 'react';

// ── TYPES ────────────────────────────────────────────────────────────────────
interface MediaItem {
  movie_id?: number; show_id?: number; id?: number;
  title: string; runtime_mins?: number | string; seasons?: string | number;
  genre?: string; status?: string; cover_art_url?: string; notes?: string;
  source?: string; release_year?: string; current_episode?: number;
  total_episodes?: number; release_status?: string; show_type?: string;
  avg_runtime?: string; studio?: string; genre_list?: string;
  is_manual?: number; runtime_display?: string; page_count?: number;
  total_tracks?: number; artist?: string; record_label?: string;
  rating?: number;
  custom_tags?: string;
  origin_country?: string;
}

interface TrackingCategory {
  total: number;
  completed_count: number;
  hours?: number;   
  pages?: number;   
}

interface StatsData {
  tracking: { movies: TrackingCategory; shows: TrackingCategory; albums: TrackingCategory; books: TrackingCategory; };
  totals: { movies: number; shows: number; albums: number; books: number };
  by_status: { movies: Record<string,number>; shows: Record<string,number>; albums: Record<string,number>; books: Record<string,number> };
  top_genres: { genre: string; count: number }[]; 
  movie_hours_watched: number;   
  tv_hours_watched: number;      
  music_hours_listened: number;  
  total_pages_read: number;      
  activity: { episodes_watched: number; movies_runtime_hrs: number; albums_runtime_hrs: number };
  top_show_types: { type: string; count: number }[];
  
  completion_rate: number;
  total_completed: number;
  total_started: number;
  status_breakdown: {
    planning: { count: number; percent: number };
    in_progress: { count: number; percent: number };
    completed: { count: number; percent: number };
    dropped: { count: number; percent: number };
  };
  average_rating_by_genre: { genre: string; avg_rating: number; count: number }[];
  
  dashboard_genres?: Record<string, { name: string; percent: number }[]>;
  dashboard_eras?: Record<string, { name: string; percent: number }[]>;
  dashboard_ratings?: Record<string, number[]>;
  dashboard_creators?: Record<string, { name: string; percent: number }[]>;
  dashboard_creator_ratings?: Record<string, { name: string; percent: number }[]>;
}

async function apiPost(path: string, body?: object) {
  const response = await fetch(`${API}${path}`, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json", "Accept": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Backend Error on ${path} (${response.status}):`, errorText);
    throw new Error(`API returned ${response.status}`);
  }

  return response;
}

function itemId(item: MediaItem): number | null {
  if (item.movie_id != null) return item.movie_id;
  if (item.show_id  != null) return item.show_id;
  if (item.id       != null) return item.id;
  return null;
}

function displayStatus(status: string | undefined, category: string): string {
  const raw = status || 'Planning';
  if (category === 'albums' && raw === 'Watched') return 'Listened';
  return raw;
}

const API = "https://media-tracker-phgm.onrender.com/api";
async function apiPost(path: string, body?: object) {
  return fetch(`${API}${path}`, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : {},
    body:    body ? JSON.stringify(body) : undefined,
  });
}
async function apiDelete(path: string) {
  return fetch(`${API}${path}`, { method: "DELETE" });
}

// ── ICONS ────────────────────────────────────────────────────────────────────
const ChatBubbleIcon = ({ filled }: { filled: boolean }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={filled ? "0" : "2"} className="w-5 h-5">
    <path strokeLinecap="round" strokeLinejoin="round" fillRule="evenodd" d="M4.804 21.644A6.707 6.707 0 006 21.75a6.721 6.721 0 003.583-1.029c.774.182 1.584.279 2.417.279 5.322 0 9.75-3.97 9.75-9 0-5.03-4.428-9-9.75-9s-9.75 3.97-9.75 9c0 2.409 1.025 4.587 2.674 6.192.232.226.277.428.254.543a3.73 3.73 0 01-.814 1.686.75.75 0 00.44 1.223zM8.25 10.875a1.125 1.125 0 100 2.25 1.125 1.125 0 000-2.25zM10.875 12a1.125 1.125 0 112.25 0 1.125 1.125 0 01-2.25 0zm4.875-1.125a1.125 1.125 0 100 2.25 1.125 1.125 0 000-2.25z" clipRule="evenodd" />
  </svg>
);
const SearchIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
  </svg>
);
const TrashIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
  </svg>
);

const StarIcon = ({ fillPercentage }: { fillPercentage: number }) => {
  const id = useRef(`grad-${Math.random().toString(36).substring(2, 9)}`).current;
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="w-4 h-4 transition-colors">
      <defs>
        <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset={`${fillPercentage * 100}%`} stopColor="#F59E0B" />
          <stop offset={`${fillPercentage * 100}%`} stopColor="transparent" />
        </linearGradient>
      </defs>
      <path
        fill={`url(#${id})`}
        stroke={fillPercentage > 0 ? "#F59E0B" : "#5A6B7C"}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"
      />
    </svg>
  );
};

function StarRating({ rating, onRate }: { rating: number, onRate: (r: number) => void }) {
  const [hoverRating, setHoverRating] = useState(0);
  const handleMouseMove = (e: React.MouseEvent, starIndex: number) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const isHalf = e.clientX - rect.left < rect.width / 2;
    setHoverRating(starIndex - (isHalf ? 0.5 : 0));
  };
  return (
    <div className="flex gap-1.5 items-center" onClick={e => e.stopPropagation()}>
      <div className="flex gap-0.5" onMouseLeave={() => setHoverRating(0)}>
        {[1, 2, 3, 4, 5].map(star => {
          const currentVal = hoverRating || rating || 0;
          let fill = 0;
          if (currentVal >= star) fill = 1;
          else if (currentVal === star - 0.5) fill = 0.5;
          return (
            <div key={star} onMouseMove={(e) => handleMouseMove(e, star)} onClick={() => onRate(hoverRating)} className="cursor-pointer">
              <StarIcon fillPercentage={fill} />
            </div>
          );
        })}
      </div>
      {rating > 0 && (
        <button onClick={(e) => { e.stopPropagation(); onRate(0); setHoverRating(0); }} className="text-[#5A6B7C] hover:text-[#ef4444] transition-colors p-0.5 rounded-full hover:bg-white/5" title="Remove Rating">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" /></svg>
        </button>
      )}
    </div>
  );
}

// ── MAIN DASHBOARD COMPONENT ──────────────────────────────────────────────────
export default function Dashboard() {
  const [activeCategory, setActiveCategory] = useState<string>('home');
  const [selectedItem,   setSelectedItem]   = useState<number | null>(null);
  const [listData,       setListData]       = useState<MediaItem[]>([]);
  const [detailData,     setDetailData]     = useState<MediaItem | null>(null);
  const [editingNoteId,  setEditingNoteId]  = useState<number | null>(null);
  const [tempNote,       setTempNote]       = useState<string>("");
  const [searchQuery,    setSearchQuery]    = useState("");
  const [searchResults,  setSearchResults]  = useState<MediaItem[]>([]);
  const [statsData,      setStatsData]      = useState<StatsData | null>(null);
  const [recentItems,    setRecentItems]    = useState<any[]>([]);
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualFields,   setManualFields]   = useState<Record<string, string>>({});

  const [allTags, setAllTags] = useState<{id:number, name:string}[]>([]);
  const [allLists, setAllLists] = useState<{id:number, name:string, description:string}[]>([]);
  const [newTagInput, setNewTagInput] = useState("");
  const [activeTagFilter, setActiveTagFilter] = useState<string>("");
  const [localSearchQuery, setLocalSearchQuery] = useState("");
  const [activeStatusFilter, setActiveStatusFilter] = useState<string>("");

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 50;

  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollPosRef   = useRef<number>(0);

  useEffect(() => {
    const cat  = localStorage.getItem('trackerCategory');
    const item = localStorage.getItem('trackerItem');
    if (cat)  setActiveCategory(cat);
    if (item) setSelectedItem(Number(item));
  }, []);

  useEffect(() => {
    localStorage.setItem('trackerCategory', activeCategory);
    if (selectedItem !== null) localStorage.setItem('trackerItem', String(selectedItem));
    else                       localStorage.removeItem('trackerItem');
  }, [activeCategory, selectedItem]);

  const fetchList = useCallback(async () => {
    if (activeCategory === 'home' || activeCategory === 'lists') {
      setListData([]);
      if (activeCategory === 'lists') {
        const res = await fetch(`${API}/lists`);
        setAllLists(await res.json());
      } else {
        const resStats  = await fetch(`${API}/stats`);
        setStatsData(await resStats.json());
        const resRecent = await fetch(`${API}/recently_added?limit=8`);
        setRecentItems(await resRecent.json());
      }
      return;
    }
    try {
      const res  = await fetch(`${API}/${activeCategory}`);
      setListData(await res.json());
      const tagRes = await fetch(`${API}/tags`);
      setAllTags(await tagRes.json());
    } catch { setListData([]); }
  }, [activeCategory]);

  useEffect(() => {
    setSearchQuery("");
    setSearchResults([]);
    fetchList();
  }, [fetchList]);

  useEffect(() => {
    if (selectedItem === null || activeCategory === 'home' || activeCategory === 'lists') return;
    let cancelled = false;
    (async () => {
      try {
        const res  = await fetch(`${API}/${activeCategory}/${selectedItem}`);
        const data = await res.json();
        if (!cancelled) setDetailData(data);
      } catch { }
    })();
    return () => { cancelled = true; };
  }, [selectedItem, activeCategory]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setSearchQuery(q);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (!q.trim() || activeCategory === 'home') { setSearchResults([]); return; }
    searchTimerRef.current = setTimeout(async () => {
      try {
        const res  = await fetch(`${API}/search/tmdb?q=${encodeURIComponent(q)}&category=${activeCategory}`);
        setSearchResults(await res.json());
      } catch { }
    }, 400);
  };

  const handleAddMedia = async (item: { title: string; cover_art_url?: string; tmdb_id?: number | string }) => {
    if (activeCategory === 'home') return;
    if (!item.title) {
      alert("Cannot add media: Missing title or metadata from search provider.");
      return;
    }
    try {
      await apiPost(`/${activeCategory}/`, item);
      setSearchQuery(""); setSearchResults([]); fetchList();
    } catch { }
  };

  const MANUAL_FIELDS: Record<string, { key: string; label: string; type?: string }[]> = {
    movies: [{ key: 'title', label: 'Title' }, { key: 'release_year', label: 'Year' }, { key: 'runtime_mins', label: 'Runtime (mins)', type: 'number' }, { key: 'genre', label: 'Genre' }, { key: 'studio', label: 'Studio / Director' }],
    shows:  [{ key: 'title', label: 'Title' }, { key: 'release_year', label: 'Year' }, { key: 'genre', label: 'Genre' }, { key: 'total_episodes', label: 'Total Episodes', type: 'number' }, { key: 'studio', label: 'Network / Studio' }],
    albums: [{ key: 'title', label: 'Album Title' }, { key: 'artist', label: 'Artist' }, { key: 'release_year', label: 'Year' }, { key: 'genre', label: 'Genre' }, { key: 'total_tracks', label: 'Track Count', type: 'number' }, { key: 'record_label', label: 'Record Label' }],
    books:  [{ key: 'title', label: 'Title' }, { key: 'author', label: 'Author' }, { key: 'release_year', label: 'Year' }, { key: 'genre', label: 'Genre' }, { key: 'page_count', label: 'Page Count', type: 'number' }, { key: 'publisher', label: 'Publisher' }],
  };

  const manualFieldDefs = MANUAL_FIELDS[activeCategory] ?? [];
  const manualFormComplete = manualFieldDefs.every(f => (manualFields[f.key] ?? '').trim() !== '');

  const handleManualAdd = async () => {
    if (!manualFormComplete) return;
    const payload: Record<string, string | number> = { ...manualFields, is_manual: 1 };
    ['runtime_mins','total_episodes','total_tracks','page_count'].forEach(k => { if (payload[k]) payload[k] = parseInt(String(payload[k]), 10); });
    try {
      await apiPost(`/${activeCategory}`, payload);
      setShowManualForm(false); setManualFields({}); fetchList();
    } catch { }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm("Delete this entry?")) return;
    try {
      await fetch(`${API}/${activeCategory}/${id}`, { method: 'DELETE' });
      setListData(prev => prev.filter(it => itemId(it) !== id));
      setSelectedItem(null); setDetailData(null);
    } catch { }
  };

  const handleQuickReset = async (e: React.MouseEvent, item: MediaItem) => {
    e.stopPropagation();
    const id = itemId(item);
    if (!id) return;
    setListData((prev) => prev.map(it => {
      if (itemId(it) === id) return { ...it, current_episode: 0, status: 'Planning' };
      return it;
    }));
    try {
      await apiPost(`/${activeCategory}/${id}/decrement`, { amount: 99999 });
      await apiPost(`/${activeCategory}/${id}/status`, { status: 'Planning' });
      fetchList();
    } catch { fetchList(); }
  };

  const handleQuickIncrement = async (e: React.MouseEvent, item: MediaItem) => {
    e.stopPropagation();
    const id = itemId(item);
    if (!id) return;
    if (activeCategory === 'movies' || activeCategory === 'albums') return handleQuickComplete(e, item);
    const incAmount = activeCategory === 'books' ? 10 : 1;
    setListData((prev) => prev.map(it => {
      if (itemId(it) === id) {
        const max = activeCategory === 'shows' ? it.total_episodes : it.page_count;
        const current = it.current_episode || 0;
        const nextVal = Math.min(current + incAmount, max || 9999);
        const newStatus = (max && nextVal >= max) ? (activeCategory === 'books' ? 'Read' : 'Watched') : it.status;
        return { ...it, current_episode: nextVal, status: newStatus };
      }
      return it;
    }));
    try { await apiPost(`/${activeCategory}/${id}/increment`, { amount: incAmount }); fetchList(); } catch { fetchList(); }
  };

  const handleQuickDecrement = async (e: React.MouseEvent, item: MediaItem) => {
    e.stopPropagation();
    const id = itemId(item);
    if (!id) return;
    if (activeCategory === 'movies' || activeCategory === 'albums') {
      const revertStatus = activeCategory === 'albums' ? 'Listening' : 'Watching';
      setListData((prev) => prev.map(it => itemId(it) === id ? { ...it, status: revertStatus } : it));
      try { await apiPost(`/${activeCategory}/${id}/status`, { status: revertStatus }); fetchList(); } catch { fetchList(); }
      return;
    }
    const decAmount = activeCategory === 'books' ? 10 : 1;
    setListData((prev) => prev.map(it => {
      if (itemId(it) === id) {
        const max = activeCategory === 'shows' ? it.total_episodes : it.page_count;
        const current = it.current_episode || 0;
        const nextVal = Math.max(current - decAmount, 0);
        let newStatus = it.status;
        if (max && nextVal < max && (it.status === 'Watched' || it.status === 'Read' || it.status === 'Completed')) {
          newStatus = activeCategory === 'books' ? 'Reading' : 'Watching';
        }
        return { ...it, current_episode: nextVal, status: newStatus };
      }
      return it;
    }));
    try { await apiPost(`/${activeCategory}/${id}/decrement`, { amount: decAmount }); fetchList(); } catch { fetchList(); }
  };

  const handleQuickComplete = async (e: React.MouseEvent, item: MediaItem) => {
    e.stopPropagation();
    const id = itemId(item);
    if (!id) return;
    const finalStatus = activeCategory === 'albums' ? 'Listened' : activeCategory === 'books' ? 'Read' : 'Watched';
    setListData((prev) => prev.map(it => {
      if (itemId(it) === id) {
        const max = activeCategory === 'shows' ? it.total_episodes : it.page_count;
        return { ...it, status: finalStatus, current_episode: max || it.current_episode };
      }
      return it;
    }));
    try { await apiPost(`/${activeCategory}/${id}/status`, { status: finalStatus }); fetchList(); } catch { fetchList(); }
  };

  const handleRate = async (item: MediaItem, rating: number) => {
    const id = itemId(item);
    if (!id) return;
    setListData(prev => prev.map(it => itemId(it) === id ? { ...it, rating } : it));
    if (detailData && itemId(detailData) === id) setDetailData({ ...detailData, rating });
    try { await apiPost(`/${activeCategory}/${id}/rating`, { rating }); } catch { fetchList(); }
  };

  const handleAddTag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTagInput.trim() || !selectedItem) return;
    try {
      await apiPost(`/${activeCategory}/${selectedItem}/tags`, { tag_name: newTagInput });
      setNewTagInput("");
      const res = await fetch(`${API}/${activeCategory}/${selectedItem}`);
      setDetailData(await res.json());
      fetchList();
    } catch {}
  };

  const handleRemoveTag = async (tagName: string) => {
    if (!selectedItem) return;
    try {
      await apiDelete(`/${activeCategory}/${selectedItem}/tags/${tagName}`);
      const res = await fetch(`${API}/${activeCategory}/${selectedItem}`);
      setDetailData(await res.json());
      fetchList();
    } catch {}
  };

  const saveNote = async (id: number) => {
    try {
      await apiPost(`/${activeCategory}/${id}/notes`, { notes: tempNote });
      setListData(prev => prev.map(it => itemId(it) === id ? { ...it, notes: tempNote } : it));
      setEditingNoteId(null);
    } catch { }
  };

  const toggleStatus = async (item: MediaItem) => {
    const id = itemId(item);
    if (!id) return;
    const isMusic = activeCategory === 'albums';
    const cycle: Record<string, string> = isMusic ? { Planning: 'Listening', Listening: 'Listened', Listened: 'Planning' } : { Planning: 'Watching', Watching: 'Watched', Watched: 'Planning' };
    const newStatus = cycle[item.status || 'Planning'] ?? 'Planning';
    setListData(prev => prev.map(it => itemId(it) === id ? { ...it, status: newStatus } : it));
    setDetailData(prev => prev ? { ...prev, status: newStatus } : null);
    try { await apiPost(`/${activeCategory}/${id}/status`, { status: newStatus }); } catch { }
  };

  // ── FILTERING & PAGINATION LOGIC ──
  const filteredListData = listData.filter(item => {
    if (activeTagFilter) {
      const tags = item.custom_tags ? item.custom_tags.split(",") : [];
      if (!tags.includes(activeTagFilter)) return false;
    }
    if (activeStatusFilter) {
      if (displayStatus(item.status, activeCategory) !== activeStatusFilter) return false;
    }
    if (localSearchQuery) {
      if (!item.title.toLowerCase().includes(localSearchQuery.toLowerCase())) return false;
    }
    return true;
  });

  const totalPages = Math.ceil(filteredListData.length / ITEMS_PER_PAGE);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeCategory, activeTagFilter, activeStatusFilter, localSearchQuery]);

  useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) setCurrentPage(totalPages);
  }, [totalPages, currentPage]);

  const paginatedData = filteredListData.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  const CATEGORIES = [
    { id: 'home',   label: 'Home' },
    { id: 'lists',  label: 'My Lists' },
    { id: 'movies', label: 'Movies' },
    { id: 'shows',  label: 'Shows' },
    { id: 'albums', label: 'Music' },
    { id: 'books',  label: 'Books' },
  ];

  return (
    <div className="flex min-h-screen bg-[#0B1622] text-[#8ba0b2] font-sans">
      
      {/* ── LEFT SIDEBAR ──────────────────────────────────────────────────────── */}
      <aside className="w-64 fixed inset-y-0 left-0 bg-[#151F2E] border-r border-[#2A394A] flex flex-col z-40">
        <div className="p-6 pb-2">
          <h1 className="text-white text-xl font-bold mb-6 tracking-wide">MediaTracker</h1>
          
          <div className="relative mb-8">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#7A858F]"><SearchIcon /></span>
            <input
              type="text"
              placeholder={activeCategory === 'home' ? 'Search disabled...' : `Search to Add...`}
              value={searchQuery}
              onChange={handleSearchChange}
              disabled={activeCategory === 'home'}
              className="w-full bg-[#0B1622] text-white border border-[#2A394A] rounded-lg py-2.5 pl-10 pr-4 text-sm focus:outline-none focus:border-[#3DB4F2] disabled:opacity-50"
            />
            {searchResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-[#151F2E] border border-[#2A394A] rounded-lg shadow-xl overflow-hidden z-50 max-h-64 overflow-y-auto">
                {searchResults.map((res: any, idx) => (
                  <div key={idx} onClick={() => handleAddMedia({ title: res.title, cover_art_url: res.cover_art_url, tmdb_id: res.tmdb_id })}
                    className="flex items-center gap-3 p-3 hover:bg-[#3DB4F2]/10 cursor-pointer border-b border-[#2A394A] last:border-0">
                    <div className="w-8 h-12 bg-[#0B1622] rounded overflow-hidden flex-shrink-0">
                      {res.cover_art_url && <img src={res.cover_art_url} className="w-full h-full object-cover" alt="" />}
                    </div>
                    <span className="text-white text-xs font-semibold truncate">{res.title}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <nav className="flex flex-col gap-2 px-4 flex-1">
          {CATEGORIES.map(cat => (
            <button 
              key={cat.id} 
              onClick={() => { 
                setActiveCategory(cat.id); 
                setSelectedItem(null); 
                setActiveTagFilter(""); 
                setLocalSearchQuery(""); 
                setActiveStatusFilter(""); 
              }}
              className={`text-left px-4 py-3 rounded-lg font-semibold text-sm transition-colors
                ${activeCategory === cat.id ? 'bg-[#3DB4F2]/10 text-[#3DB4F2]' : 'text-[#7A858F] hover:bg-[#0B1622] hover:text-[#9fadbd]'}`}>
              {cat.label}
            </button>
          ))}
        </nav>

        <div className="p-6">
          <button
            onClick={() => { setShowManualForm(true); setManualFields({}); }}
            disabled={activeCategory === 'home'}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-[#3DB4F2] text-white hover:bg-[#56C6FF] transition-colors text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span>＋</span> Manual Entry
          </button>
        </div>
      </aside>

      {/* ── MAIN CONTENT AREA ─────────────────────────────────────────────────── */}
      <main className="flex-1 ml-64 p-10">
        <div className="max-w-[1400px] mx-auto w-full">
          
          {/* MANUAL ENTRY MODAL */}
          {showManualForm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm ml-64">
              <div className="bg-[#151F2E] border border-[#2A394A] rounded-2xl shadow-2xl w-full max-w-md p-8">
                <h2 className="text-white font-bold text-lg mb-6">Manual Entry</h2>
                <div className="space-y-3">
                  {manualFieldDefs.map(f => (
                    <div key={f.key}>
                      <label className="text-[10px] uppercase tracking-wider text-[#7A858F] font-bold block mb-1">{f.label}</label>
                      <input type={f.type ?? 'text'} value={manualFields[f.key] ?? ''} onChange={e => setManualFields(prev => ({ ...prev, [f.key]: e.target.value }))}
                        className="w-full bg-[#0B1622] text-white border border-[#2A394A] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3DB4F2]" />
                    </div>
                  ))}
                </div>
                <div className="mt-6 flex gap-3">
                  <button onClick={handleManualAdd} disabled={!manualFormComplete} className={`flex-1 py-2.5 rounded-lg text-sm font-bold ${manualFormComplete ? 'bg-[#3DB4F2] text-white' : 'bg-[#2A394A] text-[#5A6B7C]'}`}>Save</button>
                  <button onClick={() => setShowManualForm(false)} className="px-5 py-2.5 rounded-lg text-sm text-[#7A858F] border border-[#2A394A]">Cancel</button>
                </div>
              </div>
            </div>
          )}

          {/* ── MY LISTS VIEW ── */}
          {activeCategory === 'lists' && selectedItem === null && (
            <div>
              <h2 className="text-white text-2xl font-bold mb-6">Custom Lists</h2>
              <div className="grid grid-cols-3 gap-6">
                <div className="bg-[#151F2E] border border-dashed border-[#3DB4F2] rounded-xl p-6 flex flex-col items-center justify-center cursor-pointer hover:bg-[#3DB4F2]/10 text-[#3DB4F2] min-h-[120px]"
                  onClick={async () => {
                    const name = prompt("List Name:");
                    if (name) { await apiPost('/lists', { name, description: "" }); fetchList(); }
                  }}>
                  <span className="text-2xl mb-2">+</span>
                  <span className="font-bold text-sm">Create New List</span>
                </div>
                {allLists.map(list => (
                  <div key={list.id} onClick={() => setSelectedItem(list.id)} className="bg-[#151F2E] border border-[#2A394A] rounded-xl p-6 cursor-pointer hover:border-[#3DB4F2] transition-colors shadow-sm">
                    <h3 className="text-white font-bold text-lg">{list.name}</h3>
                    <p className="text-xs text-[#7A858F] mt-2">Click to view items</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeCategory === 'lists' && selectedItem !== null && (
            <ListDetailView listId={selectedItem} onBack={() => setSelectedItem(null)} />
          )}

          {/* ── HOME DASHBOARD VIEW ── */}
          {activeCategory === 'home' && statsData && (
            <div className="animate-fade-in">
              
              {/* TOP ROW: Tracking (Totals) */}
              <section className="mb-10">
                <h2 className="text-white text-2xl font-bold mb-6">Welcome back!</h2>
                <div className="grid grid-cols-4 gap-6">
                  {([
                    { label: 'Movies', val: statsData.tracking.movies.total, completed: statsData.tracking.movies.completed_count, sub: `${statsData.tracking.movies.completed_count} watched • ${statsData.movie_hours_watched}h`, color: '#3DB4F2' },
                    { label: 'Shows',  val: statsData.tracking.shows.total,  completed: statsData.tracking.shows.completed_count,  sub: `${statsData.tracking.shows.completed_count} watched • ${statsData.tv_hours_watched}h`, color: '#9B72CF' },
                    { label: 'Music',  val: statsData.tracking.albums.total, completed: statsData.tracking.albums.completed_count, sub: `${statsData.tracking.albums.completed_count} listened • ${statsData.music_hours_listened}h`, color: '#C2D62E' },
                    { label: 'Books',  val: statsData.tracking.books.total,  completed: statsData.tracking.books.completed_count,  sub: `${statsData.tracking.books.completed_count} read • ${statsData.total_pages_read} pgs`, color: '#ef4444' },
                  ] as const).map(({ label, val, completed, sub, color }) => {
                    const percent = val > 0 ? ((completed / val) * 100).toFixed(1) : "0.0";
                    return (
                      <div key={label} className="bg-[#151F2E] border border-[#2A394A] rounded-xl p-6 shadow-sm flex flex-col justify-between">
                        <div>
                          <div className="text-4xl font-bold text-white mb-2">{val}</div>
                          <div className="text-sm font-semibold text-[#8ba0b2]">{label}</div>
                          <div className="text-xs text-[#3DB4F2] mt-1 mb-6">{sub}</div>
                        </div>
                        <div>
                          <div className="flex justify-between items-center mb-1.5">
                            <span className="text-[10px] font-bold text-[#7A858F] uppercase tracking-wider">Completed</span>
                            <span className="text-[10px] font-bold" style={{ color: color }}>{percent}%</span>
                          </div>
                          <div className="w-full h-1.5 bg-[#0B1622] rounded-full overflow-hidden">
                            <div 
                              className="h-full rounded-full transition-all duration-1000 ease-out" 
                              style={{ width: `${percent}%`, backgroundColor: color }} 
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* MAIN CONTENT SPLIT: Left (Content) vs Right (Heatmap) */}
              <div className="flex flex-col xl:flex-row gap-8">
                
                {/* LEFT COLUMN: Charts, Categories, Recently Added */}
                <div className="flex-1 space-y-10 min-w-0">
                  
                  {/* Library Status & Highest Rated Genres */}
                  <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-[#151F2E] border border-[#2A394A] rounded-xl p-6 shadow-sm flex flex-col justify-between">
                      <h2 className="text-white text-lg font-bold mb-4">Library Status</h2>
                      <StatusDonutChart breakdown={statsData.status_breakdown} />
                      <div className="mt-8 pt-6 border-t border-[#2A394A]">
                        <div className="flex justify-between items-end mb-2">
                          <span className="text-[#8ba0b2] font-semibold text-sm">Library Completion</span>
                          <span className="text-[#3DB4F2] font-bold text-xl">
                            {statsData.status_breakdown.completed.percent.toFixed(1)}%
                          </span>
                        </div>
                        <div className="w-full h-2 bg-[#0B1622] rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-[#3DB4F2] rounded-full transition-all duration-1000" 
                            style={{ width: `${statsData.status_breakdown.completed.percent}%` }} 
                          />
                        </div>
                        <p className="text-xs text-[#7A858F] mt-2 tracking-wide">
                          {statsData.status_breakdown.completed.count} completed out of {
                            statsData.status_breakdown.completed.count + 
                            statsData.status_breakdown.in_progress.count + 
                            statsData.status_breakdown.planning.count + 
                            statsData.status_breakdown.dropped.count
                          } total entries.
                        </p>
                      </div>
                    </div>

                    <div className="bg-[#151F2E] border border-[#2A394A] rounded-xl p-6 shadow-sm">
                      <h2 className="text-white text-lg font-bold mb-6">Highest Rated Genres</h2>
                      {statsData.average_rating_by_genre && statsData.average_rating_by_genre.length > 0 ? (
                        <div className="space-y-4">
                          {statsData.average_rating_by_genre.slice(0, 5).map((g, idx) => (
                            <div key={g.genre} className="relative">
                              <div className="flex justify-between items-end mb-1">
                                <span className="text-white font-semibold text-sm"><span className="text-[#7A858F] text-xs mr-2">#{idx + 1}</span>{g.genre}</span>
                                <span className="text-sm font-bold text-[#F59E0B]">★ {g.avg_rating.toFixed(1)}</span>
                              </div>
                              <div className="w-full h-1.5 bg-[#0B1622] rounded-full overflow-hidden">
                                <div className="h-full bg-[#F59E0B] rounded-full transition-all duration-1000" style={{ width: `${(g.avg_rating / 5) * 100}%` }} />
                              </div>
                              <p className="text-[10px] text-[#7A858F] mt-1 uppercase tracking-wider">{g.count} entries rated</p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="h-full flex items-center justify-center pb-8 text-[#7A858F] text-sm">Not enough rated entries yet.</div>
                      )}
                    </div>
                  </section>

                  {/* Top Categories Dashboard */}
                  <section>
                    <TopGenresDashboard backendData={statsData} />
                  </section>

                  {/* Recently Added */}
                  <section className="pb-10">
                    <h2 className="text-white text-2xl font-bold mb-6">Recently Added</h2>
                    {recentItems && recentItems.length > 0 ? (
                      <div className="grid grid-cols-2 lg:grid-cols-3 gap-6">
                        {recentItems.map((item, idx) => (
                          <div key={idx} onClick={() => { setActiveCategory(item.category); setSelectedItem(item.id); window.scrollTo(0, 0); }}
                            className="bg-[#151F2E] border border-[#2A394A] rounded-xl p-4 flex items-center gap-4 hover:bg-[#0B1622] hover:border-[#3DB4F2] transition-colors cursor-pointer shadow-sm">
                            <div className="w-12 h-16 bg-[#0B1622] rounded overflow-hidden flex-shrink-0 border border-[#2A394A]">
                              {item.cover_art_url ? <img src={item.cover_art_url} className="w-full h-full object-cover" alt="" /> : <span className="text-[9px] text-[#7A858F] flex items-center justify-center h-full">N/A</span>}
                            </div>
                            <div className="overflow-hidden">
                              <div className="text-white font-bold text-sm truncate w-full">{item.title}</div>
                              <div className="text-[#7A858F] text-[10px] uppercase tracking-wider font-bold mt-1">{item.category}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="bg-[#151F2E] border border-[#2A394A] rounded-xl p-10 text-center"><p className="text-[#7A858F] text-sm">No recent items found. Add some media to see them here!</p></div>
                    )}
                  </section>

                </div>

                {/* RIGHT COLUMN: Activity Heatmap Sidebar */}
                <aside className="w-full xl:w-[280px] flex-shrink-0">
                  <div className="sticky top-10">
                    <ActivityHeatmap />
                  </div>
                </aside>

              </div>
            </div>
          )}

          {/* ── DETAIL VIEW ── */}
          {activeCategory !== 'home' && activeCategory !== 'lists' && selectedItem !== null && detailData && (
            <div className="w-full">
              <button onClick={() => setSelectedItem(null)} className="mb-8 font-semibold text-sm text-[#8ba0b2]">← Back</button>
              <div className="flex flex-col md:flex-row gap-10 bg-[#151F2E] p-8 rounded-xl shadow-2xl border border-[#2A394A]">
                
                <div className="w-64 flex-shrink-0 flex flex-col gap-4">
                  <div className="w-full h-96 rounded-lg overflow-hidden border border-[#2A394A] bg-[#0B1622]">
                    {detailData.cover_art_url ? <img src={detailData.cover_art_url} className="w-full h-full object-cover" alt="Cover" /> : <div className="h-full flex items-center justify-center text-sm">No Cover</div>}
                  </div>
                  <select value={detailData.source || ""} onChange={async (e) => { const src = e.target.value; setDetailData({ ...detailData, source: src }); await apiPost(`/${activeCategory}/${selectedItem}/source`, { source: src }); }}
                    className="w-full bg-[#0B1622] border border-[#2A394A] rounded p-3 text-[#3DB4F2] font-semibold text-sm focus:outline-none">
                    <option value="Select Source...">Select Source...</option>
                    {activeCategory === 'books' ? <><option>Physical</option><option>Kindle</option><option>Audible</option></> : activeCategory === 'albums' ? <><option>Spotify</option><option>Apple Music</option><option>Vinyl</option></> : <><option>Netflix</option><option>Crunchyroll</option><option>Hulu</option><option>Physical</option></>}
                  </select>
                </div>

                <div className="flex flex-col flex-grow">
                  <div className="flex justify-between items-start mb-2">
                    <h2 className="text-4xl font-bold text-white pr-4">{detailData.title}</h2>
                    <div className="flex items-center gap-2">
                      <button onClick={() => toggleStatus(detailData)} className={`px-4 py-1 rounded text-sm font-bold border ${(detailData.status === 'Watched' || detailData.status === 'Listened' || detailData.status === 'Read') ? 'border-[#3DB4F2] text-[#3DB4F2]' : (detailData.status === 'Watching' || detailData.status === 'Listening' || detailData.status === 'Reading') ? 'border-[#C2D62E] text-[#C2D62E]' : 'border-[#7A858F] text-[#7A858F]'}`}>{displayStatus(detailData.status, activeCategory)}</button>
                      <button onClick={() => handleDelete(selectedItem)} className="p-1.5 text-[#7A858F] hover:text-[#ef4444]"><TrashIcon /></button>
                    </div>
                  </div>
                  
                  <p className="text-[#3DB4F2] font-semibold mb-8">{[detailData.release_year, detailData.genre].filter(v => v && v !== "—").join(' • ')}</p>
                  
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-y-8 gap-x-6 text-sm mb-10">
                    {[
                      { label: activeCategory === 'books' ? 'Author' : activeCategory === 'albums' ? 'Artist' : 'Studio', value: detailData.studio },
                      { label: activeCategory === 'books' ? 'Publisher' : activeCategory === 'albums' ? 'Label' : 'Origin', value: detailData.origin_country },
                      { label: activeCategory === 'books' ? 'Chapters' : activeCategory === 'albums' ? 'Tracks' : 'Status', value: detailData.release_status },
                      { label: 'Genre', value: detailData.genre_list },
                      { label: 'Type', value: detailData.show_type },
                    ].map(({ label, value }) => (
                      <div key={label}>
                        <span className="text-[#7A858F] block mb-1 font-bold uppercase text-[10px] tracking-wider">{label}</span>
                        <span className="font-semibold text-white">{value || "—"}</span>
                      </div>
                    ))}
                  </div>

                  <div className="mb-8">
                    <h3 className="text-[10px] uppercase tracking-wider text-[#7A858F] font-bold mb-2">Custom Tags</h3>
                    <div className="flex flex-wrap items-center gap-2">
                      {detailData.custom_tags && detailData.custom_tags.split(",").map(tag => (
                        <span key={tag} className="bg-[#3DB4F2]/10 text-[#3DB4F2] px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-2">
                          {tag}
                          <button onClick={() => handleRemoveTag(tag)} className="hover:text-white">×</button>
                        </span>
                      ))}
                      <form onSubmit={handleAddTag} className="flex">
                        <input type="text" value={newTagInput} onChange={(e) => setNewTagInput(e.target.value)} placeholder="Add tag..." className="bg-[#0B1622] border border-[#2A394A] text-white text-xs rounded-l-full px-3 py-1 outline-none w-24 focus:border-[#3DB4F2]" />
                        <button type="submit" className="bg-[#2A394A] text-white text-xs rounded-r-full px-2 hover:bg-[#3DB4F2]">+</button>
                      </form>
                    </div>
                  </div>

                  <div className="mb-8">
                     <select onChange={async (e) => { if(e.target.value) { await apiPost(`/lists/${e.target.value}/entries`, { category: activeCategory, item_id: selectedItem }); e.target.value = ""; alert("Added to list!"); } }}
                       className="bg-[#0B1622] border border-[#2A394A] text-white text-sm rounded px-3 py-2 outline-none">
                       <option value="">+ Add to Custom List...</option>
                       {allLists.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                     </select>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── LIST VIEW ── */}
          {activeCategory !== 'home' && activeCategory !== 'lists' && selectedItem === null && (
            <div>
               {/* ENHANCED LIST CONTROLS */}
               <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4 mb-6">
                 <h2 className="text-white text-2xl font-bold capitalize">{activeCategory}</h2>
                 
                 <div className="flex flex-wrap items-center gap-3 w-full xl:w-auto">
                   
                   {/* LOCAL SEARCH BAR */}
                   <div className="relative flex-1 min-w-[200px]">
                     <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#7A858F]"><SearchIcon /></span>
                     <input 
                       type="text" 
                       placeholder={`Search in ${activeCategory}...`} 
                       value={localSearchQuery} 
                       onChange={e => setLocalSearchQuery(e.target.value)} 
                       className="w-full bg-[#151F2E] text-white border border-[#2A394A] rounded-lg py-2 pl-9 pr-3 text-sm focus:outline-none focus:border-[#3DB4F2]" 
                     />
                   </div>
                   
                   {/* STATUS FILTER */}
                   <select value={activeStatusFilter} onChange={e => setActiveStatusFilter(e.target.value)} className="bg-[#151F2E] border border-[#2A394A] text-white text-sm rounded-lg px-3 py-2 outline-none focus:border-[#3DB4F2]">
                     <option value="">All Statuses</option>
                     {Array.from(new Set(listData.map(item => displayStatus(item.status, activeCategory)))).sort().map(s => (
                       <option key={s} value={s}>{s}</option>
                     ))}
                   </select>

                   {/* TAG FILTER */}
                   <select value={activeTagFilter} onChange={e => setActiveTagFilter(e.target.value)} className="bg-[#151F2E] border border-[#2A394A] text-white text-sm rounded-lg px-3 py-2 outline-none focus:border-[#3DB4F2]">
                     <option value="">All Tags</option>
                     {allTags.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                   </select>
                 </div>
               </div>
               
               <div className="w-full bg-[#151F2E] rounded-xl shadow-sm overflow-hidden border border-[#2A394A]">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-[#0B1622] text-[#7A858F] text-xs uppercase tracking-wider font-semibold border-b border-[#2A394A]">
                      <th className="p-4 w-16"></th>
                      <th className="p-4">Title</th>
                      <th className="p-4 w-32">Progress</th>
                      <th className="p-4 w-32">Rating</th>
                      <th className="p-4">Tags</th>
                      <th className="p-4 text-center">Notes</th>
                      <th className="p-4 w-32">Status</th>
                      <th className="p-4 text-center w-[160px]">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedData.length > 0 ? paginatedData.map((item, index) => {
                      const id = itemId(item);
                      return (
                        <Fragment key={index}>
                          <tr onClick={() => { scrollPosRef.current = window.scrollY; setSelectedItem(id ?? null); }} className="group border-b border-[#2A394A] last:border-0 hover:bg-[#0B1622] transition-colors cursor-pointer">
                            <td className="p-3 w-16"><div className="w-12 h-12 bg-[#0B1622] rounded overflow-hidden">{item.cover_art_url ? <img src={item.cover_art_url} className="w-full h-full object-cover" alt="" /> : <span className="text-[9px] text-[#7A858F] flex items-center justify-center h-full">N/A</span>}</div></td>
                            <td className="p-3 font-semibold text-[#3DB4F2] group-hover:text-[#56C6FF]"><div className="flex items-center gap-2">{item.title}{item.is_manual === 1 && <span className="inline-flex items-center justify-center w-4 h-4 rounded-sm bg-[#2A394A] text-[#7A858F] text-[9px] font-bold">M</span>}</div></td>
                            <td className="p-3 text-sm text-white">
                              {activeCategory === 'shows' && item.total_episodes 
                                ? `Ep ${item.current_episode || 0} / ${item.total_episodes}` 
                                : activeCategory === 'books' && item.page_count 
                                  ? `Pg ${item.current_episode || 0} / ${item.page_count}` 
                                  : activeCategory === 'albums' && item.total_tracks
                                    ? `${item.total_tracks} tracks`
                                    : item.seasons || (item as any).runtime_display || item.runtime_mins || "—"}
                            </td>
                            <td className="p-3"><StarRating rating={item.rating || 0} onRate={(r) => handleRate(item, r)} /></td>
                            <td className="p-3 text-xs text-[#7A858F]">{item.custom_tags ? item.custom_tags.split(",").join(" • ") : "—"}</td>
                            <td className="p-3 text-center w-16" onClick={(e) => { e.stopPropagation(); if (id !== null) { setEditingNoteId(editingNoteId === id ? null : id); setTempNote(item.notes || ""); } }}><div className={`inline-flex items-center justify-center w-8 h-8 rounded-full ${item.notes ? 'text-[#3DB4F2] hover:bg-[#3DB4F2]/10' : 'text-[#5A6B7C] hover:bg-white/5'}`}><ChatBubbleIcon filled={!!item.notes} /></div></td>
                            <td className="p-3 text-sm font-medium w-32" onClick={(e) => { e.stopPropagation(); toggleStatus(item); }}><span className={(item.status === 'Watched' || item.status === 'Listened' || item.status === 'Read') ? 'text-[#3DB4F2]' : (item.status === 'Watching' || item.status === 'Listening' || item.status === 'Reading') ? 'text-[#C2D62E]' : 'text-[#7A858F] hover:text-white'}>{displayStatus(item.status, activeCategory)}</span></td>
                            <td className="p-3">
                              <div className="flex items-center justify-center gap-1.5">
                                {(activeCategory === 'shows' || activeCategory === 'books') && (
                                  <button onClick={(e) => handleQuickReset(e, item)} className="w-8 h-8 rounded bg-[#2A394A] hover:bg-orange-500 text-white flex items-center justify-center transition-colors" title="Reset to Zero">
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg>
                                  </button>
                                )}
                                <button onClick={(e) => handleQuickDecrement(e, item)} className="w-8 h-8 rounded bg-[#2A394A] hover:bg-[#ef4444] text-white flex items-center justify-center transition-colors text-lg font-bold" title={activeCategory === 'books' ? "Remove -10 Pages" : activeCategory === 'movies' || activeCategory === 'albums' ? "Mark as In Progress" : "Decrement Progress"}>−</button>
                                <button onClick={(e) => handleQuickIncrement(e, item)} className="w-8 h-8 rounded bg-[#2A394A] hover:bg-[#3DB4F2] text-white flex items-center justify-center transition-colors text-lg font-bold" title={activeCategory === 'books' ? "Add +10 Pages" : "Increment Progress"}>+</button>
                                <button onClick={(e) => handleQuickComplete(e, item)} className="w-8 h-8 rounded bg-[#2A394A] hover:bg-[#C2D62E] text-white flex items-center justify-center transition-colors" title="Mark as Completed"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg></button>
                              </div>
                            </td>
                          </tr>
                          {editingNoteId === id && (
                            <tr className="bg-[#0B1622]"><td colSpan={8} className="p-4 border-b border-[#2A394A]"><div className="flex gap-4 items-start max-w-2xl"><textarea value={tempNote} onChange={e => setTempNote(e.target.value)} className="w-full bg-[#151F2E] text-white border border-[#2A394A] rounded p-3 text-sm focus:outline-none focus:border-[#3DB4F2] min-h-[80px]" autoFocus /><div className="flex flex-col gap-2"><button onClick={() => id !== null && saveNote(id)} className="bg-[#3DB4F2] text-white px-4 py-2 rounded text-sm font-semibold hover:bg-[#56C6FF]">Save</button><button onClick={() => setEditingNoteId(null)} className="text-[#7A858F] hover:text-white px-4 py-2 rounded text-sm border border-[#2A394A]">Cancel</button></div></div></td></tr>
                          )}
                        </Fragment>
                      );
                    }) : <tr><td colSpan={8} className="p-10 text-center text-sm text-[#7A858F]">No entries found matching your filters.</td></tr>}
                  </tbody>
                </table>
               </div>
               
               {/* PAGINATION FOOTER */}
               {totalPages > 1 && (
                  <div className="w-full flex justify-between items-center p-4 mt-2 bg-[#151F2E] rounded-xl border border-[#2A394A] shadow-sm">
                    <button 
                      disabled={currentPage === 1} 
                      onClick={() => setCurrentPage(p => p - 1)} 
                      className="px-5 py-2 rounded-lg text-sm font-bold bg-[#0B1622] text-white border border-[#2A394A] disabled:opacity-50 hover:bg-[#2A394A] transition-colors"
                    >
                      ← Previous
                    </button>
                    <span className="text-[#7A858F] text-sm font-semibold tracking-wider">
                      PAGE {currentPage} OF {totalPages}
                    </span>
                    <button 
                      disabled={currentPage === totalPages} 
                      onClick={() => setCurrentPage(p => p + 1)} 
                      className="px-5 py-2 rounded-lg text-sm font-bold bg-[#0B1622] text-white border border-[#2A394A] disabled:opacity-50 hover:bg-[#2A394A] transition-colors"
                    >
                      Next →
                    </button>
                  </div>
                )}
            </div>
          )}

        </div>
      </main>
    </div>
  );
}

// ── SUB-COMPONENTS ───────────────────────────────────────────────────────────

function StatusDonutChart({ breakdown }: { breakdown: StatsData['status_breakdown'] }) {
  const data = [
    { label: "Completed", percent: breakdown.completed?.percent || 0, color: "#3DB4F2" },
    { label: "In Progress", percent: breakdown.in_progress?.percent || 0, color: "#C2D62E" },
    { label: "Planning", percent: breakdown.planning?.percent || 0, color: "#5A6B7C" },
    { label: "Dropped", percent: breakdown.dropped?.percent || 0, color: "#ef4444" },
  ];
  let cumulativePercent = 0;
  return (
    <div className="flex items-center gap-6">
      <div className="relative w-32 h-32">
        <svg viewBox="0 0 36 36" className="w-full h-full transform -rotate-90">
          {data.map((slice) => {
            if (slice.percent === 0) return null;
            const strokeDasharray = `${slice.percent} ${100 - slice.percent}`;
            const strokeDashoffset = -cumulativePercent;
            cumulativePercent += slice.percent;
            return <circle key={slice.label} r="15.91549430918954" cx="18" cy="18" fill="transparent" stroke={slice.color} strokeWidth="3" strokeDasharray={strokeDasharray} strokeDashoffset={strokeDashoffset} className="transition-all duration-1000 ease-out" />;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center"><span className="text-white font-bold text-xl">{breakdown.completed?.count || 0}</span><span className="text-[9px] text-[#7A858F] uppercase font-bold tracking-widest">Done</span></div>
      </div>
      <div className="flex flex-col gap-2">
        {data.map(slice => (
          <div key={slice.label} className="flex items-center gap-2 text-sm font-semibold"><div className="w-3 h-3 rounded-full" style={{ backgroundColor: slice.color }} /><span className="text-white w-20">{slice.label}</span><span className="text-[#7A858F]">{slice.percent}%</span></div>
        ))}
      </div>
    </div>
  );
}

function ListDetailView({ listId, onBack }: { listId: number, onBack: () => void }) {
  const [listMeta, setListMeta] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  useEffect(() => { fetch(`${API}/lists/${listId}`).then(r => r.json()).then(data => { setListMeta(data.meta); setItems(data.items); }); }, [listId]);
  if (!listMeta) return <div>Loading...</div>;
  return (
    <div>
       <button onClick={onBack} className="mb-4 font-semibold text-sm text-[#8ba0b2]">← Back</button>
       <div className="flex justify-between items-center mb-6"><h2 className="text-white text-2xl font-bold">{listMeta.name}</h2><button onClick={async () => { if(confirm("Delete this list entirely?")) { await apiDelete(`/lists/${listId}`); onBack(); } }} className="text-red-500 hover:text-red-400 text-sm font-bold flex items-center gap-1"><TrashIcon /> Delete List</button></div>
       <div className="grid grid-cols-4 gap-4">
         {items.map((it, idx) => (
           <div key={idx} className="bg-[#151F2E] border border-[#2A394A] rounded p-4 text-center relative group">
             <div className="w-full h-40 bg-black rounded mb-2 overflow-hidden">{it.cover_art_url && <img src={it.cover_art_url} className="w-full h-full object-cover" />}</div>
             <p className="text-white font-bold text-sm truncate">{it.title}</p><p className="text-xs text-[#7A858F] uppercase">{it.category}</p>
             <button onClick={async () => { await fetch(`${API}/lists/${listId}/entries`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category: it.category, item_id: it.id }) }); setItems(prev => prev.filter(item => item.id !== it.id)); }} className="absolute top-2 right-2 bg-red-500/80 hover:bg-red-500 text-white w-6 h-6 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">×</button>
           </div>
         ))}
       </div>
    </div>
  );
}

function ActivityHeatmap() {
  const [heatmapData, setHeatmapData] = useState<{ date: string; count: number }[]>([]);
  useEffect(() => { fetch(`${API}/activity-heatmap`).then(r => r.json()).then(setHeatmapData).catch(() => {}); }, []);
  if (heatmapData.length === 0) return null;
  const firstDate = new Date(heatmapData[0].date);
  const startPadding = firstDate.getDay(); 
  const paddedData = [...Array(startPadding).fill(null), ...heatmapData];
  const getColor = (count: number) => {
    if (count === 0) return 'bg-[#0B1622] border border-[#2A394A]';
    if (count <= 5)  return 'bg-[#3DB4F2]/30';
    if (count <= 15) return 'bg-[#3DB4F2]/60';
    if (count <= 30) return 'bg-[#3DB4F2]/80';
    return 'bg-[#3DB4F2] shadow-[0_0_8px_rgba(61,180,242,0.6)]';
  };
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const daysOfWeek = ["S", "M", "T", "W", "T", "F", "S"];
  return (
    <div className="bg-[#151F2E] border border-[#2A394A] rounded-xl p-6 shadow-sm h-full flex flex-col items-center">
      <div className="w-full mb-6"><h2 className="text-white text-lg font-bold">Activity Heatmap</h2><p className="text-[#7A858F] text-xs font-semibold mt-1">Last 365 Days</p></div>
      <div className="flex flex-col items-center flex-1 w-full pb-2">
        <div className="grid grid-cols-7 gap-1.5 mb-2 w-fit">{daysOfWeek.map((day, idx) => <span key={`header-${idx}`} className="w-3.5 text-center text-[10px] text-[#7A858F] font-bold uppercase">{day}</span>)}</div>
        <div className="grid grid-cols-7 gap-1.5 w-fit">
          {paddedData.map((day, idx) => {
            if (!day) return <div key={`pad-${idx}`} className="w-3.5 h-3.5 rounded-[2px]" />;
            const dateObj = new Date(day.date);
            const formattedDate = `${months[dateObj.getMonth()]} ${dateObj.getDate()}, ${dateObj.getFullYear()}`;
            return <div key={day.date} title={`${day.count} activity points on ${formattedDate}`} className={`w-3.5 h-3.5 rounded-[2px] transition-all duration-300 hover:scale-125 cursor-crosshair ${getColor(day.count)}`} />;
          })}
        </div>
      </div>
      <div className="flex justify-center items-center gap-2 mt-6 pt-6 border-t border-[#2A394A] w-full text-[10px] text-[#7A858F] font-bold uppercase tracking-wider">
        <span>Less</span>
        <div className="flex gap-1.5"><div className="w-3 h-3 rounded-[2px] bg-[#0B1622] border border-[#2A394A]" /><div className="w-3 h-3 rounded-[2px] bg-[#3DB4F2]/30" /><div className="w-3 h-3 rounded-[2px] bg-[#3DB4F2]/60" /><div className="w-3 h-3 rounded-[2px] bg-[#3DB4F2]/80" /><div className="w-3 h-3 rounded-[2px] bg-[#3DB4F2]" /></div>
        <span>More</span>
      </div>
    </div>
  );
}

// ── NEW AUTO-FIT TEXT COMPONENT ──────────────────────────────────────────────
function AutoFitText({ text, color }: { text: string; color: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);

  const adjustSize = useCallback(() => {
    const container = containerRef.current;
    const textNode = textRef.current;
    if (!container || !textNode) return;

    // Start from max size
    textNode.style.fontSize = '48px';
    let fontSize = 48;
    const minSize = 14; 
    
    // Synchronously shrink until it fits
    while (textNode.scrollWidth > container.clientWidth && fontSize > minSize) {
      fontSize -= 1;
      textNode.style.fontSize = `${fontSize}px`;
    }
  }, []);

  useEffect(() => {
    // Run immediately
    adjustSize();
    
    // Run again after a short delay to account for webfonts or React rendering quirks
    const timer = setTimeout(adjustSize, 50);
    
    // Add window resize listener so it adjusts if screen size changes
    window.addEventListener('resize', adjustSize);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', adjustSize);
    };
  }, [text, adjustSize]);

  return (
    <div ref={containerRef} className="w-full flex justify-center items-center mb-2 overflow-hidden h-[50px] min-w-0">
      <span ref={textRef} className="font-extrabold whitespace-nowrap block truncate max-w-full" style={{ color }}>
        {text}
      </span>
    </div>
  );
}

// ── FLIP CARDS & RATING CHART (10-POINT UPDATE) ──────────────────────────────
interface StatData { name: string; value: number; }
interface CategoryStats { id: string; title: string; topStat: StatData; topStats: StatData[]; color: string; label: string; isRating: boolean; }

function TopGenresDashboard({ backendData }: { backendData?: any }) {
  const buildCategoryStats = (data: Record<string, StatData[]> = {}, fallbackLabel: string, isRating = false, customLabels?: string[]): CategoryStats[] => {
    const configs = [
      { id: 'movies', title: 'Movies', color: '#3DB4F2', label: customLabels ? customLabels[0] : fallbackLabel },
      { id: 'shows', title: 'TV Shows', color: '#9B72CF', label: customLabels ? customLabels[1] : fallbackLabel },
      { id: 'albums', title: 'Music', color: '#C2D62E', label: customLabels ? customLabels[2] : fallbackLabel },
      { id: 'books', title: 'Books', color: '#ef4444', label: customLabels ? customLabels[3] : fallbackLabel }
    ];
    return configs.map(c => {
      const items = data[c.id] || [];
      return { ...c, isRating, topStat: items.length > 0 ? items[0] : { name: `No ${c.label}s Yet`, value: 0 }, topStats: items };
    });
  };

  const genreData = buildCategoryStats(backendData?.dashboard_genres, 'Genre');
  const eraData = buildCategoryStats(backendData?.dashboard_eras, 'Era');
  const creatorData = buildCategoryStats(backendData?.dashboard_creators, 'Creator', false, ['Studio', 'Studio', 'Artist', 'Author']);
  const creatorRatingData = buildCategoryStats(backendData?.dashboard_creator_ratings, 'Creator', true, ['Studio', 'Studio', 'Artist', 'Author']);
  const ratingData = backendData?.dashboard_ratings || { movies: Array(10).fill(0), shows: Array(10).fill(0), albums: Array(10).fill(0), books: Array(10).fill(0) };

  return (
    <div className="w-full flex flex-col gap-10">
      
      {/* ROW 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 w-full">
        <div className="w-full flex flex-col items-center text-center"><h3 className="text-[#8ba0b2] text-sm uppercase tracking-widest font-bold mb-4">Genre</h3><InsightWidget data={genreData} /></div>
        <div className="w-full flex flex-col items-center text-center"><h3 className="text-[#8ba0b2] text-sm uppercase tracking-widest font-bold mb-4">Top Era</h3><InsightWidget data={eraData} /></div>
        <div className="w-full flex flex-col items-center text-center"><h3 className="text-[#8ba0b2] text-sm uppercase tracking-widest font-bold mb-4">Rating Overview</h3><RatingOverviewCard ratingData={ratingData} /></div>
      </div>

      {/* ROW 2: Most Frequent, Highest Rated, and Ratings Across Time */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 w-full">
        <div className="w-full flex flex-col items-center text-center"><h3 className="text-[#8ba0b2] text-sm uppercase tracking-widest font-bold mb-4">Most Frequent</h3><InsightWidget data={creatorData} /></div>
        <div className="w-full flex flex-col items-center text-center"><h3 className="text-[#8ba0b2] text-sm uppercase tracking-widest font-bold mb-4">Highest Rated</h3><InsightWidget data={creatorRatingData} /></div>
        <div className="w-full flex flex-col items-center text-center"><h3 className="text-[#8ba0b2] text-sm uppercase tracking-widest font-bold mb-4">Ratings Across Time</h3>
          <EraRatingsCard ratingData={backendData?.dashboard_era_ratings} />
        </div>
      </div>

    </div>
  );
}

function InsightWidget({ data }: { data: CategoryStats[] }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [expandedCategory, setExpandedCategory] = useState<CategoryStats | null>(null);

  const handleNext = () => setActiveIndex((prev) => (prev + 1) % data.length);
  const handleExpand = (category: CategoryStats) => { setExpandedCategory(category); setIsFlipped(true); };
  const handleBack = () => { setIsFlipped(false); setTimeout(() => setExpandedCategory(null), 500); };
  const backCategory = expandedCategory || data[activeIndex];

  return (
    <div className="w-full max-w-sm relative [perspective:1000px]">
      <div className="grid transition-transform duration-700 ease-in-out w-full [transform-style:preserve-3d]" style={{ transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)' }}>
        <div className="col-start-1 row-start-1 w-full h-full [backface-visibility:hidden]" style={{ pointerEvents: isFlipped ? 'none' : 'auto', zIndex: isFlipped ? 0 : 10 }}>
          <StackedCarousel data={data} activeIndex={activeIndex} onNext={handleNext} onExpand={handleExpand} />
        </div>
        <div className="col-start-1 row-start-1 w-full h-full [backface-visibility:hidden]" style={{ transform: 'rotateY(180deg)', pointerEvents: isFlipped ? 'auto' : 'none', zIndex: isFlipped ? 10 : 0 }}>
          <ExpandedStatView category={backCategory} onBack={handleBack} />
        </div>
      </div>
    </div>
  );
}

function StackedCarousel({ data, activeIndex, onNext, onExpand }: { data: CategoryStats[], activeIndex: number, onNext: () => void, onExpand: (cat: CategoryStats) => void }) {
  return (
    <div className="relative w-full h-[280px]">
      {data.map((category, i) => {
        const offset = (i - activeIndex + data.length) % data.length;
        const isFront = offset === 0;
        return (
          <div key={category.id} className="absolute top-0 left-0 w-full rounded-2xl border border-[#2A394A] p-6 shadow-2xl transition-all duration-500 ease-in-out cursor-pointer"
               style={{ backgroundColor: '#151F2E', transform: `translateY(${offset * 24}px) scale(${1 - offset * 0.05})`, zIndex: data.length - offset, opacity: 1 - offset * 0.2, pointerEvents: isFront ? 'auto' : 'none' }}>
            <div className="flex justify-between items-center mb-8">
              <h3 className="text-xl font-bold text-white tracking-wide uppercase">{category.title}</h3>
              {isFront && <button onClick={(e) => { e.stopPropagation(); onNext(); }} className="w-8 h-8 rounded-full bg-[#2A394A] hover:bg-[#3DB4F2] text-white flex items-center justify-center transition-colors shadow-lg"><span className="text-sm">➔</span></button>}
            </div>
            <div className="text-center mb-8">
              <p className="text-[#7A858F] text-xs uppercase tracking-widest font-bold mb-2">#1 TOP {category.label}</p>
              
              <AutoFitText text={category.topStat.name} color={category.color} />
              
              {category.isRating 
                ? <p className="text-sm text-[#8ba0b2] font-medium">Average Rating: ★ {category.topStat.value.toFixed(1)}</p>
                : <p className="text-sm text-[#8ba0b2] font-medium">Accounts for {category.topStat.value}% of your library</p>
              }
            </div>
            {isFront && <button onClick={(e) => { e.stopPropagation(); onExpand(category); }} className="w-full py-3 rounded-lg text-white font-bold transition-opacity hover:opacity-80 shadow-lg" style={{ backgroundColor: category.color }}>Discover Top 5</button>}
          </div>
        );
      })}
      <div className="absolute inset-0 z-0 cursor-pointer" onClick={onNext} />
    </div>
  );
}

function ExpandedStatView({ category, onBack }: { category: CategoryStats, onBack: () => void }) {
  return (
    <div className="w-full min-h-[280px] h-full bg-[#151F2E] border border-[#2A394A] rounded-2xl p-6 shadow-2xl flex flex-col relative z-20">
      <div className="flex items-center gap-4 mb-6">
        <button onClick={(e) => { e.stopPropagation(); onBack(); }} className="p-2 -ml-2 text-[#7A858F] hover:text-white transition-colors relative z-50 cursor-pointer">←</button>
        <div className="text-left"><h2 className="text-white text-lg font-bold">Top 5</h2><p className="text-xs text-[#8ba0b2] uppercase tracking-wider font-semibold">{category.title}</p></div>
      </div>
      <div className="space-y-4 flex-1 relative z-20">
        {category.topStats.map((stat, idx) => (
          <div key={stat.name} className="relative">
            <div className="flex justify-between items-end mb-1.5">
              
              <div className="flex items-center gap-3 w-full min-w-0 pr-2">
                <span className="text-[#7A858F] text-xs font-bold w-4 flex-shrink-0">#{idx + 1}</span>
                <span className="text-white font-semibold text-sm truncate">{stat.name}</span>
              </div>

              <span className="text-xs font-bold flex-shrink-0" style={{ color: category.color }}>{category.isRating ? `★ ${stat.value.toFixed(1)}` : `${stat.value}%`}</span>
            </div>
            <div className="w-full h-1.5 bg-[#0B1622] rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-1000 ease-out" style={{ width: `${category.isRating ? (stat.value / 5) * 100 : stat.value}%`, backgroundColor: category.color }} />
            </div>
          </div>
        ))}
        {category.topStats.length === 0 && <div className="text-[#7A858F] text-sm text-center pt-8">Not enough data yet.</div>}
      </div>
    </div>
  );
}

function RatingOverviewCard({ ratingData }: { ratingData: Record<string, number[]> }) {
  const [activeTab, setActiveTab] = useState<'movies' | 'shows' | 'albums' | 'books'>('movies');
  const tabs = [{ id: 'movies', label: 'Movies', color: '#3DB4F2' }, { id: 'shows', label: 'Shows', color: '#9B72CF' }, { id: 'albums', label: 'Music', color: '#C2D62E' }, { id: 'books', label: 'Books', color: '#ef4444' }];
  const currentTabObj = tabs.find(t => t.id === activeTab)!;
  const currentDataArray = ratingData[activeTab] || Array(10).fill(0);
  const maxVal = Math.max(...currentDataArray, 10); 
  const width = 300, height = 150, padX = 20, padY = 20;
  const chartW = width - padX * 2, chartH = height - padY * 2;
  
  const points = currentDataArray.map((val, i) => ({ 
    x: padX + (i / (currentDataArray.length - 1)) * chartW, 
    y: height - padY - (val / maxVal) * chartH, 
    val 
  }));
  
  const pathD = `M ${points.map(p => `${p.x},${p.y}`).join(' L ')}`;
  const fillD = `${pathD} L ${width - padX},${height - padY} L ${padX},${height - padY} Z`;

  return (
    <div className="w-full max-w-sm h-[280px] bg-[#151F2E] border border-[#2A394A] rounded-2xl p-6 shadow-2xl flex flex-col">
      <div className="flex justify-between items-center bg-[#0B1622] p-1 rounded-lg mb-6 border border-[#2A394A]">
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id as any)} className={`flex-1 py-1.5 text-xs font-bold rounded transition-colors ${activeTab === tab.id ? 'bg-[#151F2E] text-white shadow-sm' : 'text-[#7A858F] hover:text-white'}`}>{tab.label}</button>
        ))}
      </div>
      <div className="flex-1 w-full relative flex flex-col justify-end">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full overflow-visible">
          <defs><linearGradient id={`grad-${activeTab}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={currentTabObj.color} stopOpacity="0.3" /><stop offset="100%" stopColor={currentTabObj.color} stopOpacity="0.0" /></linearGradient></defs>
          <path d={fillD} fill={`url(#grad-${activeTab})`} className="transition-all duration-500 ease-out" />
          <path d={pathD} fill="none" stroke={currentTabObj.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="transition-all duration-500 ease-out" />
          {points.map((p, i) => (
            <g key={i} className="group transition-all duration-500 ease-out">
              <circle cx={p.x} cy={p.y} r="4" fill="#151F2E" stroke={currentTabObj.color} strokeWidth="2" className="transition-all duration-500 ease-out group-hover:r-6" />
              <text x={p.x} y={p.y - 12} fill="white" fontSize="10" fontWeight="bold" textAnchor="middle" className="opacity-0 group-hover:opacity-100 transition-opacity">{p.val}</text>
            </g>
          ))}
        </svg>
        
        <div className="relative w-full h-4 mt-2">
          {points.map((p, i) => {
            const starVal = (i + 1) * 0.5;
            return Number.isInteger(starVal) ? (
              <span key={i} className="absolute text-[#7A858F] text-[10px] font-bold -ml-2 text-center w-4" style={{ left: p.x }}>
                {starVal}★
              </span>
            ) : null;
          })}
        </div>
      </div>
    </div>
  );
}

// ── NEW: RATINGS ACROSS TIME CARD ────────────────────────────────────────────
function EraRatingsCard({ ratingData }: { ratingData?: Record<string, { decade: string; rating: number }[]> }) {
  const [activeTab, setActiveTab] = useState<'movies' | 'shows' | 'albums' | 'books'>('movies');
  const tabs = [
    { id: 'movies', label: 'Movies', color: '#3DB4F2' },
    { id: 'shows', label: 'Shows', color: '#9B72CF' },
    { id: 'albums', label: 'Music', color: '#C2D62E' },
    { id: 'books', label: 'Books', color: '#ef4444' }
  ];
  const currentTabObj = tabs.find(t => t.id === activeTab)!;
  const currentDataArray = ratingData?.[activeTab] || [];
  
  const width = 300, height = 150, padX = 20, padY = 20;
  const chartW = width - padX * 2, chartH = height - padY * 2;
  const maxVal = 5.0; // The theoretical max rating is always 5.0
  
  const points = currentDataArray.map((d, i) => {
    // If only 1 decade exists, center it. Otherwise, space them out evenly.
    const x = currentDataArray.length === 1 ? width / 2 : padX + (i / (currentDataArray.length - 1)) * chartW;
    const y = height - padY - (d.rating / maxVal) * chartH;
    
    // Format "1990s" into "'90s" for cleaner X-axis labels
    const label = d.decade.replace(/^\d{2}/, "'");
    
    return { x, y, val: d.rating, label };
  });

  const pathD = points.length > 0 ? `M ${points.map(p => `${p.x},${p.y}`).join(' L ')}` : '';
  const fillD = points.length > 0 ? `${pathD} L ${points[points.length-1].x},${height - padY} L ${points[0].x},${height - padY} Z` : '';

  return (
    <div className="w-full max-w-sm h-[280px] bg-[#151F2E] border border-[#2A394A] rounded-2xl p-6 shadow-2xl flex flex-col">
      <div className="flex justify-between items-center bg-[#0B1622] p-1 rounded-lg mb-6 border border-[#2A394A]">
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id as any)} className={`flex-1 py-1.5 text-xs font-bold rounded transition-colors ${activeTab === tab.id ? 'bg-[#151F2E] text-white shadow-sm' : 'text-[#7A858F] hover:text-white'}`}>{tab.label}</button>
        ))}
      </div>
      
      {currentDataArray.length === 0 ? (
        <div className="flex-1 w-full flex items-center justify-center text-[#7A858F] text-sm pb-8">
          Not enough rated entries yet.
        </div>
      ) : (
        <div className="flex-1 w-full relative flex flex-col justify-end">
          <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full overflow-visible">
            <defs>
              <linearGradient id={`grad-era-${activeTab}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={currentTabObj.color} stopOpacity="0.3" />
                <stop offset="100%" stopColor={currentTabObj.color} stopOpacity="0.0" />
              </linearGradient>
            </defs>
            <path d={fillD} fill={`url(#grad-era-${activeTab})`} className="transition-all duration-500 ease-out" />
            <path d={pathD} fill="none" stroke={currentTabObj.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="transition-all duration-500 ease-out" />
            
            {points.map((p, i) => (
              <g key={i} className="group transition-all duration-500 ease-out">
                <circle cx={p.x} cy={p.y} r="4" fill="#151F2E" stroke={currentTabObj.color} strokeWidth="2" className="transition-all duration-500 ease-out group-hover:r-6" />
                <text x={p.x} y={p.y - 12} fill="white" fontSize="10" fontWeight="bold" textAnchor="middle" className="opacity-0 group-hover:opacity-100 transition-opacity">
                  {p.val.toFixed(1)}★
                </text>
              </g>
            ))}
          </svg>
          
          {/* X-Axis Decade Labels */}
          <div className="relative w-full h-4 mt-2">
            {points.map((p, i) => (
              <span key={i} className="absolute text-[#7A858F] text-[10px] font-bold -ml-4 text-center w-8" style={{ left: p.x }}>
                {p.label}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
