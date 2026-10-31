const fs = require('fs')
const path = require('path')

const sidebarPath = path.resolve(__dirname, '../../TripleS-ERP/components/layout/sidebar.tsx')
let content = fs.readFileSync(sidebarPath, 'utf8')

// 1. Ensure Clock is imported from lucide-react
if (!content.includes('Clock,')) {
  content = content.replace("CheckSquare,\n} from 'lucide-react'", "CheckSquare,\n  Clock,\n} from 'lucide-react'")
}

// 2. Add Time Tracking to getRoleNavItems
if (!content.includes("label: 'Time Tracking'")) {
  // Add for Employee / Manager after EOD Reports
  content = content.replace(
    "allItems.push({ label: 'EOD Reports', href: eodHref,",
    "allItems.push({ label: 'Time Tracking', href: '/time-tracking', icon: <Clock className=\"mr-3 h-5 w-5 shrink-0\" /> })\n    allItems.push({ label: 'EOD Reports', href: eodHref,"
  )

  // Add for HR after Review EOD
  content = content.replace(
    "allItems.push({ label: 'Review EOD', href: eodHref,",
    "allItems.push({ label: 'Time Tracking', href: '/time-tracking', icon: <Clock className=\"mr-3 h-5 w-5 shrink-0\" /> })\n    allItems.push({ label: 'Review EOD', href: eodHref,"
  )

  // Add for Admin after Tasks & Kanban
  content = content.replace(
    "allItems.push({ label: 'Review EOD', href: eodHref,",
    "allItems.push({ label: 'Time Tracking', href: '/time-tracking', icon: <Clock className=\"mr-3 h-5 w-5 shrink-0\" /> })\n    allItems.push({ label: 'Review EOD', href: eodHref,"
  )

  fs.writeFileSync(sidebarPath, content, 'utf8')
  console.log('Successfully updated sidebar.tsx with Time Tracking')
} else {
  console.log('sidebar.tsx already has Time Tracking')
}
