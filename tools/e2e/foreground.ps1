# Proof that an unattended launch never steals focus and shows no window.
# Run it before and after `node tools/launch-app.mjs`: the foreground handle must be unchanged
# and "electron visible windows" must be 0 in stealth mode.
#
# `Get-Process electron | MainWindowTitle` is NOT a reliable check here: the app is frameless
# (titleBarStyle 'hidden'), and .NET's main-window heuristic reports an empty title for it even
# when the window is on screen. This enumerates the real top-level windows instead.
Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class Win {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out int pid);
  public static string Title(IntPtr h) { var sb = new StringBuilder(512); GetWindowTextW(h, sb, sb.Capacity); return sb.ToString(); }
  public static List<string> VisibleFor(HashSet<int> pids) {
    var found = new List<string>();
    EnumWindows((h, l) => {
      int pid; GetWindowThreadProcessId(h, out pid);
      if (pids.Contains(pid) && IsWindowVisible(h)) found.Add("pid=" + pid + " hwnd=" + h + " title=[" + Title(h) + "]");
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@
$h = [Win]::GetForegroundWindow()
"foreground=$h title=[$([Win]::Title($h))]"
$pids = New-Object 'System.Collections.Generic.HashSet[int]'
Get-Process electron -ErrorAction SilentlyContinue | ForEach-Object { [void]$pids.Add($_.Id) }
"electron processes=$($pids.Count)"
$windows = @([Win]::VisibleFor($pids))
"electron visible windows=$($windows.Count)"
$windows | ForEach-Object { "  $_" }
