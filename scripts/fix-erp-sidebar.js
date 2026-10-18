const fs = require('fs');
const path = require('path');

const sidebarPath = path.resolve(__dirname, '../../TripleS-ERP/components/layout/sidebar.tsx');
let content = fs.readFileSync(sidebarPath, 'utf8');

// Remove from HR
content = content.replace(
  "    allItems.push({ label: 'Payroll', href: payrollHref, icon: <CreditCard className=\"mr-3 h-5 w-5 shrink-0\" /> })\n    allItems.push({ label: 'Time Tracking', href: '/time-tracking', icon: <Clock className=\"mr-3 h-5 w-5 shrink-0\" /> })",
  "    allItems.push({ label: 'Payroll', href: payrollHref, icon: <CreditCard className=\"mr-3 h-5 w-5 shrink-0\" /> })"
);

// Add to Admin
content = content.replace(
  "    allItems.push({ label: 'Payroll', href: payrollHref, icon: <CreditCard className=\"mr-3 h-5 w-5 shrink-0\" /> })\n    allItems.push({ label: 'Review EOD', href: eodHref, icon: <ClipboardList className=\"mr-3 h-5 w-5 shrink-0\" /> })",
  "    allItems.push({ label: 'Payroll', href: payrollHref, icon: <CreditCard className=\"mr-3 h-5 w-5 shrink-0\" /> })\n    allItems.push({ label: 'Time Tracking', href: '/time-tracking', icon: <Clock className=\"mr-3 h-5 w-5 shrink-0\" /> })\n    allItems.push({ label: 'Review EOD', href: eodHref, icon: <ClipboardList className=\"mr-3 h-5 w-5 shrink-0\" /> })"
);

fs.writeFileSync(sidebarPath, content, 'utf8');
console.log('Successfully updated sidebar.tsx: Time Tracking added to Admin and removed from HR');
