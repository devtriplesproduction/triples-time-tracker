const fs = require('fs')
const path = require('path')

const rbacPath = path.resolve(__dirname, '../../TripleS-ERP/config/rbac.ts')
let content = fs.readFileSync(rbacPath, 'utf8')

if (!content.includes("'/time-tracking'")) {
  content = content.replace("'/my-tasks',", "'/my-tasks',\n    '/time-tracking',")
  // Replace in Admin as well
  content = content.replace(
    "/my-tasks',\n  ],",
    "/my-tasks',\n    '/time-tracking',\n  ],"
  )
  fs.writeFileSync(rbacPath, content, 'utf8')
  console.log('Successfully updated rbac.ts with /time-tracking')
} else {
  console.log('rbac.ts already contains /time-tracking')
}
