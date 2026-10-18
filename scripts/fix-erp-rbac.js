const fs = require('fs');
const path = require('path');

const rbacPath = path.resolve(__dirname, '../../TripleS-ERP/config/rbac.ts');
let content = fs.readFileSync(rbacPath, 'utf8');

// Remove '/time-tracking' from HR
content = content.replace(
  `  HR: [\n    '/hr/onboarding',\n    '/hr/leave',\n    '/eod',\n    '/hr/holidays',\n    '/hr/payroll',\n    '/hr/attendance',\n    '/dashboard',\n    '/rulebook',\n    '/announcements',\n    '/my-tasks',\n    '/time-tracking',\n    '/notes',\n    '/quick-tasks',\n  ],`,
  `  HR: [\n    '/hr/onboarding',\n    '/hr/leave',\n    '/eod',\n    '/hr/holidays',\n    '/hr/payroll',\n    '/hr/attendance',\n    '/dashboard',\n    '/rulebook',\n    '/announcements',\n    '/my-tasks',\n    '/notes',\n    '/quick-tasks',\n  ],`
);

fs.writeFileSync(rbacPath, content, 'utf8');
console.log('Successfully updated rbac.ts: /time-tracking is now Admin-only');
