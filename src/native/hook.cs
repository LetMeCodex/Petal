// Global low-level mouse + keyboard hook, plus a fullscreen watcher. Prints one event per line on stdout:
//   down X Y | move X Y | up | key VK NAME | keyup VK (Ctrl/Shift/Alt only) | fs 0 | fs 1 LEFT TOP RIGHT BOTTOM
//   stats cpu=% gpu=% ram=% ramUsed=GB ramTotal=GB rx=B/s tx=B/s bat=% ac=0|1   (once a second, only while enabled)
// Commands on stdin: "focus HWND" brings that window forward (Petal Ask), "stats 0" off, "stats 1" light (CPU/RAM/battery), "stats 2" full (adds GPU + network). When stdin closes (Petal quit), the helper exits too.
// Moves are only reported while the left button is held, which is all Petal needs.
// "fs" lines report, on change only, whether the foreground window covers its whole monitor
// (a game, a video, an F11 browser) and which monitor that is, in physical pixels.
// Usage: hook.exe [ownerPid]   (windows belonging to ownerPid never count as fullscreen)
// Build: csc /nologo /target:exe /out:hook.exe hook.cs  (csc ships with Windows' .NET Framework)
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Collections.Generic;
using System.Linq;

static class Hook {
  delegate IntPtr Proc(int code, IntPtr wParam, IntPtr lParam);

