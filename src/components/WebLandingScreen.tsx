import React, { useState } from 'react'
import {
  Download,
  Monitor,
  ShieldCheck,
  Clock,
  ExternalLink,
  AlertCircle,
  ArrowRight,
  Laptop,
  CheckCircle2,
  Moon,
  Sun,
  Camera,
  Activity,
  FolderDown
} from 'lucide-react'

interface WebLandingScreenProps {
  theme: 'dark' | 'light'
  onToggleTheme: () => void
  onPreviewUI: () => void
}

export const WebLandingScreen: React.FC<WebLandingScreenProps> = ({
  theme,
  onToggleTheme,
  onPreviewUI
}) => {
  const [downloadStarted, setDownloadStarted] = useState(false)
  const releasesUrl = 'https://github.com/devtriplesproduction/triples-time-tracker/releases'
  const erpUrl = 'https://triples-erp.vercel.app'

  const handleLaunchApp = () => {
    // Attempt custom URI protocol launch, with fallback guidance
    window.location.href = 'triples-tracker://open'
    setTimeout(() => {
      alert(
        'If TripleS Time Tracker is already installed, please launch it from your Windows Start Menu or Desktop shortcut.\n\nIf not installed yet, click "Download for Windows (.exe)" below.'
      )
    }, 1500)
  }

  const handleDownload = () => {
    setDownloadStarted(true)
    window.open(releasesUrl, '_blank', 'noopener,noreferrer')
  }

  return (
    <div
      className="min-h-screen w-screen overflow-y-auto font-sans flex flex-col transition-colors selection:bg-blue-500/20"
      style={{
        backgroundColor: 'var(--bg-primary)',
        color: 'var(--text-primary)'
      }}
    >
      {/* Top Navigation Bar */}
      <header
        className="w-full border-b px-6 py-3.5 flex items-center justify-between sticky top-0 z-30 backdrop-blur-md"
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderColor: 'var(--border-color)'
        }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center font-bold shadow-sm border"
            style={{
              backgroundColor: 'var(--btn-primary-bg)',
              color: 'var(--btn-primary-text)',
              borderColor: 'var(--border-color)'
            }}
          >
            <Clock size={19} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm tracking-tight" style={{ color: 'var(--text-primary)' }}>
                TripleS Time Tracker
              </span>
              <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
                v1.0.0
              </span>
            </div>
            <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
              Windows Desktop Edition for TripleS ERP
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={onToggleTheme}
            className="p-2 rounded-lg border transition-colors hover:bg-white/5 active:scale-95"
            style={{
              backgroundColor: 'var(--bg-surface-elevated)',
              borderColor: 'var(--border-color)',
              color: 'var(--text-secondary)'
            }}
            title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          >
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>

          <a
            href={erpUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all hover:opacity-90 active:scale-95"
            style={{
              backgroundColor: 'var(--bg-surface-elevated)',
              borderColor: 'var(--border-color)',
              color: 'var(--text-secondary)'
            }}
          >
            <span>TripleS ERP Portal</span>
            <ExternalLink size={13} />
          </a>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 py-10 flex flex-col gap-8">
        
        {/* Notice Alert Banner: Explaining the Browser Sandbox */}
        <div
          className="rounded-2xl border p-4.5 sm:p-5 flex items-start gap-3.5 shadow-lg relative overflow-hidden"
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderColor: 'var(--border-color)'
          }}
        >
          <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20 shrink-0">
            <AlertCircle size={22} />
          </div>
          <div className="space-y-1 text-left">
            <h2 className="text-sm font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
              Desktop Application Required For Time Tracking
            </h2>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              You are accessing TripleS Time Tracker in a <strong>web browser</strong>. Because web browsers are sandboxed for security, they cannot detect foreground application switches, monitor system idle intervals, or take automated desktop screenshots.
              To clock in and record your daily hours, please launch or download the <strong>Windows Desktop Application</strong>.
            </p>
          </div>
        </div>

        {/* Hero Section */}
        <div
          className="rounded-3xl border p-7 sm:p-10 text-center flex flex-col items-center shadow-xl relative overflow-hidden"
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderColor: 'var(--border-color)'
          }}
        >
          {/* Subtle glow / pill */}
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold mb-5 bg-blue-500/10 text-blue-400 border border-blue-500/25">
            <Monitor size={14} />
            <span>Windows 10 & 11 • 64-bit</span>
          </div>

          <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight mb-3">
            TripleS ERP Time Tracker
          </h1>

          <p className="max-w-xl text-xs sm:text-sm leading-relaxed mb-8" style={{ color: 'var(--text-secondary)' }}>
            Enterprise employee desktop tracker with automatic active hours detection, periodic background screenshot verification, and seamless real-time synchronization with TripleS ERP.
          </p>

          {/* Primary Action Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 w-full sm:w-auto">
            <button
              onClick={handleDownload}
              className="w-full sm:w-auto px-6 py-3.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2.5 transition-all shadow-lg active:scale-95"
              style={{
                backgroundColor: 'var(--btn-primary-bg)',
                color: 'var(--btn-primary-text)'
              }}
            >
              <Download size={18} />
              <span>Download for Windows (.exe)</span>
            </button>

            <button
              onClick={handleLaunchApp}
              className="w-full sm:w-auto px-5 py-3.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 border transition-all hover:opacity-90 active:scale-95"
              style={{
                backgroundColor: 'var(--bg-surface-elevated)',
                borderColor: 'var(--border-color)',
                color: 'var(--text-primary)'
              }}
            >
              <Laptop size={18} />
              <span>Launch Desktop App</span>
            </button>
          </div>

          {downloadStarted && (
            <div className="mt-4 flex items-center gap-2 text-xs text-emerald-400 font-medium">
              <CheckCircle2 size={15} />
              <span>Opened release download in a new tab. Run the installer once downloaded!</span>
            </div>
          )}

          {/* Secondary preview trigger */}
          <div className="mt-7 pt-5 border-t w-full flex items-center justify-center gap-2" style={{ borderColor: 'var(--border-color)' }}>
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              Developer or Administrator?
            </span>
            <button
              onClick={onPreviewUI}
              className="text-xs font-semibold hover:underline inline-flex items-center gap-1 text-blue-400"
            >
              <span>Preview Desktop UI in Demo Mode</span>
              <ArrowRight size={13} />
            </button>
          </div>
        </div>

        {/* Feature Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div
            className="p-5 rounded-2xl border text-left shadow-sm transition-all"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-color)'
            }}
          >
            <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3 bg-blue-500/10 text-blue-400 border border-blue-500/20">
              <Activity size={20} />
            </div>
            <h3 className="text-sm font-bold mb-1.5" style={{ color: 'var(--text-primary)' }}>
              Active vs. Idle Time Measurement
            </h3>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              Measures true engagement by detecting mouse and keyboard activity with native Windows power events, accurately pausing active time during idle and lock screen states.
            </p>
          </div>

          <div
            className="p-5 rounded-2xl border text-left shadow-sm transition-all"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-color)'
            }}
          >
            <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3 bg-purple-500/10 text-purple-400 border border-purple-500/20">
              <Camera size={20} />
            </div>
            <h3 className="text-sm font-bold mb-1.5" style={{ color: 'var(--text-primary)' }}>
              Periodic Screenshot Verification
            </h3>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              Automatically captures secure desktop snapshots during active sessions and uploads them to Supabase Storage for administrative verification.
            </p>
          </div>

          <div
            className="p-5 rounded-2xl border text-left shadow-sm transition-all"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-color)'
            }}
          >
            <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <ShieldCheck size={20} />
            </div>
            <h3 className="text-sm font-bold mb-1.5" style={{ color: 'var(--text-primary)' }}>
              Seamless TripleS ERP Sync
            </h3>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              Synchronizes in real-time with the central database. Worked and active hours are automatically populated into daily EOD reports without manual entry.
            </p>
          </div>

          <div
            className="p-5 rounded-2xl border text-left shadow-sm transition-all"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-color)'
            }}
          >
            <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3 bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <FolderDown size={20} />
            </div>
            <h3 className="text-sm font-bold mb-1.5" style={{ color: 'var(--text-primary)' }}>
              Background System Tray
            </h3>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              Minimizes safely to the Windows notification tray when closed. Recovers tracking state seamlessly across application restarts and network interruptions.
            </p>
          </div>
        </div>

        {/* 3-Step Setup Guide */}
        <div
          className="rounded-2xl border p-6 text-left shadow-sm"
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderColor: 'var(--border-color)'
          }}
        >
          <h3 className="text-sm font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
            Quick Setup Guide for Employees
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div
              className="p-4 rounded-xl border flex flex-col"
              style={{
                backgroundColor: 'var(--bg-surface-elevated)',
                borderColor: 'var(--border-color)'
              }}
            >
              <span className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 font-bold text-xs flex items-center justify-center mb-2.5">
                1
              </span>
              <h4 className="text-xs font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
                Download & Install
              </h4>
              <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                Download the Windows executable (`.exe`) installer or portable binary and launch it on your PC.
              </p>
            </div>

            <div
              className="p-4 rounded-xl border flex flex-col"
              style={{
                backgroundColor: 'var(--bg-surface-elevated)',
                borderColor: 'var(--border-color)'
              }}
            >
              <span className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 font-bold text-xs flex items-center justify-center mb-2.5">
                2
              </span>
              <h4 className="text-xs font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
                Sign In
              </h4>
              <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                Authenticate with your corporate TripleS ERP employee email (`@tsp.com`) and password.
              </p>
            </div>

            <div
              className="p-4 rounded-xl border flex flex-col"
              style={{
                backgroundColor: 'var(--bg-surface-elevated)',
                borderColor: 'var(--border-color)'
              }}
            >
              <span className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 font-bold text-xs flex items-center justify-center mb-2.5">
                3
              </span>
              <h4 className="text-xs font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
                Clock In & Work
              </h4>
              <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                Hit "Clock In" when beginning your day. Minimize to tray — worked hours sync automatically to ERP.
              </p>
            </div>
          </div>
        </div>

      </main>

      {/* Footer */}
      <footer
        className="w-full border-t py-6 px-6 text-center text-xs"
        style={{
          borderColor: 'var(--border-color)',
          color: 'var(--text-secondary)'
        }}
      >
        <p>TripleS Production • Confidential & Proprietary Enterprise Software</p>
        <p className="text-[11px] mt-1 opacity-75">
          Need assistance? Contact your TripleS ERP System Administrator or HR department.
        </p>
      </footer>
    </div>
  )
}

