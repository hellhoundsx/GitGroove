param([string]$Out, [int]$DelayMs = 900)
Start-Sleep -Milliseconds $DelayMs
Add-Type -AssemblyName System.Drawing
Add-Type -Namespace W4 -Name U -MemberDefinition '[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r); [DllImport("user32.dll")] public static extern IntPtr FindWindow(string cls, string title); [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); public struct RECT { public int Left, Top, Right, Bottom; }'
$p = Get-Process gitkraken | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -ne '' } | Select-Object -First 1
$r = New-Object W4.U+RECT
[W4.U]::GetWindowRect($p.MainWindowHandle, [ref]$r) | Out-Null
$w = $r.Right - $r.Left; $h = $r.Bottom - $r.Top
$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.Left, $r.Top, 0, 0, $bmp.Size)
$full = [System.IO.Path]::GetFullPath($Out)
if (Test-Path $full) { Remove-Item -Force $full }
$bmp.Save($full, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
$menu = [W4.U]::FindWindow("#32768", $null)
$fg = [W4.U]::GetForegroundWindow()
"saved $(Split-Path $full -Leaf) ($w x $h) nativeMenuOpen=$($menu -ne [IntPtr]::Zero) gkForeground=$($fg -eq $p.MainWindowHandle)"
