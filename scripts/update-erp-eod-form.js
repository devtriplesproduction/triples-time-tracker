const fs = require('fs')
const path = require('path')

const formPath = path.resolve(__dirname, '../../TripleS-ERP/components/eod/EODSubmissionForm.tsx')
let content = fs.readFileSync(formPath, 'utf8')

if (!content.includes('loadTimeTrackerHours')) {
  // 1. Ensure Clock is imported
  if (!content.includes('Clock,')) {
    content = content.replace("ImagePlus,", "ImagePlus, Clock,")
  }

  // 2. Add trackedHours state and useEffect
  const trackerSnippet = `  const [workedHoursInput, setWorkedHoursInput] = useState<string>('');
  const [trackedHours, setTrackedHours] = useState<string | null>(null);

  useEffect(() => {
    async function loadTimeTrackerHours() {
      try {
        const res = await fetch(\`/api/time-tracking/summary?employeeId=\${selectedEmployeeId}&date=\${reportDate}\`);
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.formattedActive) {
            setTrackedHours(data.formattedActive);
            if (!workedHoursInput && !isUpdate) {
              setWorkedHoursInput(data.formattedActive);
            }
          }
        }
      } catch (e) {}
    }
    loadTimeTrackerHours();
  }, [selectedEmployeeId, reportDate, isUpdate]);`

  content = content.replace("  const [workedHoursInput, setWorkedHoursInput] = useState<string>('');", trackerSnippet)

  // 3. Add UI badge/button above input
  const buttonSnippet = `                <div className="flex items-center justify-between">
                  <label className="block text-sm font-medium text-foreground">Worked Hours <span className="text-error">*</span></label>
                  {trackedHours && (
                    <button
                      type="button"
                      onClick={() => setWorkedHoursInput(trackedHours)}
                      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 transition-colors border border-emerald-500/20"
                      title="Sync active hours from TripleS Time Tracker"
                    >
                      <Clock className="w-3 h-3" />
                      <span>Tracker: {trackedHours}</span>
                    </button>
                  )}`

  content = content.replace(
    '                <div className="flex items-center justify-between">\n                  <label className="block text-sm font-medium text-foreground">Worked Hours <span className="text-error">*</span></label>',
    buttonSnippet
  )

  fs.writeFileSync(formPath, content, 'utf8')
  console.log('Successfully integrated Time Tracker with EODSubmissionForm')
} else {
  console.log('EODSubmissionForm already contains Time Tracker integration')
}
