from flask import Flask, jsonify, request
from flask_cors import CORS
import sqlite3, os, requests, base64, time, threading, re, urllib.parse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from dotenv import load_dotenv

# Load variables from the .env file
load_dotenv()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH  = os.path.join(BASE_DIR, "media_tracker.db")

# Securely fetch the keys from the environment
TMDB_TOKEN            = os.getenv("TMDB_TOKEN")
GOOGLE_BOOKS_KEY      = os.getenv("GOOGLE_BOOKS_KEY")
SPOTIFY_CLIENT_ID     = os.getenv("SPOTIFY_CLIENT_ID")
SPOTIFY_CLIENT_SECRET = os.getenv("SPOTIFY_CLIENT_SECRET")

TMDB_HEADERS = {"accept": "application/json", "Authorization": f"Bearer {TMDB_TOKEN.strip()}"}

app = Flask(__name__)
CORS(app)

TABLE_MAP = {
    "movies": "Staging_Movies",
    "shows":  "Staging_Shows",
    "albums": "Staging_Albums",
    "books":  "Staging_Books",
}

NAME_CANDIDATES = {
    "Staging_Movies": ["movie_name", "MOVIES",    "title", "name"],
    "Staging_Shows":  ["show_name",  "SHOWS",     "title"],
    "Staging_Albums": ["album_title","ALBUMS",    "title"],
    "Staging_Books":  ["book_title", "book_name", "BOOKS", "title"],
}

STATUS_MAP = {
    "Returning Series": "Ongoing", "Ended": "Ended", "Canceled": "Canceled",
    "In Production": "In Production", "Planned": "Not Released Yet", "Pilot": "Pilot",
}

# Rating removed from INTEGER_COLS so it can safely be cast to Float
INTEGER_COLS = {
    "runtime_mins", "avg_runtime", "current_episode", "total_episodes",
    "total_chapters", "mins_watched", "page_count", "total_tracks", "is_manual"
}

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def _to_int(val, default: int = 0) -> int:
    if val is None or val == "": return default
    try: return int(val)
    except (TypeError, ValueError):
        nums = re.findall(r'\d+', str(val))
        return int(nums[0]) if nums else default
        
def _to_float(val, default=0.0):
    if val is None or val == "": return default
    try: return float(val)
    except (TypeError, ValueError): return default

def _build_name_sql(conn, table):
    c_list = [r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]
    valid = [f'"{c}"' for c in NAME_CANDIDATES.get(table, []) if c in c_list]
    return f"COALESCE({', '.join(valid)}, NULL)" if valid else "NULL"

def cn(conn, col, table):
    c_list = [r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]
    return f'"{col}"' if col in c_list else "NULL"

# ── 1. SCHEMA ─────────────────────────────────────────────────────────────

def ensure_schema():
    conn = sqlite3.connect(DB_PATH)
    
    # 1. Build the base tables if they do not exist
    conn.execute("CREATE TABLE IF NOT EXISTS Staging_Movies (title TEXT)")
    conn.execute("CREATE TABLE IF NOT EXISTS Staging_Shows (title TEXT)")
    conn.execute("CREATE TABLE IF NOT EXISTS Staging_Albums (title TEXT)")
    conn.execute("CREATE TABLE IF NOT EXISTS Staging_Books (title TEXT)")

    # 2. Add all the extra metadata columns
    def add(table, col, ctype="TEXT"):
        try: conn.execute(f'ALTER TABLE {table} ADD COLUMN "{col}" {ctype}')
        except sqlite3.OperationalError: pass

    for col, t in [("source","TEXT"),("notes","TEXT"),("type","TEXT"),("cover_art_url","TEXT"),("runtime_mins","INTEGER"),("genre","TEXT"),("release_year","TEXT"),("director","TEXT"),("lead_actor","TEXT"),("production_company","TEXT"),("studio","TEXT"),("origin_country","TEXT"),("release_status","TEXT"),("show_type","TEXT"),("genre_list","TEXT"),("is_manual","INTEGER"),("added_at","DATETIME"), ("created_at","DATETIME"), ("updated_at","DATETIME"),("rating", "REAL")]: add("Staging_Movies", col, t)
    for col, t in [("source","TEXT"),("notes","TEXT"),("type","TEXT"),("cover_art_url","TEXT"),("seasons","TEXT"),("genre","TEXT"),("studio","TEXT"),("origin_country","TEXT"),("release_status","TEXT"),("show_type","TEXT"),("avg_runtime","INTEGER"),("current_episode","INTEGER"),("total_episodes","INTEGER"),("mins_watched","INTEGER"),("genre_list","TEXT"),("release_year","TEXT"),("is_manual","INTEGER"), ("added_at","DATETIME"), ("created_at","DATETIME"), ("updated_at","DATETIME"),("rating", "REAL")]: add("Staging_Shows", col, t)
    for col, t in [("source","TEXT"),("notes","TEXT"),("type","TEXT"),("cover_art_url","TEXT"),("genre","TEXT"),("author","TEXT"),("publisher","TEXT"),("release_year","TEXT"),("page_count","INTEGER"),("current_episode","INTEGER"),("total_episodes","INTEGER"),("total_chapters","INTEGER"),("genre_list","TEXT"),("is_manual","INTEGER"),("added_at","DATETIME"), ("created_at","DATETIME"), ("updated_at","DATETIME"),("rating", "REAL")]: add("Staging_Books", col, t)
    for col, t in [("source","TEXT"),("notes","TEXT"),("type","TEXT"),("cover_art_url","TEXT"),("artist","TEXT"),("release_year","TEXT"),("total_tracks","INTEGER"),("genre","TEXT"),("record_label","TEXT"),("runtime_mins","INTEGER"),("genre_list","TEXT"),("is_manual","INTEGER"), ("added_at","DATETIME"), ("created_at","DATETIME"), ("updated_at","DATETIME"),("rating", "REAL")]: add("Staging_Albums", col, t)

    conn.execute('''CREATE TABLE IF NOT EXISTS UserStats (id INTEGER PRIMARY KEY CHECK (id = 1), total_movie_time INTEGER DEFAULT 0, total_tv_time INTEGER DEFAULT 0, total_music_time INTEGER DEFAULT 0, total_pages_read INTEGER DEFAULT 0)''')
    conn.execute("INSERT OR IGNORE INTO UserStats (id, total_movie_time, total_tv_time, total_music_time, total_pages_read) VALUES (1, 0, 0, 0, 0)")
    conn.execute('''CREATE TABLE IF NOT EXISTS ActivityLog (id INTEGER PRIMARY KEY AUTOINCREMENT, action_type TEXT, category TEXT, title TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)''')
    conn.execute('''CREATE TABLE IF NOT EXISTS CustomLists (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)''')
    conn.execute('''CREATE TABLE IF NOT EXISTS ListItems (list_id INTEGER, category TEXT, item_id INTEGER, added_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (list_id, category, item_id))''')
    conn.execute('''CREATE TABLE IF NOT EXISTS Tags (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL)''')
    conn.execute('''CREATE TABLE IF NOT EXISTS ItemTags (tag_id INTEGER, category TEXT, item_id INTEGER, PRIMARY KEY (tag_id, category, item_id))''')

    conn.commit()
    conn.close()

# ── 2. EXTERNAL APIs ──────────────────────────────────────────────────────

def _tmdb(path):
    try:
        r = requests.get(f"https://api.themoviedb.org/3{path}", headers=TMDB_HEADERS, timeout=8)
        return r.json() if r.status_code == 200 else {}
    except requests.RequestException: return {}

def _gbooks(query):
    try:
        r = requests.get(f"https://www.googleapis.com/books/v1/volumes?q={urllib.parse.quote(query)}&key={GOOGLE_BOOKS_KEY}", timeout=8)
        return r.json().get("items", []) if r.status_code == 200 else []
    except requests.RequestException: return []

_spotify_token = ""; _spotify_token_expiry = 0.0

def _get_spotify_token():
    global _spotify_token, _spotify_token_expiry
    if _spotify_token and time.time() < _spotify_token_expiry - 30: return _spotify_token
    try:
        auth_b64 = base64.b64encode(f"{SPOTIFY_CLIENT_ID}:{SPOTIFY_CLIENT_SECRET}".encode()).decode()
        token_url = "".join(["http","s://","acc","ounts.sp","otify.c","om/api/to","ken"])
        r = requests.post(token_url, headers={"Authorization": f"Basic {auth_b64}", "Content-Type": "application/x-www-form-urlencoded"}, data={"grant_type": "client_credentials"}, timeout=5)
        body = r.json()
        _spotify_token = body.get("access_token", ""); _spotify_token_expiry = time.time() + body.get("expires_in", 3600)
        return _spotify_token
    except Exception: return ""

def _spotify(endpoint):
    token = _get_spotify_token()
    if not token: return {}
    try:
        base_url = "".join(["http","s://","ap","i.sp","otify.c","om/v","1"])
        r = requests.get(f"{base_url}{endpoint}", headers={"Authorization": f"Bearer {token}"}, timeout=8)
        return r.json() if r.status_code == 200 else {}
    except Exception: return {}

def _best_spotify_album(title, artist):
    search_q = f"{title} {artist}".strip()
    res = _spotify(f"/search?q={urllib.parse.quote(search_q)}&type=album&limit=1")
    items = res.get("albums",{}).get("items",[])
    if items:
        sp_id = items[0].get("id","")
        return _spotify(f"/albums/{sp_id}") if sp_id else items[0]
    return None