  [DllImport("user32.dll", SetLastError = true)] static extern IntPtr SetWindowsHookEx(int id, Proc fn, IntPtr mod, uint thread);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] static extern int GetMessage(out MSG msg, IntPtr hwnd, uint min, uint max);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetKeyNameText(int lParam, StringBuilder buf, int size);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr GetModuleHandle(string name);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool GetMonitorInfo(IntPtr mon, ref MONITORINFO mi);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder buf, int size);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
  [DllImport("kernel32.dll")] static extern bool GlobalMemoryStatusEx(ref MEMSTATUS m);
  [DllImport("kernel32.dll")] static extern bool GetSystemPowerStatus(out POWER p);

  [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam, lParam; public uint time; public int x, y; }
  [StructLayout(LayoutKind.Sequential)] struct KBD { public uint vk, scan, flags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct MOUSE { public int x, y; public uint data, flags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct RECT { public int l, t, r, b; }
  [StructLayout(LayoutKind.Sequential)] struct MONITORINFO { public int cbSize; public RECT rcMonitor, rcWork; public uint dwFlags; }
  [StructLayout(LayoutKind.Sequential)] struct MEMSTATUS { public uint len, load; public ulong totalPhys, availPhys, totalFile, availFile, totalVirt, availVirt, availExt; }
  [StructLayout(LayoutKind.Sequential)] struct POWER { public byte ac, flag, percent, saver; public int life, full; }

  // Held in statics so the GC never collects them while Windows still calls into them.
  static readonly Proc keyProc = OnKey, mouseProc = OnMouse;
  static bool leftDown;
  static uint ownerPid;
  static bool debug;
  static string lastFs = "";
  static Timer fsTimer, statsTimer;
  static readonly object outLock = new object();

  // The hook thread and the fullscreen timer both write; keep lines whole.
  static void Emit(string line) { lock (outLock) { Console.Out.WriteLine(line); Console.Out.Flush(); } }

  // Left/right modifier variants collapse to the generic key, so "Shift" means either Shift.
  static uint Normalize(uint vk) {
    if (vk == 0xA0 || vk == 0xA1) return 0x10;
    if (vk == 0xA2 || vk == 0xA3) return 0x11;
    if (vk == 0xA4 || vk == 0xA5) return 0x12;
    return vk;
  }

  static IntPtr OnKey(int code, IntPtr wParam, IntPtr lParam) {
    int msg = (int)wParam;
    if (code >= 0 && (msg == 0x100 || msg == 0x104)) { // WM_KEYDOWN, WM_SYSKEYDOWN
      var k = (KBD)Marshal.PtrToStructure(lParam, typeof(KBD));
      var name = new StringBuilder(64);
      GetKeyNameText((int)((k.scan << 16) | ((k.flags & 1) << 24)), name, name.Capacity);
      Emit("key " + Normalize(k.vk) + " " + name.ToString().Replace(' ', '_'));
    } else if (code >= 0 && (msg == 0x101 || msg == 0x105)) { // WM_KEYUP, WM_SYSKEYUP: modifiers only (double-tap Ctrl)
      var k = (KBD)Marshal.PtrToStructure(lParam, typeof(KBD));
      uint vk = Normalize(k.vk);
      if (vk == 0x10 || vk == 0x11 || vk == 0x12) Emit("keyup " + vk);
    }
    return CallNextHookEx(IntPtr.Zero, code, wParam, lParam);
  }

  static IntPtr OnMouse(int code, IntPtr wParam, IntPtr lParam) {
    if (code >= 0) {
      int msg = (int)wParam;
      var m = (MOUSE)Marshal.PtrToStructure(lParam, typeof(MOUSE));
      if (msg == 0x201) { leftDown = true; Emit("down " + m.x + " " + m.y); }        // WM_LBUTTONDOWN
      else if (msg == 0x202) { leftDown = false; Emit("up"); }                       // WM_LBUTTONUP
      else if (msg == 0x200 && leftDown) Emit("move " + m.x + " " + m.y);            // WM_MOUSEMOVE
    }
    return CallNextHookEx(IntPtr.Zero, code, wParam, lParam);
  }

  // Fullscreen = the foreground window covers every pixel of its monitor. The desktop, the taskbar
  // and Petal's own windows never count.
  static void CheckFullscreen(object _) {
    string line = "fs 0";
    try {
      IntPtr h = GetForegroundWindow();
      if (h != IntPtr.Zero) {
        var cls = new StringBuilder(64);
        GetClassName(h, cls, cls.Capacity);
        string c = cls.ToString();
        uint pid;
        GetWindowThreadProcessId(h, out pid);
        RECT r;
        var mi = new MONITORINFO();
        mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
        if (debug) {
          RECT dr; GetWindowRect(h, out dr);
          var dm = new MONITORINFO(); dm.cbSize = mi.cbSize;
          bool ok = GetMonitorInfo(MonitorFromWindow(h, 2), ref dm);
          Emit("dbg " + c + " pid=" + pid + " win=" + dr.l + "," + dr.t + "," + dr.r + "," + dr.b + " mon(" + ok + ")=" + dm.rcMonitor.l + "," + dm.rcMonitor.t + "," + dm.rcMonitor.r + "," + dm.rcMonitor.b);
        }
        if (c != "Progman" && c != "WorkerW" && c != "Shell_TrayWnd" && c != "Shell_SecondaryTrayWnd" && pid != ownerPid
            && GetWindowRect(h, out r) && GetMonitorInfo(MonitorFromWindow(h, 2 /* nearest */), ref mi)
            && r.l <= mi.rcMonitor.l && r.t <= mi.rcMonitor.t && r.r >= mi.rcMonitor.r && r.b >= mi.rcMonitor.b) {
          line = "fs 1 " + mi.rcMonitor.l + " " + mi.rcMonitor.t + " " + mi.rcMonitor.r + " " + mi.rcMonitor.b;
        }
      }
    } catch { /* a window vanishing mid-check is fine; try again next tick */ }
    if (line != lastFs) { lastFs = line; Emit(line); }
  }

  // ---------- system stats (only sampled while someone is looking at them) ----------
  // Two levels, so the always-on idle pulse stays nearly free:
  //   1 (pulse): CPU from GetSystemTimes, RAM, battery. Plain kernel calls, microseconds.
  //   2 (glance): adds GPU and network through one PDH query with wildcard counters. (One .NET
  //      PerformanceCounter per GPU engine cost over a whole core; PDH reads them all in one call.)
  [DllImport("kernel32.dll")] static extern bool GetSystemTimes(out long idle, out long kernel, out long user);
  [DllImport("pdh.dll", CharSet = CharSet.Unicode)] static extern uint PdhOpenQuery(string src, IntPtr user, out IntPtr query);
  [DllImport("pdh.dll", CharSet = CharSet.Unicode)] static extern uint PdhAddEnglishCounter(IntPtr query, string path, IntPtr user, out IntPtr counter);
  [DllImport("pdh.dll")] static extern uint PdhCollectQueryData(IntPtr query);
  [DllImport("pdh.dll", CharSet = CharSet.Unicode)] static extern uint PdhGetFormattedCounterArray(IntPtr counter, uint fmt, ref uint size, out uint count, IntPtr buf);
  [StructLayout(LayoutKind.Sequential)] struct PdhItem { public IntPtr name; public uint status; public uint pad; public double value; }
  const uint PDH_FMT_DOUBLE = 0x200, PDH_FMT_NOCAP100 = 0x8000, PDH_MORE_DATA = 0x800007D2;

  static volatile int statsLevel;
  static long lastIdle, lastBusy;
  static IntPtr pdh, cGpu, cRx, cTx;
  static bool pdhPrimed;

  static float SampleCpu() {
    long idle, kernel, user;
    if (!GetSystemTimes(out idle, out kernel, out user)) return -1;
    long busy = kernel + user - idle;                     // kernel time includes idle time
    long dIdle = idle - lastIdle, dBusy = busy - lastBusy;
    bool first = lastIdle == 0;
    lastIdle = idle; lastBusy = busy;
    if (first || dIdle + dBusy <= 0) return -1;
    return (float)(100.0 * dBusy / (dIdle + dBusy));
  }

  static void InitPdh() {
    if (pdh != IntPtr.Zero) return;
    if (PdhOpenQuery(null, IntPtr.Zero, out pdh) != 0) { pdh = IntPtr.Zero; return; }
    if (PdhAddEnglishCounter(pdh, @"\GPU Engine(*)\Utilization Percentage", IntPtr.Zero, out cGpu) != 0) cGpu = IntPtr.Zero;
    if (PdhAddEnglishCounter(pdh, @"\Network Interface(*)\Bytes Received/sec", IntPtr.Zero, out cRx) != 0) cRx = IntPtr.Zero;
    if (PdhAddEnglishCounter(pdh, @"\Network Interface(*)\Bytes Sent/sec", IntPtr.Zero, out cTx) != 0) cTx = IntPtr.Zero;
    PdhCollectQueryData(pdh);                             // rates need two collections; the next sample has them
  }

  // Calls fn(instanceName, value) for every instance of a wildcard counter. False if it has no data yet.
  static bool ForEach(IntPtr counter, Action<string, double> fn) {
    if (counter == IntPtr.Zero) return false;
    uint size = 0, count;
    uint r = PdhGetFormattedCounterArray(counter, PDH_FMT_DOUBLE | PDH_FMT_NOCAP100, ref size, out count, IntPtr.Zero);
    if (r != PDH_MORE_DATA || size == 0) return false;
    IntPtr buf = Marshal.AllocHGlobal((int)size);
    try {
      if (PdhGetFormattedCounterArray(counter, PDH_FMT_DOUBLE | PDH_FMT_NOCAP100, ref size, out count, buf) != 0) return false;
      int step = Marshal.SizeOf(typeof(PdhItem));
      for (int i = 0; i < count; i++) {
        var it = (PdhItem)Marshal.PtrToStructure(new IntPtr(buf.ToInt64() + i * step), typeof(PdhItem));
        if (it.status == 0 || it.status == 1) fn(Marshal.PtrToStringUni(it.name), it.value);   // PDH_CSTATUS_VALID_DATA / NEW_DATA
      }
      return true;
    } finally { Marshal.FreeHGlobal(buf); }
  }

  // Task Manager's GPU number: busiest engine type (3D, VideoDecode, Copy...), summed across processes.
  static float SampleGpu() {
    var byType = new Dictionary<string, double>();
    bool ok = ForEach(cGpu, (name, v) => {
      int at = name.IndexOf("engtype_");
      string type = at >= 0 ? name.Substring(at) : "other";
      double cur; byType.TryGetValue(type, out cur); byType[type] = cur + v;
    });
    if (!ok) return -1;
    return byType.Count == 0 ? 0 : (float)Math.Min(100, byType.Values.Max());
  }

  static double SumNet(IntPtr counter) {
    double t = 0;
    // Skip loopback-style virtual adapters that just mirror real traffic.
    ForEach(counter, (name, v) => { if (name.IndexOf("isatap", StringComparison.OrdinalIgnoreCase) < 0 && name.IndexOf("Loopback", StringComparison.OrdinalIgnoreCase) < 0) t += v; });
    return t;
  }

  static void SampleStats(object _) {
    int level = statsLevel;
    if (level == 0) { lastIdle = 0; pdhPrimed = false; return; }
    try {
      float cpuPct = SampleCpu();
      float gpuPct = -1; double rx = 0, tx = 0;
      if (level >= 2) {
        InitPdh();
        if (pdh != IntPtr.Zero && PdhCollectQueryData(pdh) == 0) {
          if (pdhPrimed) { gpuPct = SampleGpu(); rx = SumNet(cRx); tx = SumNet(cTx); }
          pdhPrimed = true;
        }
      } else pdhPrimed = false;
      var m = new MEMSTATUS(); m.len = (uint)Marshal.SizeOf(typeof(MEMSTATUS)); GlobalMemoryStatusEx(ref m);
      double totalGb = m.totalPhys / 1073741824.0, usedGb = (m.totalPhys - m.availPhys) / 1073741824.0;
      POWER p; GetSystemPowerStatus(out p);
      int bat = (p.flag & 128) != 0 || p.percent == 255 ? -1 : p.percent;   // -1: no battery (desktop)
      if (cpuPct < 0) return;                             // first tick only primes the CPU delta
      var inv = System.Globalization.CultureInfo.InvariantCulture;
      Emit(string.Format(inv, "stats cpu={0:0.0} gpu={1:0.0} ram={2:0.0} ramUsed={3:0.0} ramTotal={4:0.0} rx={5:0} tx={6:0} bat={7} ac={8}",
        cpuPct, gpuPct, m.load, usedGb, totalGb, rx, tx, bat, p.ac == 1 ? 1 : 0));
    } catch (Exception e) { Emit("statserr " + e.Message.Replace('\n', ' ')); }
  }

  // Windows only lets the app you're using hand focus away. Petal Ask is opened from a key you
  // pressed in that app, so borrow its input queue for a moment, the standard way to do this.
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  static void Focus(IntPtr hwnd) {
    IntPtr fg = GetForegroundWindow();
    if (fg == hwnd) return;
    uint fgPid; uint fgThread = GetWindowThreadProcessId(fg, out fgPid);
    uint me = GetCurrentThreadId();
    bool attached = fgThread != 0 && fgThread != me && AttachThreadInput(me, fgThread, true);
    try { BringWindowToTop(hwnd); SetForegroundWindow(hwnd); }
    finally { if (attached) AttachThreadInput(me, fgThread, false); }
  }

  static void ReadCommands() {
    string line;
    while ((line = Console.In.ReadLine()) != null) {
      // "stats 0" off, "stats 1" pulse (CPU/RAM/battery), "stats 2" everything.
      if (line.StartsWith("focus ")) { long h; if (long.TryParse(line.Substring(6).Trim(), out h)) Focus(new IntPtr(h)); continue; }
      if (line.StartsWith("stats ")) { int lv; if (int.TryParse(line.Substring(6).Trim(), out lv)) statsLevel = Math.Max(0, Math.Min(2, lv)); }
    }
    Environment.Exit(0);   // Petal went away; don't linger
  }

  static int Main(string[] args) {
    // Per-monitor aware, so window and monitor rects come back in real pixels on mixed-DPI setups.
    try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { }
    if (args.Length > 0) uint.TryParse(args[0], out ownerPid);
    debug = args.Length > 1 && args[1] == "debug";

    IntPtr mod = GetModuleHandle(Process.GetCurrentProcess().MainModule.ModuleName);
    if (SetWindowsHookEx(13, keyProc, mod, 0) == IntPtr.Zero || SetWindowsHookEx(14, mouseProc, mod, 0) == IntPtr.Zero) {
      Emit("error " + Marshal.GetLastWin32Error());
      return 1;
    }
    Emit("ready");
    fsTimer = new Timer(CheckFullscreen, null, 0, 400);
    statsTimer = new Timer(SampleStats, null, 1000, 1000);
    new Thread(ReadCommands) { IsBackground = true }.Start();
    MSG msg;
    while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) { }
    return 0;
  }
}
