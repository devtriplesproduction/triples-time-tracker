Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WinUtil {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
}
"@ -ErrorAction SilentlyContinue

$hwnd = [WinUtil]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 256
$null = [WinUtil]::GetWindowText($hwnd, $sb, 256)
$p = 0
$null = [WinUtil]::GetWindowThreadProcessId($hwnd, [ref]$p)
$proc = Get-Process -Id $p -ErrorAction SilentlyContinue

$title = $sb.ToString()
$pname = if ($proc) { $proc.ProcessName } else { "Unknown" }

[PSCustomObject]@{
    ProcessName = $pname
    Title = $title
} | ConvertTo-Json -Compress