# ── 3. HELPERS & SEARCH ───────────────────────────────────────────────────

def _resolve_title(db, table):
    for c in NAME_CANDIDATES.get(table, []):
        if db.get(c): return db[c]
    return ""

def _row_or_404(conn, table, rowid):
    row = conn.execute(f"SELECT rowid AS _id, * FROM {table} WHERE rowid = ?", (rowid,)).fetchone()
    return dict(row) if row else None

def _simple_update(category, item_id, col, val):
    table = TABLE_MAP.get(category)
    if not table: return jsonify({"error": "Invalid category"}), 400
    if col in INTEGER_COLS: val = _to_int(val)
    conn = get_db(); conn.execute(f'UPDATE {table} SET "{col}" = ? WHERE rowid = ?', (val, item_id)); conn.commit(); conn.close()
    return jsonify({"success": True})

def _write_back(conn, table, rowid, updates: dict):
    existing = [r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]
    sets, params = [], []
    for k, v in updates.items():
        if k in existing and v not in (None, "", "—"):
            if k in INTEGER_COLS: v = _to_int(v)
            sets.append(f'"{k}" = ?'); params.append(v)
    if sets:
        params.append(rowid); conn.execute(f"UPDATE {table} SET {', '.join(sets)} WHERE rowid = ?", params); conn.commit()

@app.route("/api/search/tmdb")
def search_tmdb():
    query = request.args.get("q", "").strip(); category = request.args.get("category", "movies")
    if not query: return jsonify([])
    if category == "books":
        items = _gbooks(query)
        return jsonify([{"title": vol.get("title","Unknown") + (f" by {vol['authors'][0]}" if vol.get("authors") else ""), "cover_art_url": vol.get("imageLinks",{}).get("thumbnail","").replace("http:","https:"), "tmdb_id": item.get("id")} for item in items[:5] for vol in [item.get("volumeInfo",{})]])
    if category == "albums":
        data = _spotify(f"/search?q={urllib.parse.quote(query)}&type=album&limit=5")
        return jsonify([{"title": f"{item.get('name','Unknown')} by {', '.join(a['name'] for a in item.get('artists',[]))}", "cover_art_url": (item.get("images") or [{}])[0].get("url",""), "tmdb_id": item.get("id")} for item in data.get("albums",{}).get("items",[])])
    kind = "tv" if category == "shows" else "movie"
    data = _tmdb(f"/search/{kind}?query={urllib.parse.quote(query)}&language=en-US&page=1")
    return jsonify([{"title": i.get("title") or i.get("name"), "cover_art_url": f"https://image.tmdb.org/t/p/w500{i['poster_path']}", "tmdb_id": i.get("id")} for i in data.get("results",[])[:5] if i.get("poster_path")])

# ── 4. INSERT ROUTES ──────────────────────────────────────────────────────

def _insert(table, data):
    conn = get_db()
    existing = [r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]
    candidates = NAME_CANDIDATES.get(table, ["title"])
    for key in data:
        if key != "title" and key not in existing:
            ctype = "INTEGER" if key in INTEGER_COLS else "TEXT"
            try: conn.execute(f'ALTER TABLE {table} ADD COLUMN "{key}" {ctype}')
            except sqlite3.OperationalError: pass
            
    existing = [r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]
    name_col = next((c for c in candidates if c in existing), candidates[0])
    c_list, v_list = [f'"{name_col}"'], [data.get("title")]
    for key, val in data.items():
        if key != "title" and key in existing:
            if key in INTEGER_COLS: val = _to_int(val)
            c_list.append(f'"{key}"'); v_list.append(val)
    if "created_at" in existing and "created_at" not in data: c_list.append('"created_at"'); v_list.append(time.strftime("%Y-%m-%dT%H:%M:%S"))
    if "type" not in data and "type" in existing: c_list.append('"type"'); v_list.append("Planning")
    ph = ",".join(["?"] * len(c_list))
    conn.execute(f"INSERT INTO {table} ({','.join(c_list)}) VALUES ({ph})", v_list)
    cat_name = {"Staging_Movies": "movies", "Staging_Shows": "shows", "Staging_Books": "books", "Staging_Albums": "albums"}.get(table, "media")
    conn.execute("INSERT INTO ActivityLog (action_type, category, title) VALUES (?, ?, ?)", ("Added", cat_name, data.get("title")))
    conn.commit(); conn.close()

@app.route("/api/movies", methods=["GET", "POST"])
def add_movie():
    data = dict(request.json)
    if not data.get("is_manual"):
        tmdb_id = data.get("tmdb_id")
        d = None
        if tmdb_id:
            d = _tmdb(f"/movie/{tmdb_id}")
        else:
            search = _tmdb(f"/search/movie?query={urllib.parse.quote(data.get('title',''))}&language=en-US&page=1")
            if search.get("results"): d = _tmdb(f"/movie/{search['results'][0]['id']}")
            
        if d:
            if d.get("runtime"): data["runtime_mins"] = d["runtime"]
            genres = [g["name"] for g in d.get("genres",[])]
            if genres: data["genre"] = genres[0]; data["genre_list"] = ", ".join(genres)
            if d.get("production_companies"): data["studio"] = d["production_companies"][0]["name"]
            if d.get("production_countries"): data["origin_country"] = d["production_countries"][0]["name"]
            if d.get("status"): data["release_status"] = d["status"]
            if d.get("release_date"): data["release_year"] = d["release_date"][:4]
            origin_codes = [c["iso_3166_1"] for c in d.get("production_countries",[])]
            is_anim = "Animation" in genres; data["show_type"] = "Anime" if (is_anim and "JP" in origin_codes) else ("Animation" if is_anim else "Live-Action")
            if not data.get("cover_art_url") and d.get("poster_path"): data["cover_art_url"] = f"https://image.tmdb.org/t/p/w500{d['poster_path']}"
            
    data.pop("tmdb_id", None) 
    _insert("Staging_Movies", data); return jsonify({"success": True})

@app.route("/api/shows", methods=["GET", "POST"])
def add_show():
    data = dict(request.json)
    if not data.get("is_manual"):
        tmdb_id = data.get("tmdb_id")
        d = None
        
        if tmdb_id:
            d = _tmdb(f"/tv/{tmdb_id}")
        else:
            search = _tmdb(f"/search/tv?query={urllib.parse.quote(data.get('title',''))}&language=en-US&page=1")
            if search.get("results"):
                results = search["results"]
                exact_matches = [r for r in results if r.get("name","").lower() == data.get("title","").lower()]
                first = exact_matches[0] if exact_matches else results[0]
                d = _tmdb(f"/tv/{first['id']}")
                
        if d:
            sn, en_field = d.get("number_of_seasons",0), d.get("number_of_episodes",0)
            en_sum = sum(sec.get("episode_count", 0) for sec in d.get("seasons", []) if sec.get("season_number", 0) > 0)
            en = max(en_field, en_sum) 
            
            if sn > 0 or en > 0: 
                data["seasons"] = f"{sn} Season{'s' if sn!=1 else ''} ({en} eps)"
                data["total_episodes"] = en
                
            genres = [g["name"] for g in d.get("genres",[])]; vis = [g for g in genres if g != "Animation"]
            data["genre"] = (vis or genres or ["—"])[0]; data["genre_list"] = ", ".join(vis or genres)
            if d.get("networks"): data["studio"] = d["networks"][0]["name"]
            if d.get("first_air_date"): data["release_year"] = d["first_air_date"][:4]
            origin = d.get("origin_country",[]); is_anim = "Animation" in genres
            data["show_type"] = "Anime" if (is_anim and "JP" in origin) else ("Animation" if is_anim else "Live-Action")
            rt = d.get("episode_run_time",[])
            if rt: data["avg_runtime"] = int(rt[0])
            if not data.get("cover_art_url") and d.get("poster_path"): data["cover_art_url"] = f"https://image.tmdb.org/t/p/w500{d['poster_path']}"
            
    data.pop("tmdb_id", None) 
    _insert("Staging_Shows", data); return jsonify({"success": True})

@app.route("/api/albums", methods=["GET", "POST"])
def add_album():
    data = dict(request.json)
    raw_title = data.get("title","")
    if data.get("is_manual"): 
        _insert("Staging_Albums", data)
        return jsonify({"success": True})
        
    album_name = raw_title.split(" by ")[0].strip()
    data_to_insert = {"title": album_name, "cover_art_url": data.get("cover_art_url","")}
    
    # --- THE FIX: Use exact Spotify ID from search ---
    tmdb_id = data.get("tmdb_id")
    album = None
    if tmdb_id:
        album = _spotify(f"/albums/{tmdb_id}")
    else:
        album = _best_spotify_album(raw_title, "")
        
    if album:
        data_to_insert["title"] = album.get("name", album_name)
        data_to_insert["artist"] = ", ".join(a["name"] for a in album.get("artists",[]))
        data_to_insert["total_tracks"] = album.get("total_tracks", 0)
        data_to_insert["record_label"] = album.get("label","")
        if album.get("release_date"): data_to_insert["release_year"] = album["release_date"][:4]
        tracks = album.get("tracks",{}).get("items",[])
        if tracks: data_to_insert["runtime_mins"] = sum(t.get("duration_ms",0) for t in tracks) // 60000
        artists = album.get("artists",[])
        if artists and artists[0].get("id"):
            artist_data = _spotify(f"/artists/{artists[0]['id']}")
            genres = artist_data.get("genres",[])
            if genres: 
                data_to_insert["genre"] = genres[0].title()
                data_to_insert["genre_list"] = ", ".join(g.title() for g in genres)
                
    data.pop("tmdb_id", None) 
    _insert("Staging_Albums", data_to_insert)
    return jsonify({"success": True})

