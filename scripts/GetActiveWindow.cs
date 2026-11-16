using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public class Program {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    public static void Main() {
        try {
            IntPtr hwnd = GetForegroundWindow();
            StringBuilder sb = new StringBuilder(256);
            GetWindowText(hwnd, sb, 256);
            uint pid = 0;
            GetWindowThreadProcessId(hwnd, out pid);
            string procName = "Unknown";
            if (pid > 0) {
                try {
                    Process p = Process.GetProcessById((int)pid);
                    procName = p.ProcessName;
                } catch {}
            }
            string title = sb.ToString().Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "").Replace("\n", "");
            Console.Write("{\"ProcessName\":\"" + procName + "\",\"Title\":\"" + title + "\"}");
        } catch {
            Console.Write("{\"ProcessName\":\"Desktop Work\",\"Title\":\"\"}");
        }
    }
}
