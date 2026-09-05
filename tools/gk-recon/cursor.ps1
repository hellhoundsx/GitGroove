param([int]$X = 900, [int]$Y = 500)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($X, $Y)
"cursor at $X,$Y"