@app.route("/api/books", methods=["GET", "POST"])
def add_book():
    data = dict(request.json)
    if not data.get("is_manual"):
        raw = data.get("title",""); search_title = raw.split(" by ")[0].strip(); items = _gbooks(raw)
        if items:
            vol = items[0].get("volumeInfo",{})
            data["title"] = vol.get("title", search_title); data["author"] = ", ".join(vol.get("authors",[])); data["page_count"] = vol.get("pageCount",0); data["publisher"] = vol.get("publisher","—")
            if vol.get("publishedDate"): data["release_year"] = vol["publishedDate"][:4]
            cover = vol.get("imageLinks",{}).get("thumbnail","").replace("http:","https:")
            if cover: data["cover_art_url"] = cover
            cats = vol.get("categories",[]); data["genre"] = cats[0] if cats else "—"; data["genre_list"] = ", ".join(cats) if cats else "—"
        else: data["title"] = search_title
    _insert("Staging_Books", data); return jsonify({"success": True})

# ── 5. PROGRESS & STATUS LOGIC ────────────────────────────────────────────

def _step_progress(table, item_id, delta):
    conn = get_db()
    cols_exist = [r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]
    row = conn.execute(f"SELECT * FROM {table} WHERE rowid=?", (item_id,)).fetchone()
    if not row: conn.close(); return 0
    old_ep = int(row["current_episode"] if "current_episode" in cols_exist and row["current_episode"] else 0)
    max_ep = None
    if "Shows" in table: max_ep = int(row["total_episodes"] if "total_episodes" in cols_exist and row["total_episodes"] else 0)
    elif "Books" in table: max_ep = int(row["page_count"] if "page_count" in cols_exist and row["page_count"] else 0)
    new_ep = old_ep + delta
    if new_ep < 0: new_ep = 0
    if max_ep and max_ep > 0 and new_ep > max_ep: new_ep = max_ep
    ep_delta = new_ep - old_ep
    conn.execute(f"UPDATE {table} SET current_episode=? WHERE rowid=?", (new_ep, item_id))

    if ep_delta != 0:
        title = _resolve_title(dict(row), table)
        cat_name = {"Staging_Movies": "movies", "Staging_Shows": "shows", "Staging_Books": "books", "Staging_Albums": "albums"}.get(table, "media")
        conn.execute("INSERT INTO ActivityLog (action_type, category, title) VALUES (?, ?, ?)", ("Updated Progress", cat_name, title))
        if "updated_at" in cols_exist: conn.execute(f"UPDATE {table} SET updated_at = CURRENT_TIMESTAMP WHERE rowid=?", (item_id,))
        if "Shows" in table:
            rt_mins = int(row["avg_runtime"] if "avg_runtime" in cols_exist and row["avg_runtime"] else 0)
            conn.execute("UPDATE UserStats SET total_tv_time = total_tv_time + ? WHERE id = 1", (ep_delta * rt_mins,))
        elif "Books" in table: conn.execute("UPDATE UserStats SET total_pages_read = total_pages_read + ? WHERE id = 1", (ep_delta,))

    if max_ep and max_ep > 0 and new_ep >= max_ep:
        status_val = "Read" if "Books" in table else "Watched"; current_type = row.get("type")
        if current_type not in ("Watched", "Completed", "Read", "Listened"):
            conn.execute(f"UPDATE {table} SET type=? WHERE rowid=?", (status_val, item_id))
            conn.execute("INSERT INTO ActivityLog (action_type, category, title) VALUES (?, ?, ?)", (f"Marked as {status_val}", cat_name, title))

    conn.commit(); conn.close(); return new_ep

@app.route("/api/<category>/<int:item_id>/increment", methods=["GET", "POST"])
def increment_progress(category, item_id):
    amount = 1
    if request.is_json and request.json.get("amount"): amount = _to_int(request.json.get("amount", 1))
    return jsonify({"success": True, "new_count": _step_progress(TABLE_MAP.get(category), item_id, amount)})

@app.route("/api/<category>/<int:item_id>/decrement", methods=["GET", "POST"])
def decrement_progress(category, item_id):
    amount = -1
    if request.is_json and request.json.get("amount"): amount = -abs(_to_int(request.json.get("amount", 1)))
    return jsonify({"success": True, "new_count": _step_progress(TABLE_MAP.get(category), item_id, amount)})

@app.route("/api/<category>/<int:item_id>/status", methods=["GET", "POST"])
def update_status(category, item_id):
    new_status = request.json.get("status", "Planning"); table = TABLE_MAP.get(category)
    if not table: return jsonify({"error": "Invalid category"}), 400
    conn = get_db(); cols_exist = [r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]
    row = conn.execute(f"SELECT * FROM {table} WHERE rowid = ?", (item_id,)).fetchone()
    old_status = row["type"] if row and "type" in cols_exist and row["type"] else "Planning"

    if category in ["movies", "albums"]:
        runtime = int(row["runtime_mins"] if row and "runtime_mins" in cols_exist and row["runtime_mins"] else 0)
        col = "total_movie_time" if category == "movies" else "total_music_time"
        if old_status not in ("Watched", "Completed", "Listened") and new_status in ("Watched", "Completed", "Listened"):
            conn.execute(f"UPDATE UserStats SET {col} = {col} + ? WHERE id = 1", (runtime,))
        elif old_status in ("Watched", "Completed", "Listened") and new_status not in ("Watched", "Completed", "Listened"):
            conn.execute(f"UPDATE UserStats SET {col} = MAX(0, {col} - ?) WHERE id = 1", (runtime,))

    if new_status in ("Watched", "Completed", "Listened", "Read") and category in ["shows", "books"]:
        if row:
            tot_ep = int(row["total_episodes"] if "total_episodes" in cols_exist and row["total_episodes"] else 0)
            cur_ep = int(row["current_episode"] if "current_episode" in cols_exist and row["current_episode"] else 0)
            if tot_ep > 0 and cur_ep < tot_ep:
                conn.execute(f"UPDATE {table} SET current_episode = ? WHERE rowid = ?", (tot_ep, item_id)); ep_delta = tot_ep - cur_ep
                if category == "shows":
                    rt_mins = int(row["avg_runtime"] if "avg_runtime" in cols_exist and row["avg_runtime"] else 0)
                    conn.execute("UPDATE UserStats SET total_tv_time = total_tv_time + ? WHERE id = 1", (ep_delta * rt_mins,))
                elif category == "books":
                    pg_count = int(row["page_count"] if "page_count" in cols_exist and row["page_count"] else 0)
                    pages_delta = int(ep_delta * (pg_count / tot_ep))
                    conn.execute("UPDATE UserStats SET total_pages_read = total_pages_read + ? WHERE id = 1", (pages_delta,))
    
    if old_status != new_status:
        title = _resolve_title(dict(row), table)
        conn.execute("INSERT INTO ActivityLog (action_type, category, title) VALUES (?, ?, ?)", (f"Marked as {new_status}", category, title))
        if "updated_at" in cols_exist: conn.execute(f"UPDATE {table} SET updated_at = CURRENT_TIMESTAMP WHERE rowid = ?", (item_id,))

    conn.execute(f'UPDATE {table} SET type = ? WHERE rowid = ?', (new_status, item_id)); conn.commit(); conn.close()
    if category in ("shows", "books"): sync_historical_stats()
    return jsonify({"success": True})

@app.route("/api/<category>/<int:item_id>/rating", methods=["GET", "POST"])
def update_rating(category, item_id):
    val = _to_float(request.json.get("rating", 0))
    if val < 0: val = 0.0
    if val > 5: val = 5.0
    return _simple_update(category, item_id, "rating", val)

# ── 6. LISTS & TAGS ENDPOINTS ─────────────────────────────────────────────

@app.route("/api/lists", methods=["GET", "POST"])
def handle_lists():
    conn = get_db()
    if request.method == "POST":
        name = request.json.get("name", "New List"); desc = request.json.get("description", "")
        cur = conn.execute("INSERT INTO CustomLists (name, description) VALUES (?, ?)", (name, desc)); conn.commit(); list_id = cur.lastrowid; conn.close()
        return jsonify({"id": list_id, "name": name, "description": desc})
    
    lists = [dict(r) for r in conn.execute("SELECT * FROM CustomLists ORDER BY created_at DESC").fetchall()]; conn.close()
    return jsonify(lists)

@app.route("/api/lists/<int:list_id>", methods=["GET", "DELETE"])
def handle_single_list(list_id):
    conn = get_db()
    if request.method == "DELETE":
        conn.execute("DELETE FROM CustomLists WHERE id=?", (list_id,)); conn.execute("DELETE FROM ListItems WHERE list_id=?", (list_id,)); conn.commit(); conn.close()
        return jsonify({"success": True})
        
    list_meta = conn.execute("SELECT * FROM CustomLists WHERE id=?", (list_id,)).fetchone()
    if not list_meta: conn.close(); return jsonify({"error": "List not found"}), 404
        
    items_raw = conn.execute("SELECT category, item_id FROM ListItems WHERE list_id=?", (list_id,)).fetchall(); items = []
    for r in items_raw:
        cat = r["category"]; item_id = r["item_id"]; table = TABLE_MAP.get(cat)
        if not table: continue
        ns = _build_name_sql(conn, table)
        item_data = conn.execute(f"SELECT rowid as id, {ns} as title, cover_art_url, type as status FROM {table} WHERE rowid=?", (item_id,)).fetchone()
        if item_data: d = dict(item_data); d["category"] = cat; items.append(d)
    conn.close()
    return jsonify({"meta": dict(list_meta), "items": items})

