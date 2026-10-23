// Petal's file helper. One request per run: a JSON object on stdin, JSON lines on stdout.
// Things Node can't do quickly or at all on Windows:
//   index      ask the Windows Search index (no admin, answers in well under a second)
//   walk       fast folder walk with FindFirstFileEx (sizes come with the listing, no stat per file)
//   du         total size of folders
//   probe      size on disk, OneDrive online-only placeholders, files another app has open
//   restore    put Recycle Bin items back where they came from (Petal's Undo)
//   foreground the window you were in, and the folder if it's File Explorer
//   bin        each drive's Recycle Bin: capacity, what's in it, and whether it's switched off
// Every line is one JSON object; the last is {"done":true,...} or {"error":"..."}.
// Build: csc /nologo /optimize /r:System.Web.Extensions.dll /out:fs.exe fs.cs
using System;
using System.Collections;
using System.Collections.Generic;
using System.Data.OleDb;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using System.Web.Script.Serialization;

static class PetalFs {
  static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
  static readonly object OutLock = new object();
  static void Out(object o) { lock (OutLock) { Console.Out.WriteLine(Json.Serialize(o)); Console.Out.Flush(); } }
  static long Epoch(DateTime t) { return (long)(t.ToUniversalTime() - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds; }

  // ---------- Win32 ----------
  // Pack 4: WIN32_FIND_DATA's FILETIMEs are pairs of DWORDs, not 8-byte aligned longs.
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode, Pack = 4)]
  struct FIND_DATA {
    public uint attrs; public long created, accessed, written; public uint sizeHigh, sizeLow, r0, r1;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string name;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 14)] public string alt;
  }
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern IntPtr FindFirstFileExW(string path, int infoLevel, out FIND_DATA data, int searchOp, IntPtr filter, int flags);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool FindNextFileW(IntPtr h, out FIND_DATA data);
  [DllImport("kernel32.dll")] static extern bool FindClose(IntPtr h);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern uint GetCompressedFileSizeW(string path, out uint high);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern uint GetFileAttributesW(string path);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageNameW(IntPtr h, int flags, StringBuilder s, ref int n);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);

  const uint ATTR_DIRECTORY = 0x10, ATTR_REPARSE = 0x400, ATTR_OFFLINE = 0x1000, ATTR_RECALL_ON_OPEN = 0x40000, ATTR_RECALL_ON_DATA = 0x400000;
  const uint INVALID_ATTRS = 0xFFFFFFFF;
  static bool IsCloudOnly(uint a) { return a != INVALID_ATTRS && (a & (ATTR_OFFLINE | ATTR_RECALL_ON_OPEN | ATTR_RECALL_ON_DATA)) != 0; }

  // ---------- request helpers ----------
  static Dictionary<string, object> req;
  static string Str(string k, string d = null) { object v; return req.TryGetValue(k, out v) && v != null ? v.ToString() : d; }
  static long Num(string k, long d = 0) { object v; return req.TryGetValue(k, out v) && v != null ? Convert.ToInt64(v) : d; }
  static List<string> List(string k) {
    object v; var r = new List<string>();
    if (req.TryGetValue(k, out v) && v is IEnumerable && !(v is string)) foreach (var x in (IEnumerable)v) r.Add(x.ToString());
    return r;
  }

  static int Main() {
    try {
      req = Json.Deserialize<Dictionary<string, object>>(Console.In.ReadToEnd());
      var sw = Stopwatch.StartNew();
      switch (Str("op")) {
        case "index": Index(); break;
        case "walk": Walk(); break;
        case "du": Du(); break;
        case "probe": Probe(); break;
        case "restore": Restore(); break;
        case "purge": Restore(true); break;
        case "foreground": Foreground(); break;
        case "bin": Bin(); break;
        default: Out(new { error = "unknown op " + Str("op") }); return 1;
      }
      Out(new { done = true, ms = sw.ElapsedMilliseconds });
      return 0;
    } catch (Exception e) {
      Out(new { error = e.Message });
      return 1;
    }
  }

  // ---------- index: Windows Search ----------
  // {op, scopes:[dir], minSize, exts:[".png"], before:epochMs, after:epochMs, name, top}
  static string Q(string s) { return s.Replace("'", "''"); }
  static void Index() {
    var where = new List<string>();
    var scopes = List("scopes");
    if (scopes.Count > 0) where.Add("(" + string.Join(" OR ", scopes.Select(s => "SCOPE='file:" + Q(s.Replace('\\', '/')) + "'")) + ")");
    where.Add("System.ItemType <> 'Directory'");
    long min = Num("minSize", 0); if (min > 0) where.Add("System.Size >= " + min);
    var exts = List("exts"); if (exts.Count > 0) where.Add("System.FileExtension IN (" + string.Join(",", exts.Select(e => "'" + Q(e) + "'")) + ")");
    long before = Num("before", 0); if (before > 0) where.Add("System.DateModified < '" + FromEpoch(before) + "'");
    long after = Num("after", 0); if (after > 0) where.Add("System.DateModified >= '" + FromEpoch(after) + "'");
    string name = Str("name"); if (!string.IsNullOrEmpty(name)) where.Add("System.FileName LIKE '%" + Q(name).Replace("%", "[%]") + "%'");
    long top = Num("top", 500);
    string sql = "SELECT TOP " + top + " System.ItemPathDisplay, System.Size, System.DateModified, System.DateCreated FROM SystemIndex WHERE "
      + string.Join(" AND ", where) + " ORDER BY " + (Str("sort") == "date" ? "System.DateModified DESC" : "System.Size DESC");
    using (var conn = new OleDbConnection("Provider=Search.CollatorDSO;Extended Properties='Application=Windows';")) {
      conn.Open();
      using (var cmd = new OleDbCommand(sql, conn))
      using (var r = cmd.ExecuteReader()) {
        while (r.Read()) {
          if (r.IsDBNull(0)) continue;
          long size = r.IsDBNull(1) ? 0 : Convert.ToInt64(r.GetValue(1));
          var mtime = r.IsDBNull(2) ? DateTime.MinValue : Convert.ToDateTime(r.GetValue(2));
          Out(new { path = r.GetString(0), size = size, mtime = Epoch(mtime), src = "index" });
        }
      }
    }
  }
  static string FromEpoch(long ms) { return new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc).AddMilliseconds(ms).ToString("yyyy-MM-dd HH:mm:ss"); }

  // ---------- walk ----------
  // {op, roots:[dir], minSize, exts:[".png"], before, after, name, skip:[dirName or full path, lower case],
  //  stopAt:[dir names reported as {dir:true} instead of entered, e.g. node_modules], maxMs, max}
  static HashSet<string> skipNames, skipPaths, stopNames;
  static void Walk() {
    var sw = Stopwatch.StartNew();
    long maxMs = Num("maxMs", 30000), max = Num("max", 200000), min = Num("minSize", 0), before = Num("before", 0), after = Num("after", 0);
    var exts = new HashSet<string>(List("exts").Select(e => e.ToLowerInvariant()));
    string name = (Str("name") ?? "").ToLowerInvariant();
    LoadSkips();
    long sent = 0, files = 0;
    var stack = new Stack<string>(List("roots").Where(Directory.Exists).Reverse());
    while (stack.Count > 0) {
      if (sw.ElapsedMilliseconds > maxMs || sent >= max) { Out(new { partial = true, reason = sent >= max ? "max" : "time" }); break; }
      string dir = stack.Pop();
      FIND_DATA d;
      IntPtr h = FindFirstFileExW(Path.Combine(dir, "*"), 1 /*Basic*/, out d, 0, IntPtr.Zero, 2 /*LARGE_FETCH*/);
      if (h == new IntPtr(-1)) continue;
      try {
        do {
          if (d.name == "." || d.name == "..") continue;
          string full = Path.Combine(dir, d.name);
          if ((d.attrs & ATTR_DIRECTORY) != 0) {
            if ((d.attrs & ATTR_REPARSE) != 0) continue;            // junctions and links: never follow (loops, other drives)
            string lower = d.name.ToLowerInvariant();
            if (skipNames.Contains(lower) || skipPaths.Contains(full.ToLowerInvariant())) continue;
            if (stopNames.Contains(lower)) { Out(new { path = full, dir = true, mtime = Epoch(DateTime.FromFileTimeUtc(d.written)) }); sent++; continue; }
            stack.Push(full);
            continue;
          }
          files++;
          long size = ((long)d.sizeHigh << 32) | d.sizeLow;
          if (size < min) continue;
          long mtime = Epoch(DateTime.FromFileTimeUtc(d.written));
          if (before > 0 && mtime >= before) continue;
          if (after > 0 && mtime < after) continue;
          if (exts.Count > 0 && !exts.Contains(Path.GetExtension(d.name).ToLowerInvariant())) continue;
          if (name.Length > 0 && d.name.ToLowerInvariant().IndexOf(name) < 0) continue;
          Out(new { path = full, size = size, mtime = mtime, cloud = IsCloudOnly(d.attrs), src = "walk" });
          sent++;
        } while (FindNextFileW(h, out d));
      } finally { FindClose(h); }
    }
    Out(new { scanned = files });
  }
  static void LoadSkips() {
    skipNames = new HashSet<string>(); skipPaths = new HashSet<string>();
    foreach (var s in List("skip")) { if (s.Contains("\\") || s.Contains(":")) skipPaths.Add(s.TrimEnd('\\').ToLowerInvariant()); else skipNames.Add(s.ToLowerInvariant()); }
    stopNames = new HashSet<string>(List("stopAt").Select(s => s.ToLowerInvariant()));
  }

  // ---------- du: folder totals ----------
  // {op, paths:[dir], olderThan: epochMs (only count/return files older than this), maxMs}
  static void Du() {
    var sw = Stopwatch.StartNew();
    long maxMs = Num("maxMs", 20000);
    foreach (var root in List("paths")) {
      long bytes = 0, count = 0, newest = 0; bool partial = false;
      if (File.Exists(root)) {
        var fi = new FileInfo(root);
        Out(new { path = root, bytes = fi.Length, files = 1, newest = Epoch(fi.LastWriteTimeUtc) });
        continue;
      }
      var stack = new Stack<string>(); stack.Push(root);
      while (stack.Count > 0) {
        if (sw.ElapsedMilliseconds > maxMs) { partial = true; break; }
        string dir = stack.Pop();
        FIND_DATA d;
        IntPtr h = FindFirstFileExW(Path.Combine(dir, "*"), 1, out d, 0, IntPtr.Zero, 2);
        if (h == new IntPtr(-1)) continue;
        try {
          do {
            if (d.name == "." || d.name == "..") continue;
            if ((d.attrs & ATTR_DIRECTORY) != 0) { if ((d.attrs & ATTR_REPARSE) == 0) stack.Push(Path.Combine(dir, d.name)); continue; }
            long m = Epoch(DateTime.FromFileTimeUtc(d.written));
            if (m > newest) newest = m;
            if (IsCloudOnly(d.attrs)) continue;
            bytes += ((long)d.sizeHigh << 32) | d.sizeLow; count++;
          } while (FindNextFileW(h, out d));
        } finally { FindClose(h); }
      }
      Out(new { path = root, bytes = bytes, files = count, newest = newest, partial = partial });
    }
  }

  // ---------- probe ----------
  // {op, paths:[file], inUse:true}: size on disk, online-only, and whether another app has it open.
  static void Probe() {
    bool checkUse = req.ContainsKey("inUse") && Convert.ToBoolean(req["inUse"]);
    foreach (var p in List("paths")) {
      uint a = GetFileAttributesW(p);
      if (a == INVALID_ATTRS) { Out(new { path = p, missing = true }); continue; }
      bool cloud = IsCloudOnly(a);
      uint high; uint low = GetCompressedFileSizeW(p, out high);
      long onDisk = (low == 0xFFFFFFFF && Marshal.GetLastWin32Error() != 0) ? -1 : ((long)high << 32) | low;
      if (cloud) onDisk = 0;
      string use = null;
      // Opening an online-only file would download it, so those are never opened.
      if (checkUse && !cloud && (a & ATTR_DIRECTORY) == 0) {
        try { using (new FileStream(p, FileMode.Open, FileAccess.Read, FileShare.None)) { } }
        catch (IOException e) { if ((e.HResult & 0xFFFF) == 32 || (e.HResult & 0xFFFF) == 33) use = "open"; }
        catch (UnauthorizedAccessException) { use = "denied"; }
      }
      Out(new { path = p, onDisk = onDisk, cloud = cloud, inUse = use });
    }
  }

  // ---------- restore: Petal's Undo ----------
  // The Recycle Bin keeps each item as $R<id> next to $I<id>, whose header holds the original path.
  // {op, paths:[original path]}: move the newest matching $R back and drop its $I.
  // purge: {op, paths, since:epochMs} deletes those same items from the bin for good instead, and
  // only ones that went in at or after `since` (Petal's own batch, never an older namesake).
  static void Restore(bool purge = false) {
    long since = Num("since", 0);
    string sid = WindowsIdentity.GetCurrent().User.Value;
    var wanted = new HashSet<string>(List("paths").Select(p => p.ToLowerInvariant()));
    var drives = new HashSet<string>(List("paths").Select(p => Path.GetPathRoot(p)));
    var found = new Dictionary<string, Tuple<string, string, long>>();   // original -> ($I, $R, deletedAt)
    foreach (var drive in drives) {
      string bin = Path.Combine(drive, "$Recycle.Bin", sid);
      if (!Directory.Exists(bin)) continue;
      foreach (var info in Directory.GetFiles(bin, "$I*")) {
        string original; long deleted;
        if (!ReadInfo(info, out original, out deleted)) continue;
        if (!wanted.Contains(original.ToLowerInvariant())) continue;
        if (purge && Epoch(DateTime.FromFileTimeUtc(deleted)) < since) continue;
        string data = Path.Combine(bin, "$R" + Path.GetFileName(info).Substring(2));
        if (!File.Exists(data) && !Directory.Exists(data)) continue;
        Tuple<string, string, long> prev;
        if (!found.TryGetValue(original.ToLowerInvariant(), out prev) || prev.Item3 < deleted) found[original.ToLowerInvariant()] = Tuple.Create(info, data, deleted);
      }
    }
    foreach (var p in List("paths")) {
      Tuple<string, string, long> t;
      if (!found.TryGetValue(p.ToLowerInvariant(), out t)) { Out(new { path = p, ok = false, err = "not in Recycle Bin" }); continue; }
      try {
        if (purge) {
          if (Directory.Exists(t.Item2)) Directory.Delete(t.Item2, true); else File.Delete(t.Item2);
          File.Delete(t.Item1);
          Out(new { path = p, ok = true });
          continue;
        }
        if (File.Exists(p) || Directory.Exists(p)) { Out(new { path = p, ok = false, err = "a file with that name is back already" }); continue; }
        Directory.CreateDirectory(Path.GetDirectoryName(p));
        if (Directory.Exists(t.Item2)) Directory.Move(t.Item2, p); else File.Move(t.Item2, p);
        File.Delete(t.Item1);
        Out(new { path = p, ok = true });
      } catch (Exception e) { Out(new { path = p, ok = false, err = e.Message }); }
    }
  }
  // $I layout: int64 version, int64 size, FILETIME deleted, then v1: 520-byte path / v2: int32 length + UTF-16 path.
  static bool ReadInfo(string file, out string original, out long deleted) {
    original = null; deleted = 0;
    try {
      var b = File.ReadAllBytes(file);
      if (b.Length < 24) return false;
      long version = BitConverter.ToInt64(b, 0);
      deleted = BitConverter.ToInt64(b, 16);
      if (version == 2 && b.Length >= 28) {
        int len = BitConverter.ToInt32(b, 24);
        original = Encoding.Unicode.GetString(b, 28, Math.Min(len * 2, b.Length - 28)).TrimEnd('\0');
      } else {
        original = Encoding.Unicode.GetString(b, 24, Math.Min(520, b.Length - 24)).TrimEnd('\0');
      }
      return original.Length > 0;
    } catch { return false; }
  }

  // ---------- bin: will Windows really recycle it? ----------
  // Something bigger than a drive's Recycle Bin, or anything on a drive with the bin switched off,
  // is deleted for good instead. Petal checks this first and refuses those items.
  [StructLayout(LayoutKind.Sequential, Pack = 4)] struct SHQUERYRBINFO { public int cbSize; public long size; public long items; }
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)] static extern int SHQueryRecycleBinW(string root, ref SHQUERYRBINFO info);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool GetVolumeNameForVolumeMountPointW(string mount, StringBuilder name, int len);
  static void Bin() {
    foreach (var d in List("drives")) {
      string root = Path.GetPathRoot(d);
      var info = new SHQUERYRBINFO { cbSize = Marshal.SizeOf(typeof(SHQUERYRBINFO)) };
      SHQueryRecycleBinW(root, ref info);
      long total = 0; try { total = new DriveInfo(root).TotalSize; } catch { }
      long capacity = total / 20; bool nuke = false, known = false;   // Windows' default is about 5% of the drive
      var vol = new StringBuilder(64);
      if (GetVolumeNameForVolumeMountPointW(root, vol, 64)) {
        string guid = vol.ToString(); int a = guid.IndexOf('{'), b = guid.IndexOf('}');
        if (a >= 0 && b > a) {
          using (var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Explorer\BitBucket\Volume\" + guid.Substring(a, b - a + 1))) {
            if (key != null) {
              object cap = key.GetValue("MaxCapacity"); if (cap != null) { capacity = Convert.ToInt64(cap) * 1024L * 1024L; known = true; }
              object n = key.GetValue("NukeOnDelete"); if (n != null) nuke = Convert.ToInt32(n) != 0;
            }
          }
        }
      }
      Out(new { drive = root, capacity = capacity, used = info.size, items = info.items, nuke = nuke, known = known, total = total });
    }
  }

  // ---------- foreground ----------
  static void Foreground() {
    IntPtr hwnd = GetForegroundWindow();
    uint pid; GetWindowThreadProcessId(hwnd, out pid);
    var title = new StringBuilder(512); GetWindowTextW(hwnd, title, 512);
    var cls = new StringBuilder(256); GetClassNameW(hwnd, cls, 256);
    string exe = null;
    IntPtr ph = OpenProcess(0x1000 /*QUERY_LIMITED_INFORMATION*/, false, pid);
    if (ph != IntPtr.Zero) { var sb = new StringBuilder(1024); int n = 1024; if (QueryFullProcessImageNameW(ph, 0, sb, ref n)) exe = sb.ToString(); CloseHandle(ph); }
    string folder = cls.ToString() == "CabinetWClass" ? ExplorerFolder(hwnd, title.ToString()) : null;
    Out(new { hwnd = hwnd.ToInt64(), pid = pid, exe = exe, title = title.ToString(), cls = cls.ToString(), folder = folder });
  }
  // File Explorer windows (and their tabs) come from Shell.Application.Windows(). Several tabs share
  // one window handle; the active tab is the one whose name is the window title.
  static string ExplorerFolder(IntPtr hwnd, string title) {
    try {
      var shellType = Type.GetTypeFromProgID("Shell.Application");
      object shell = Activator.CreateInstance(shellType);
      object windows = shellType.InvokeMember("Windows", System.Reflection.BindingFlags.InvokeMethod, null, shell, null);
      string first = null;
      foreach (object w in (IEnumerable)windows) {
        try {
          var t = w.GetType();
          long h = Convert.ToInt64(t.InvokeMember("HWND", System.Reflection.BindingFlags.GetProperty, null, w, null));
          if (h != hwnd.ToInt64()) continue;
          object doc = t.InvokeMember("Document", System.Reflection.BindingFlags.GetProperty, null, w, null);
          object folder = doc.GetType().InvokeMember("Folder", System.Reflection.BindingFlags.GetProperty, null, doc, null);
          object self = folder.GetType().InvokeMember("Self", System.Reflection.BindingFlags.GetProperty, null, folder, null);
          string path = (string)self.GetType().InvokeMember("Path", System.Reflection.BindingFlags.GetProperty, null, self, null);
          string name = (string)t.InvokeMember("LocationName", System.Reflection.BindingFlags.GetProperty, null, w, null);
          if (first == null) first = path;
          if (!string.IsNullOrEmpty(name) && title.StartsWith(name)) return path;
        } catch { }
      }
      return first;
    } catch { return null; }
  }
}
