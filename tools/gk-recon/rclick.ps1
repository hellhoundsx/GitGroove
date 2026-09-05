param([int]$X, [int]$Y, [int]$Button = 2)
Add-Type -Namespace W6 -Name U -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y); [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra); [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); public struct RECT { public int Left, Top, Right, Bottom; }'
$p = Get-Process gitkraken | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -ne '' } | Select-Object -First 1
[W6.U]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 250
$r = New-Object W6.U+RECT; [W6.U]::GetWindowRect($p.MainWindowHandle, [ref]$r) | Out-Null
# renderer viewport is 1904x1015 inside a 1920x1080 window: 8px side borders, 57px top chrome
$sx = $r.Left + 8 + $X; $sy = $r.Top + 57 + $Y
[W6.U]::SetCursorPos($sx, $sy) | Out-Null
Start-Sleep -Milliseconds 150
if ($Button -eq 2) { [W6.U]::mouse_event(0x0008, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 60; [W6.U]::mouse_event(0x0010, 0, 0, 0, [UIntPtr]::Zero) }
else { [W6.U]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 60; [W6.U]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero) }
"real click button=$Button at screen $sx,$sy (renderer $X,$Y)"