@app.route("/api/lists/<int:list_id>/entries", methods=["GET", "POST", "DELETE"]) 
def list_entries(list_id):
    conn = get_db(); cat = request.json.get("category"); item_id = request.json.get("item_id")
    if request.method == "POST": conn.execute("INSERT OR IGNORE INTO ListItems (list_id, category, item_id) VALUES (?, ?, ?)", (list_id, cat, item_id))
    else: conn.execute("DELETE FROM ListItems WHERE list_id=? AND category=? AND item_id=?", (list_id, cat, item_id))
    conn.commit(); conn.close(); return jsonify({"success": True})

@app.route("/api/tags", methods=["GET"])
def get_tags():
    conn = get_db(); tags = [dict(r) for r in conn.execute("SELECT * FROM Tags ORDER BY name ASC").fetchall()]; conn.close()
    return jsonify(tags)

@app.route("/api/<category>/<int:item_id>/tags", methods=["GET", "POST"])
def add_tag(category, item_id):
    tag_name = request.json.get("tag_name", "").strip().lower()
    if not tag_name: return jsonify({"error": "Name required"}), 400
    conn = get_db(); conn.execute("INSERT OR IGNORE INTO Tags (name) VALUES (?)", (tag_name,))
    tag = conn.execute("SELECT id FROM Tags WHERE name=?", (tag_name,)).fetchone()
    conn.execute("INSERT OR IGNORE INTO ItemTags (tag_id, category, item_id) VALUES (?, ?, ?)", (tag["id"], category, item_id))
    conn.commit(); conn.close(); return jsonify({"success": True, "tag": tag_name})

@app.route("/api/<category>/<int:item_id>/tags/<tag_name>", methods=["DELETE"])
def remove_tag(category, item_id, tag_name):
    conn = get_db(); tag = conn.execute("SELECT id FROM Tags WHERE name=?", (tag_name,)).fetchone()
    if tag: conn.execute("DELETE FROM ItemTags WHERE tag_id=? AND category=? AND item_id=?", (tag["id"], category, item_id)); conn.commit()
    conn.close(); return jsonify({"success": True})

# ── ENRICHMENT ENGINE (SMART BACKFILL) ────────────────────────────────────

def _needs_enrichment(db_dict, required_fields):
    if db_dict.get("is_manual", 0) == 1: return False
    for field in required_fields:
        val = db_dict.get(field)
        if not val or str(val).strip() in ("0", "—", "None", "", "Unknown"):
            return True
    return False

def enrich_movie(conn, item_id, db_dict):
    if not _needs_enrichment(db_dict, ["runtime_mins", "studio", "origin_country"]): return db_dict
    title = _resolve_title(db_dict, "Staging_Movies")
    search = _tmdb(f"/search/movie?query={urllib.parse.quote(title)}&language=en-US&page=1")
    if not search.get("results"): return db_dict
    d = _tmdb(f"/movie/{search['results'][0]['id']}")
    wb = {}
    if d.get("release_date"): wb["release_year"] = d["release_date"][:4]
    if d.get("runtime"): wb["runtime_mins"] = d["runtime"]
    if d.get("production_companies"): wb["studio"] = d["production_companies"][0]["name"]
    countries = d.get("production_countries", [])
    if countries: wb["origin_country"] = countries[0]["name"]
    wb["release_status"] = d.get("status", "—")
    genres = [g["name"] for g in d.get("genres", [])]
    if genres:
        wb["genre"] = genres[0]
        wb["genre_list"] = ", ".join(genres)
        is_anim = "Animation" in genres
        origin_codes = [c["iso_3166_1"] for c in countries]
        wb["show_type"] = "Anime" if (is_anim and "JP" in origin_codes) else ("Animation" if is_anim else "Live-Action")
    if not db_dict.get("cover_art_url") and search["results"][0].get("poster_path"):
        wb["cover_art_url"] = f"https://image.tmdb.org/t/p/w500{search['results'][0]['poster_path']}"
    if wb:
        _write_back(conn, "Staging_Movies", item_id, wb)
        db_dict.update(wb)
    return db_dict

def enrich_show(conn, item_id, db_dict):
    if not _needs_enrichment(db_dict, ["avg_runtime", "studio", "release_status"]): return db_dict
    
    title = _resolve_title(db_dict, "Staging_Shows")
    search = _tmdb(f"/search/tv?query={urllib.parse.quote(title)}&language=en-US&page=1")
    if not search.get("results"): return db_dict
    
    results = search["results"]
    exact_matches = [r for r in results if r.get("name","").lower() == title.lower()]
    first = exact_matches[0] if exact_matches else results[0]
    d = _tmdb(f"/tv/{first['id']}")
    
    wb = {}
    if d.get("first_air_date"): wb["release_year"] = d["first_air_date"][:4]
    
    sn = d.get("number_of_seasons", 0)
    en_field = d.get("number_of_episodes", 0)
    en_sum = sum(sec.get("episode_count", 0) for sec in d.get("seasons", []) if sec.get("season_number", 0) > 0)
    en = max(en_field, en_sum)
    
    if sn > 0 or en > 0:
        wb["seasons"] = f"{sn} Season{'s' if sn!=1 else ''} ({en} eps)"
    if en > 0: 
        wb["total_episodes"] = en
        
    if d.get("networks"): wb["studio"] = d["networks"][0]["name"]
    wb["release_status"] = STATUS_MAP.get(d.get("status",""), d.get("status","") or "—")
    rt = d.get("episode_run_time",[])
    if rt: wb["avg_runtime"] = rt[0]
    
    origin = d.get("origin_country",[])
    pc = d.get("production_countries",[])
    wb["origin_country"] = (", ".join(c["name"] for c in pc) if pc else ", ".join(origin) if origin else "—")
    
    genres = [g["name"] for g in d.get("genres",[])]
    if genres:
        is_anim = "Animation" in genres
        wb["show_type"] = "Anime" if (is_anim and "JP" in origin) else ("Animation" if is_anim else "Live-Action")
        vis = [g for g in genres if g != "Animation"]
        wb["genre_list"] = ", ".join(vis) if vis else "—"
        if vis: wb["genre"] = vis[0]
        
    if not db_dict.get("cover_art_url") and first.get("poster_path"):
        wb["cover_art_url"] = f"https://image.tmdb.org/t/p/w500{first['poster_path']}"

    if wb:
        _write_back(conn, "Staging_Shows", item_id, wb)
        db_dict.update(wb)
    return db_dict

def enrich_album(conn, item_id, db_dict):
    if not _needs_enrichment(db_dict, ["runtime_mins", "record_label", "total_tracks"]): return db_dict
    title = _resolve_title(db_dict, "Staging_Albums")
    album = _best_spotify_album(title, (db_dict.get('artist') or '').strip())
    if not album: return db_dict
    wb = {}
    artists_str = ", ".join(a["name"] for a in album.get("artists",[]))
    if artists_str: wb["artist"] = artists_str
    if album.get("release_date"): wb["release_year"] = album["release_date"][:4]
    if album.get("total_tracks"): wb["total_tracks"] = album["total_tracks"]
    if album.get("label"): wb["record_label"] = album["label"]
    tracks = album.get("tracks",{}).get("items",[])
    if tracks: wb["runtime_mins"] = sum(tr.get("duration_ms",0) for tr in tracks) // 60000
    artists = album.get("artists",[])
    if artists and artists[0].get("id"):
        artist_data = _spotify(f"/artists/{artists[0]['id']}")
        genres = artist_data.get("genres",[])
        if genres: 
            wb["genre"] = genres[0].title()
            wb["genre_list"] = ", ".join(g.title() for g in genres)
    if not db_dict.get("cover_art_url"):
        imgs = album.get("images",[])
        if imgs: wb["cover_art_url"] = imgs[0]["url"]
    if wb:
        _write_back(conn, "Staging_Albums", item_id, wb)
        db_dict.update(wb)
    return db_dict

def enrich_book(conn, item_id, db_dict):
    if not _needs_enrichment(db_dict, ["page_count", "publisher"]): return db_dict
    title = _resolve_title(db_dict, "Staging_Books")
    items = _gbooks(title)
    if not items: return db_dict
    vol = items[0].get("volumeInfo",{})
    wb = {}
    if vol.get("authors"): wb["author"] = ", ".join(vol["authors"])
    if vol.get("publisher"): wb["publisher"] = vol["publisher"]
    if vol.get("publishedDate"): wb["release_year"] = vol["publishedDate"][:4]
    if vol.get("pageCount"): wb["page_count"] = vol["pageCount"]
    cats = vol.get("categories",[])
    if cats: 
        wb["genre"] = cats[0]; wb["genre_list"] = ", ".join(cats)
    cover = vol.get("imageLinks",{}).get("thumbnail","").replace("http:","https:")
    if cover and not db_dict.get("cover_art_url"): wb["cover_art_url"] = cover
    if wb:
        _write_back(conn, "Staging_Books", item_id, wb)
        db_dict.update(wb)
    return db_dict

# ── 7. VIEW ROUTES ────────────────────────────────────────────────────────

def _get_tags_sql(category, item_id_col):
    return f"(SELECT GROUP_CONCAT(t.name) FROM ItemTags it JOIN Tags t ON it.tag_id = t.id WHERE it.category = '{category}' AND it.item_id = {item_id_col}) AS custom_tags"

@app.route("/api/movies", methods=["GET"])
def get_all_movies():
    t = "Staging_Movies"
    conn = get_db()
    ns = _build_name_sql(conn, t)
    rt_col = "runtime_mins" if cn(conn, "runtime_mins", t) != "NULL" else ("runtime" if cn(conn, "runtime", t) != "NULL" else "NULL")
    rows = conn.execute(f'''SELECT {t}.rowid AS movie_id, {ns} AS title, cover_art_url, CAST(COALESCE({rt_col}, 0) AS INTEGER) AS runtime_mins, {cn(conn, "genre", t)} AS genre, {cn(conn, "type", t)} AS status, {cn(conn, "notes", t)} AS notes, {cn(conn, "release_year", t)} AS release_year, {cn(conn, "studio", t)} AS studio, COALESCE({cn(conn, "is_manual", t)}, 0) AS is_manual, COALESCE({cn(conn, "rating", t)}, 0.0) AS rating, {_get_tags_sql("movies", f"{t}.rowid")} FROM {t} WHERE {ns} IS NOT NULL AND TRIM({ns})!="" AND {ns}!="MOVIE NAME" ORDER BY TRIM({ns}) COLLATE NOCASE ASC''').fetchall()
    conn.close(); result = []
    for r in rows: 
        d = dict(r); d["status"] = d.get("status") or "Planning"; rt = d.get("runtime_mins", 0); d["runtime_display"] = f"{rt} mins" if rt and int(rt) > 0 else "—"; result.append(d)
    return jsonify(result)

@app.route("/api/shows", methods=["GET"])
def get_all_shows():
    t = "Staging_Shows"
    conn = get_db()
    try: 
        ns = _build_name_sql(conn, t)
        sc = "seasons" if cn(conn, "seasons", t) != "NULL" else ("season_name" if cn(conn, "season_name", t) != "NULL" else "NULL")
        rows = conn.execute(f'''SELECT {t}.rowid AS show_id, {ns} AS title, cover_art_url, {cn(conn, "type", t)} AS status, {cn(conn, "notes", t)} AS notes, {sc} AS seasons, {cn(conn, "genre", t)} AS genre, CAST(COALESCE({cn(conn, "total_episodes", t)},0) AS INTEGER) AS total_episodes, CAST(COALESCE({cn(conn, "current_episode", t)},0) AS INTEGER) AS current_episode, {cn(conn, "show_type", t)} AS show_type, {cn(conn, "release_year", t)} AS release_year, {cn(conn, "studio", t)} AS studio, COALESCE({cn(conn, "is_manual", t)}, 0) AS is_manual, COALESCE({cn(conn, "rating", t)}, 0.0) AS rating, {_get_tags_sql("shows", f"{t}.rowid")} FROM {t} WHERE {ns} IS NOT NULL AND TRIM({ns})!="" AND {ns}!="SHOW NAME" ORDER BY TRIM({ns}) COLLATE NOCASE ASC''').fetchall()
    except sqlite3.OperationalError: rows = []
    conn.close(); result = [dict(r) for r in rows]
    for d in result:
        if not d.get("status"): d["status"] = "Planning"
        if not d.get("seasons"): d["seasons"] = "—"
        if not d.get("genre"): d["genre"] = "—"
    return jsonify(result)

@app.route("/api/albums", methods=["GET"])
def get_all_albums():
    t = "Staging_Albums"
    conn = get_db()
    try: 
        ns = _build_name_sql(conn, t)
        rows = conn.execute(f'''SELECT {t}.rowid AS id, {ns} AS title, cover_art_url, {cn(conn, "type", t)} AS status, {cn(conn, "notes", t)} AS notes, CAST(COALESCE({cn(conn, "total_tracks", t)},0) AS INTEGER) AS total_tracks, {cn(conn, "artist", t)} AS artist, {cn(conn, "genre", t)} AS genre, {cn(conn, "record_label", t)} AS record_label, CAST(COALESCE({cn(conn, "runtime_mins", t)},0) AS INTEGER) AS runtime_mins, {cn(conn, "release_year", t)} AS release_year, COALESCE({cn(conn, "is_manual", t)}, 0) AS is_manual, COALESCE({cn(conn, "rating", t)}, 0.0) AS rating, {_get_tags_sql("albums", f"{t}.rowid")} FROM {t} WHERE {ns} IS NOT NULL AND TRIM({ns})!="" AND {ns}!="ALBUMS" ORDER BY TRIM({ns}) COLLATE NOCASE ASC''').fetchall()
    except sqlite3.OperationalError: rows = []
    conn.close(); result = []
    for r in rows:
        d = dict(r); d["status"] = d.get("status") or "Planning"; d["genre"] = d.get("genre") or "—"; tk = d.get("total_tracks", 0); d["runtime_display"] = f"{tk} tracks" if tk and int(tk) > 0 else "—"; result.append(d)
    return jsonify(result)

@app.route("/api/books", methods=["GET"])
def get_all_books():
    t = "Staging_Books"
    conn = get_db()
    try: 
        ns = _build_name_sql(conn, t)
        rows = conn.execute(f'''SELECT {t}.rowid, {ns} AS title, cover_art_url, {cn(conn, "type", t)} AS status, {cn(conn, "notes", t)} AS notes, CAST(COALESCE({cn(conn, "page_count", t)},0) AS INTEGER) AS page_count, {cn(conn, "genre", t)} AS genre, {cn(conn, "author", t)} AS author, {cn(conn, "release_year", t)} AS release_year, COALESCE({cn(conn, "is_manual", t)}, 0) AS is_manual, COALESCE({cn(conn, "rating", t)}, 0.0) AS rating, {_get_tags_sql("books", f"{t}.rowid")} FROM {t} WHERE {ns} IS NOT NULL AND TRIM({ns})!="" AND {ns} NOT IN ("BOOKS","MANGA TITLE","MANGA") ORDER BY TRIM({ns}) COLLATE NOCASE ASC''').fetchall()
    except sqlite3.OperationalError: rows = []
    
    result = []; needs_enrich = []
    for r in rows:
        d = dict(r); rowid = d.pop("rowid", None); d["id"] = rowid; d["status"] = d.get("status") or "Planning"; d["genre"] = d.get("genre") or "—"
        pg = d.get("page_count", 0); d["page_count"] = int(pg) if pg else 0; d["runtime_display"] = f"{pg} pgs" if pg and int(pg) > 0 else "—"
        if rowid and d.get("title") and not d.get("is_manual") and (not d.get("cover_art_url") or not pg or d["genre"] == "—"): needs_enrich.append((rowid, d["title"]))
        result.append(d)

    if needs_enrich:
        def _bg_enrich(pairs):
            bg = sqlite3.connect(DB_PATH); bg.row_factory = sqlite3.Row
            for rowid, title in pairs[:10]:
                try:
                    items = _gbooks(title)
                    if not items: continue
                    vol = items[0].get("volumeInfo", {}); updates = {}
                    cover = vol.get("imageLinks",{}).get("thumbnail","").replace("http:","https:")
                    if cover: updates["cover_art_url"] = cover
                    cats = vol.get("categories",[])
                    if cats: updates["genre"] = cats[0]; updates["genre_list"] = ", ".join(cats)
                    if vol.get("pageCount"): updates["page_count"] = vol["pageCount"]
                    if vol.get("authors"): updates["author"] = ", ".join(vol["authors"])
                    if vol.get("publisher"): updates["publisher"] = vol["publisher"]
                    if vol.get("publishedDate"): updates["release_year"] = vol["publishedDate"][:4]
                    _write_back(bg, "Staging_Books", rowid, updates)
                    time.sleep(0.2)
                except Exception: pass
            bg.close()
        threading.Thread(target=_bg_enrich, args=(needs_enrich,), daemon=True).start()

    conn.close()
    return jsonify(result)

@app.route("/api/movies/<int:movie_id>", methods=["GET"])
def get_movie(movie_id):
    conn = get_db()
    db = _row_or_404(conn, "Staging_Movies", movie_id)
    if not db: return jsonify({"error":"Movie not found"}), 404
    db = enrich_movie(conn, movie_id, db)
    tags = conn.execute("SELECT GROUP_CONCAT(t.name) as tags FROM ItemTags it JOIN Tags t ON it.tag_id=t.id WHERE category='movies' AND item_id=?", (movie_id,)).fetchone()
    stored_rt = db.get("runtime_mins") or db.get("runtime")
    out = { "title": _resolve_title(db, "Staging_Movies"), "status": db.get("type","Planning"), "notes": db.get("notes",""), "source": db.get("source","Select Source..."), "cover_art_url": db.get("cover_art_url",""), "release_year": db.get("release_year","—"), "runtime_mins": stored_rt or "—", "genre": db.get("genre","—"), "studio": db.get("studio","—"), "origin_country": db.get("origin_country","—"), "release_status": db.get("release_status","—"), "genre_list": db.get("genre_list","—"), "show_type": db.get("show_type","—"), "avg_runtime": f"{stored_rt} mins" if stored_rt and str(stored_rt) not in ("0","—","None") else "—", "is_manual": db.get("is_manual", 0), "rating": _to_float(db.get("rating", 0)), "custom_tags": tags["tags"] if tags else "" }
    conn.close(); return jsonify(out)

@app.route("/api/shows/<int:show_id>", methods=["GET"])
def get_show(show_id):
    conn = get_db()
    db = _row_or_404(conn, "Staging_Shows", show_id)
    if not db: return jsonify({"error":"Show not found"}), 404
    db = enrich_show(conn, show_id, db)
    tags = conn.execute("SELECT GROUP_CONCAT(t.name) as tags FROM ItemTags it JOIN Tags t ON it.tag_id=t.id WHERE category='shows' AND item_id=?", (show_id,)).fetchone()
    try: total_eps = int(db.get("total_episodes") or 0)
    except: total_eps = 0
    out = { "title": _resolve_title(db, "Staging_Shows"), "status": db.get("type","Planning"), "notes": db.get("notes",""), "source": db.get("source","Select Source..."), "cover_art_url": db.get("cover_art_url",""), "current_episode": int(db.get("current_episode") or 0), "total_episodes": total_eps, "release_year": db.get("release_year","—"), "seasons": db.get("seasons","—"), "genre": db.get("genre","—"), "genre_list": db.get("genre_list") or db.get("genre","—"), "studio": db.get("studio","—"), "origin_country": db.get("origin_country","—"), "release_status": db.get("release_status","—"), "show_type": db.get("show_type","—"), "avg_runtime": f"{db.get('avg_runtime')} mins" if db.get('avg_runtime') else "—", "is_manual": db.get("is_manual", 0), "rating": _to_float(db.get("rating", 0)), "custom_tags": tags["tags"] if tags else "" }
    conn.close(); return jsonify(out)

@app.route("/api/albums/<int:album_id>", methods=["GET"])
def get_album(album_id):
    conn = get_db()
    db = _row_or_404(conn, "Staging_Albums", album_id)
    if not db: return jsonify({"error":"Album not found"}), 404
    db = enrich_album(conn, album_id, db)
    tags = conn.execute("SELECT GROUP_CONCAT(t.name) as tags FROM ItemTags it JOIN Tags t ON it.tag_id=t.id WHERE category='albums' AND item_id=?", (album_id,)).fetchone()
    tk = db.get("total_tracks"); rm = db.get("runtime_mins"); rl = db.get("record_label")
    out = { "title": _resolve_title(db, "Staging_Albums"), "status": db.get("type","Planning"), "notes": db.get("notes",""), "source": db.get("source","Select Source..."), "cover_art_url": db.get("cover_art_url",""), "release_year": db.get("release_year","—"), "genre": db.get("genre","—"), "genre_list": db.get("genre_list") or db.get("genre","—"), "studio": db.get("artist","—"), "origin_country": rl if rl and str(rl) not in ("—","None","") else "—", "release_status": f"{tk} tracks" if tk and str(tk) not in ("0","None","") else "—", "show_type": "Album", "avg_runtime": f"{rm} mins" if rm and str(rm) not in ("0","None","") else "—", "is_manual": db.get("is_manual", 0), "rating": _to_float(db.get("rating", 0)), "custom_tags": tags["tags"] if tags else "" }
    conn.close(); return jsonify(out)

@app.route("/api/books/<int:book_id>", methods=["GET"])
def get_book(book_id):
    conn = get_db()
    db = _row_or_404(conn, "Staging_Books", book_id)
    if not db: return jsonify({"error":"Book not found"}), 404
    db = enrich_book(conn, book_id, db)
    tags = conn.execute("SELECT GROUP_CONCAT(t.name) as tags FROM ItemTags it JOIN Tags t ON it.tag_id=t.id WHERE category='books' AND item_id=?", (book_id,)).fetchone()
    db_pages = db.get("page_count")
    out = { "title": _resolve_title(db, "Staging_Books"), "status": db.get("type","Planning"), "notes": db.get("notes",""), "source": db.get("source","Select Source..."), "cover_art_url": db.get("cover_art_url",""), "release_year": db.get("release_year","—"), "genre": db.get("genre","—"), "current_episode": int(db.get("current_episode") or 0), "total_episodes": int(db.get("total_chapters") or 0), "studio": db.get("author","—"), "origin_country": db.get("publisher","—"), "release_status": "—", "show_type": "Book", "avg_runtime": f"{db_pages} pages" if db_pages and str(db_pages) not in ("0","None") else "—", "genre_list": db.get("genre_list") or db.get("genre","—"), "page_count": int(db_pages) if db_pages and str(db_pages) not in ("0","None") else 0, "is_manual": db.get("is_manual", 0), "rating": _to_float(db.get("rating", 0)), "custom_tags": tags["tags"] if tags else "" }
    conn.close(); return jsonify(out)

# ── 8. DASHBOARD & STATS ──────────────────────────────────────────────────

@app.route("/api/stats", methods=["GET"])
def get_stats():
    conn = get_db()
    
    stats_row = conn.execute("SELECT * FROM UserStats WHERE id = 1").fetchone()
    total_movie_time = _to_int(stats_row["total_movie_time"]) if stats_row else 0
    total_tv_time    = _to_int(stats_row["total_tv_time"]) if stats_row else 0
    total_music_time = _to_int(stats_row["total_music_time"]) if stats_row else 0
    total_pages_read = _to_int(stats_row["total_pages_read"]) if stats_row else 0

    status_counts = {"planning": 0, "in_progress": 0, "completed": 0, "dropped": 0}
    genre_ratings = {}
    category_breakdown = {"movies": 0, "shows": 0, "albums": 0, "books": 0}
    completed_counts   = {"movies": 0, "shows": 0, "albums": 0, "books": 0}
    era_counts = {"movies": Counter(), "shows": Counter(), "albums": Counter(), "books": Counter()}
    
    # 10 Buckets: 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0
    rating_dist = {
        "movies": [0]*10, 
        "shows": [0]*10, 
        "albums": [0]*10, 
        "books": [0]*10
    }
    
    genre_counts_by_cat = {"movies": Counter(), "shows": Counter(), "albums": Counter(), "books": Counter()}
    episodes_watched = 0
    show_types_counter = Counter()
    by_status_dict = {"movies": Counter(), "shows": Counter(), "albums": Counter(), "books": Counter()}

    creator_counts = {"movies": Counter(), "shows": Counter(), "albums": Counter(), "books": Counter()}
    creator_ratings = {"movies": {}, "shows": {}, "albums": {}, "books": {}}
    creator_fields = {"movies": "studio", "shows": "studio", "albums": "artist", "books": "author"}
    
    # --- NEW: RATINGS ACROSS TIME TRACKER ---
    era_ratings = {"movies": {}, "shows": {}, "albums": {}, "books": {}}

    for cat, table in TABLE_MAP.items():
        try:
            rows = conn.execute(f"SELECT * FROM {table}").fetchall()
            for row in rows:
                r = dict(row)
                t = (r.get("type") or "Planning").strip()
                t_lower = t.lower()
                rating = _to_float(r.get("rating"))
                g = r.get("genre")
                year = r.get("release_year")
                ep = _to_int(r.get("current_episode"))
                st = r.get("show_type")
                creator = r.get(creator_fields[cat])

                category_breakdown[cat] += 1
                by_status_dict[cat][t] += 1 

                if t_lower in ["planning"]: status_counts["planning"] += 1
                elif t_lower in ["watching", "reading", "listening", "in progress"]: status_counts["in_progress"] += 1
                elif t_lower in ["watched", "read", "listened", "completed"]: 
                    status_counts["completed"] += 1
                    completed_counts[cat] += 1
                elif t_lower in ["dropped"]: status_counts["dropped"] += 1
                else: status_counts["planning"] += 1

                if g and g != "—":
                    genre_counts_by_cat[cat][g] += 1
                    if rating > 0:
                        if g not in genre_ratings: genre_ratings[g] = {"sum": 0, "count": 0}
                        genre_ratings[g]["sum"] += rating
                        genre_ratings[g]["count"] += 1
                
                # Decade & Era Aggregation
                if year and str(year).strip().isdigit():
                    y = int(str(year).strip()[:4])
                    if 1800 <= y <= 2100:
                        decade = f"{(y // 10) * 10}s"
                        era_counts[cat][decade] += 1
                        
                        if rating > 0:
                            if decade not in era_ratings[cat]:
                                era_ratings[cat][decade] = {"sum": 0.0, "count": 0}
                            era_ratings[cat][decade]["sum"] += rating
                            era_ratings[cat][decade]["count"] += 1

                if 0.5 <= rating <= 5.0:
                    idx = int(rating * 2) - 1
                    if 0 <= idx <= 9:
                        rating_dist[cat][idx] += 1
                    
                if cat == "shows":
                    episodes_watched += ep
                    if st and st != "—": show_types_counter[st] += 1
                    
                if creator and creator != "—" and str(creator).strip() != "":
                    creator_counts[cat][creator] += 1
                    if rating > 0:
                        if creator not in creator_ratings[cat]:
                            creator_ratings[cat][creator] = {"sum": 0, "count": 0}
                        creator_ratings[cat][creator]["sum"] += rating
                        creator_ratings[cat][creator]["count"] += 1
                        
        except sqlite3.OperationalError: pass

    total_entries = sum(status_counts.values())
    started_entries = total_entries - status_counts["planning"]
    completion_rate = round(status_counts["completed"] / started_entries, 2) if started_entries > 0 else 0
    status_breakdown = {k: {"count": v, "percent": round((v / total_entries * 100), 1) if total_entries > 0 else 0} for k, v in status_counts.items()}
    avg_ratings = [{"genre": g, "avg_rating": round(d["sum"] / d["count"], 1), "count": d["count"]} for g, d in genre_ratings.items() if d["count"] >= 2]
    avg_ratings.sort(key=lambda x: (-x["avg_rating"], -x["count"]))

    def format_top_5(counter_obj):
        total = sum(counter_obj.values())
        return [{"name": name, "value": round((count / total) * 100)} for name, count in counter_obj.most_common(5)] if total > 0 else []

    def format_top_ratings(ratings_dict):
        avg_list = [{"name": c, "value": round(d["sum"] / d["count"], 1), "count": d["count"]} for c, d in ratings_dict.items() if d["count"] >= 1]
        avg_list.sort(key=lambda x: (-x["value"], -x["count"]))
        return [{"name": x["name"], "value": x["value"]} for x in avg_list[:5]]
        
    def format_era_ratings(era_ratings_dict):
        avg_list = []
        for dec, d in era_ratings_dict.items():
            if d["count"] >= 1:
                avg_list.append({"decade": dec, "rating": round(d["sum"] / d["count"], 1)})
        # Chronological sort (e.g., 1980s -> 1990s -> 2000s)
        avg_list.sort(key=lambda x: int(x["decade"][:-1]))
        return avg_list

    for cat in by_status_dict: by_status_dict[cat] = dict(by_status_dict[cat])
    all_genres = sum((genre_counts_by_cat[c] for c in genre_counts_by_cat), Counter())
    top_genres = [{"genre": g, "count": c} for g, c in all_genres.most_common(10)]

    tracking = {
        "movies": { "total": category_breakdown["movies"], "completed_count": completed_counts["movies"], "hours": round(total_movie_time / 60, 1) },
        "shows":  { "total": category_breakdown["shows"],  "completed_count": completed_counts["shows"],  "hours": round(total_tv_time / 60, 1) },
        "albums": { "total": category_breakdown["albums"], "completed_count": completed_counts["albums"], "hours": round(total_music_time / 60, 1) },
        "books":  { "total": category_breakdown["books"],  "completed_count": completed_counts["books"],  "pages": total_pages_read },
    }

    conn.close()
    return jsonify({
        "tracking": tracking, "totals": category_breakdown, "by_status": by_status_dict, "top_genres": top_genres, "top_show_types": [{"type": t, "count": c} for t, c in show_types_counter.most_common()], "completion_rate": completion_rate, "total_completed": status_counts["completed"], "total_started": started_entries, "status_breakdown": status_breakdown, "average_rating_by_genre": avg_ratings[:10],
        "activity": { "episodes_watched": episodes_watched, "movies_runtime_hrs": tracking["movies"]["hours"], "shows_runtime_hrs": tracking["shows"]["hours"], "albums_runtime_hrs": tracking["albums"]["hours"], "chapters_read": tracking["books"]["pages"] },
        "movie_hours_watched": tracking["movies"]["hours"], "tv_hours_watched": tracking["shows"]["hours"], "music_hours_listened": tracking["albums"]["hours"], "total_pages_read": tracking["books"]["pages"],
        "dashboard_genres": {cat: format_top_5(genre_counts_by_cat[cat]) for cat in category_breakdown},
        "dashboard_eras": {cat: format_top_5(era_counts[cat]) for cat in category_breakdown},
        "dashboard_ratings": rating_dist,
        "dashboard_creators": {cat: format_top_5(creator_counts[cat]) for cat in category_breakdown},
        "dashboard_creator_ratings": {cat: format_top_ratings(creator_ratings[cat]) for cat in category_breakdown},
        "dashboard_era_ratings": {cat: format_era_ratings(era_ratings[cat]) for cat in category_breakdown},
    })

from datetime import datetime, timedelta

@app.route("/api/activity-heatmap", methods=["GET"])
def get_activity_heatmap():
    conn = get_db()
    WEIGHTS = {"movies": 9, "albums": 6, "shows": 6, "books": 3}
    end_date = datetime.now()
    start_date = end_date - timedelta(days=365)
    activity_map = {}
    for i in range(366):
        day_str = (start_date + timedelta(days=i)).strftime("%Y-%m-%d")
        activity_map[day_str] = 0
    try:
        rows = conn.execute('''SELECT date(timestamp) as day, category, COUNT(*) as cnt FROM ActivityLog WHERE timestamp >= ? GROUP BY day, category''', (start_date.strftime("%Y-%m-%d"),)).fetchall()
        for r in rows:
            day = r["day"]; cat = r["category"]; cnt = r["cnt"]
            if day in activity_map: activity_map[day] += (cnt * WEIGHTS.get(cat, 1))
    except sqlite3.OperationalError: pass
    conn.close()
    result = [{"date": k, "count": v} for k, v in activity_map.items()]
    result.sort(key=lambda x: x["date"])
    return jsonify(result)

@app.route("/api/home", methods=["GET"])
def get_home_dashboard():
    conn = get_db()
    continue_watching = []
    for r in conn.execute("SELECT rowid, title, cover_art_url, current_episode, total_episodes FROM Staging_Shows WHERE type IN ('Watching', 'In Progress') LIMIT 4").fetchall(): 
        continue_watching.append({"id": r["rowid"], "category": "shows", "title": r["title"], "cover": r["cover_art_url"], "progress": f"Ep {r['current_episode'] or 0} / {r['total_episodes'] or '?'}"})
    for r in conn.execute("SELECT rowid, title, cover_art_url, current_episode, page_count FROM Staging_Books WHERE type IN ('Reading', 'Watching', 'In Progress') LIMIT 4").fetchall(): 
        continue_watching.append({"id": r["rowid"], "category": "books", "title": r["title"], "cover": r["cover_art_url"], "progress": f"Pg {r['current_episode'] or 0} / {r['page_count'] or '?'}"})
    for r in conn.execute("SELECT rowid, title, cover_art_url FROM Staging_Movies WHERE type IN ('Watching', 'In Progress') LIMIT 3").fetchall(): 
        continue_watching.append({"id": r["rowid"], "category": "movies", "title": r["title"], "cover": r["cover_art_url"], "progress": "In Progress"})
    for r in conn.execute("SELECT rowid, title, cover_art_url FROM Staging_Albums WHERE type IN ('Listening', 'Watching', 'In Progress') LIMIT 3").fetchall(): 
        continue_watching.append({"id": r["rowid"], "category": "albums", "title": r["title"], "cover": r["cover_art_url"], "progress": "Listening"})

    recently_added = []
    for cat, table in TABLE_MAP.items():
        table_cols = [c[1] for c in conn.execute(f"PRAGMA table_info({table})").fetchall()]
        if "created_at" in table_cols:
            for r in conn.execute(f"SELECT rowid, title, cover_art_url, created_at FROM {table} ORDER BY created_at DESC LIMIT 3").fetchall(): 
                recently_added.append({"id": r["rowid"], "category": cat, "title": r["title"], "cover": r["cover_art_url"], "created_at": r["created_at"]})
    recently_added.sort(key=lambda x: x["created_at"] or "", reverse=True)
    
    stats_row = conn.execute("SELECT * FROM UserStats WHERE id = 1").fetchone()
    stats_snapshot = {
        "movies_watched": conn.execute("SELECT COUNT(*) FROM Staging_Movies WHERE type IN ('Watched', 'Completed')").fetchone()[0],
        "episodes_watched": conn.execute("SELECT SUM(current_episode) FROM Staging_Shows").fetchone()[0] or 0,
        "albums_listened": conn.execute("SELECT COUNT(*) FROM Staging_Albums WHERE type IN ('Watched', 'Completed', 'Listened')").fetchone()[0],
        "pages_read": stats_row["total_pages_read"] if stats_row else 0,
        "total_movie_hours": round((stats_row["total_movie_time"] if stats_row else 0) / 60, 1),
        "total_tv_hours": round((stats_row["total_tv_time"] if stats_row else 0) / 60, 1),
        "total_music_hours": round((stats_row["total_music_time"] if stats_row else 0) / 60, 1)
    }

    activity_feed = [dict(r) for r in conn.execute("SELECT action_type, category, title, timestamp FROM ActivityLog ORDER BY timestamp DESC LIMIT 8").fetchall()]

    top_picks = []
    genres = []
    for table in TABLE_MAP.values():
        genres.extend([r["genre"] for r in conn.execute(f"SELECT genre FROM {table} WHERE genre IS NOT NULL AND genre != '—' AND TRIM(genre) != ''").fetchall()])
    top_genres = [g[0] for g in Counter(genres).most_common(2)]
    
    if top_genres:
        for cat, table in TABLE_MAP.items():
            for r in conn.execute(f"SELECT rowid, title, cover_art_url, genre FROM {table} WHERE type='Planning' AND genre IN (?, ?) LIMIT 2", (top_genres[0], top_genres[1] if len(top_genres) > 1 else top_genres[0])).fetchall(): 
                top_picks.append({"id": r["rowid"], "category": cat, "title": r["title"], "cover": r["cover_art_url"], "genre": r["genre"]})
                
    if not top_picks:
        for cat, table in TABLE_MAP.items():
            for r in conn.execute(f"SELECT rowid, title, cover_art_url, genre FROM {table} WHERE type='Planning' LIMIT 1").fetchall(): 
                top_picks.append({"id": r["rowid"], "category": cat, "title": r["title"], "cover": r["cover_art_url"], "genre": r["genre"]})

    conn.close()
    return jsonify({ "continue_watching": continue_watching, "recently_added": recently_added[:8], "stats_snapshot": stats_snapshot, "activity_feed": activity_feed, "top_picks": top_picks[:6] })

@app.route("/api/recently_added", methods=["GET"])
def recently_added():
    limit = min(_to_int(request.args.get("limit", 8)), 50)
    conn = get_db()
    rows = []
    for cat, table in TABLE_MAP.items():
        try:
            table_cols = [r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]
            ns = "NULL"
            for c in NAME_CANDIDATES.get(table, []):
                if c in table_cols:
                    ns = f'"{c}"'
                    break
            for r in conn.execute(f'''SELECT rowid AS id, {ns} AS title, cover_art_url, COALESCE(type, "Planning") AS status, created_at FROM {table} WHERE {ns} IS NOT NULL AND TRIM({ns}) != "" AND created_at IS NOT NULL ORDER BY created_at DESC LIMIT {limit}''').fetchall(): 
                rows.append({**dict(r), "category": cat})
        except sqlite3.OperationalError: pass
    conn.close()
    rows.sort(key=lambda x: x.get("created_at") or "", reverse=True)
    return jsonify(rows[:limit])

# ── 9. DATABASE SYNC & BOOT ───────────────────────────────────────────────

@app.route("/api/movies/<int:item_id>", methods=["DELETE"], defaults={"category": "movies"})
@app.route("/api/shows/<int:item_id>", methods=["DELETE"], defaults={"category": "shows"})
@app.route("/api/albums/<int:item_id>", methods=["DELETE"], defaults={"category": "albums"})
@app.route("/api/books/<int:item_id>", methods=["DELETE"], defaults={"category": "books"})
def delete_item(category, item_id):
    table = TABLE_MAP.get(category)
    if not table: return jsonify({"error":"Invalid category"}), 400
    conn = get_db()
    conn.execute(f"DELETE FROM {table} WHERE rowid=?", (item_id,))
    conn.execute("DELETE FROM ItemTags WHERE category=? AND item_id=?", (category, item_id))
    conn.execute("DELETE FROM ListItems WHERE category=? AND item_id=?", (category, item_id))
    conn.commit()
    conn.close()
    return jsonify({"success": True})

@app.route("/api/<category>/<int:item_id>/notes",   methods=["GET", "POST"])
def save_notes(category, item_id): return _simple_update(category, item_id, "notes", request.json.get("notes",""))

@app.route("/api/<category>/<int:item_id>/source",  methods=["GET", "POST"])
def update_source(category, item_id): return _simple_update(category, item_id, "source", request.json.get("source",""))

@app.route("/api/<category>/<int:item_id>/total_episodes", methods=["GET", "POST"])
def update_total_eps(category, item_id): return _simple_update(category, item_id, "total_episodes" if category != "books" else "total_chapters", _to_int(request.json.get("total_episodes", 0)))

@app.route("/api/<category>/<int:item_id>/runtime", methods=["GET", "POST"])
def update_runtime(category, item_id):
    val = _to_int(request.json.get("runtime", 0))
    if category == "books":
        conn = get_db(); conn.execute("UPDATE Staging_Books SET page_count = ? WHERE rowid = ?", (val, item_id)); conn.commit(); conn.close()
        return jsonify({"success": True})
    return _simple_update(category, item_id, "runtime_mins", val)

def clean_database_to_integers():
    conn = get_db()
    def extract_int(val):
        if not val: return 0
        nums = re.findall(r'\d+', str(val))
        return int(nums[0]) if nums else 0
    for s in conn.execute("SELECT rowid, avg_runtime, current_episode, total_episodes FROM Staging_Shows").fetchall(): 
        conn.execute("UPDATE Staging_Shows SET avg_runtime=?, current_episode=?, total_episodes=? WHERE rowid=?", (extract_int(s["avg_runtime"]), extract_int(s["current_episode"]), extract_int(s["total_episodes"]), s["rowid"]))
    for b in conn.execute("SELECT rowid, page_count, current_episode, total_episodes FROM Staging_Books").fetchall(): 
        conn.execute("UPDATE Staging_Books SET page_count=?, current_episode=?, total_episodes=? WHERE rowid=?", (extract_int(b["page_count"]), extract_int(b["current_episode"]), extract_int(b["total_episodes"]), b["rowid"]))
    for m in conn.execute("SELECT rowid, runtime_mins FROM Staging_Movies").fetchall(): 
        conn.execute("UPDATE Staging_Movies SET runtime_mins=? WHERE rowid=?", (extract_int(m["runtime_mins"]), m["rowid"]))
    for a in conn.execute("SELECT rowid, runtime_mins FROM Staging_Albums").fetchall(): 
        conn.execute("UPDATE Staging_Albums SET runtime_mins=? WHERE rowid=?", (extract_int(a["runtime_mins"]), a["rowid"]))
    conn.commit()
    conn.close()

def backfill_null_statuses():
    conn = get_db()
    conn.execute("UPDATE Staging_Movies SET type='Watched' WHERE type IS NULL")
    conn.execute("UPDATE Staging_Shows  SET type='Watched' WHERE type IS NULL")
    conn.execute("UPDATE Staging_Books  SET type='Read'    WHERE type IS NULL")
    conn.commit()
    conn.close()

def sync_historical_stats():
    conn = get_db()
    mv_row = conn.execute("SELECT SUM(CAST(COALESCE(runtime_mins,0) AS INTEGER)) FROM Staging_Movies WHERE type IN ('Watched','Completed')").fetchone()
    mv_time = mv_row[0] if mv_row and mv_row[0] else 0
    mu_row = conn.execute("SELECT SUM(CAST(COALESCE(runtime_mins,0) AS INTEGER)) FROM Staging_Albums WHERE type IN ('Watched','Listened','Completed')").fetchone()
    mu_time = mu_row[0] if mu_row and mu_row[0] else 0

    tv_time = 0
    for r in conn.execute("SELECT current_episode, total_episodes, avg_runtime, type FROM Staging_Shows").fetchall():
        ep = int(r["current_episode"] or 0)
        tot = int(r["total_episodes"] or 0)
        rt = int(r["avg_runtime"] or 0)
        if r["type"] in ("Watched", "Completed") and ep == 0 and tot > 0: ep = tot
        tv_time += ep * rt

    bk_pages = 0
    for r in conn.execute("SELECT current_episode, total_episodes, page_count, type FROM Staging_Books").fetchall():
        pg = int(r["page_count"] or 0)
        ep = int(r["current_episode"] or 0)
        tot = int(r["total_episodes"] or 1)
        if tot <= 0: tot = 1
        if r["type"] in ("Watched", "Completed", "Read"): bk_pages += pg
        else: bk_pages += int(ep * (pg / tot))

    conn.execute("UPDATE UserStats SET total_movie_time=?, total_tv_time=?, total_music_time=?, total_pages_read=? WHERE id=1", (mv_time, tv_time, mu_time, bk_pages))
    conn.commit()
    conn.close()

@app.route("/api/utils/fix-shows-v2", methods=["GET"])
def fix_all_shows_v2():
    conn = get_db()
    ns = _build_name_sql(conn, "Staging_Shows")
    try:
        shows = conn.execute(f"SELECT rowid, {ns} AS title FROM Staging_Shows WHERE is_manual=0 OR is_manual IS NULL").fetchall()
    except sqlite3.OperationalError:
        shows = []
    conn.close()
    
    def _run_fix():
        db_bg = sqlite3.connect(DB_PATH)
        for show in shows:
            rowid = show["rowid"]
            title = show["title"]
            if not title or title.strip() == "" or title == "SHOW NAME": continue
                
            try:
                search = _tmdb(f"/search/tv?query={urllib.parse.quote(title)}&language=en-US&page=1")
                results = search.get("results", [])
                if not results: continue
                
                exact_matches = [r for r in results if r.get("name","").lower() == title.lower()]
                best_match = exact_matches[0] if exact_matches else results[0]
                
                d = _tmdb(f"/tv/{best_match['id']}")
                
                sn = d.get("number_of_seasons", 0)
                en_field = d.get("number_of_episodes", 0)
                en_sum = sum(sec.get("episode_count", 0) for sec in d.get("seasons", []) if sec.get("season_number", 0) > 0)
                
                en = max(en_field, en_sum)
                
                seasons_str = f"{sn} Season{'s' if sn!=1 else ''} ({en} eps)" if sn > 0 else "—"
                db_bg.execute("UPDATE Staging_Shows SET total_episodes=?, seasons=? WHERE rowid=?", (en, seasons_str, rowid))
                db_bg.commit()
                time.sleep(0.15) 
            except Exception: pass
                
        db_bg.close()
        sync_historical_stats()

    threading.Thread(target=_run_fix, daemon=True).start()
    return jsonify({
        "success": True, 
        "message": f"Started fixing {len(shows)} shows in the background using exact title matching and failsafe math. Please wait ~45 seconds, then refresh your web app!"
    })

# Boot Sequence
ensure_schema()          # 1. Builds the empty tables for new users
sync_historical_stats()  # 2. Sets up the 0 hours / 0 pages stats

if __name__ == "__main__":
    print("API ready → http://localhost:5000")
    app.run(debug=True, port=5000)
