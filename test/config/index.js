//const fs = require('fs')
const path = require('path')

const fileMap = {
  '01_constants_test.js': 'lib/constants.js',
  '02_file-tools_test.js': 'lib/file-tools.js',
  '03_shared_test.js': 'lib/shared.js',
  '04_status_test.js': 'lib/status.js',
  '05_install_test.js': 'lib/install.js',
  '06_uninstall_test.js': 'lib/uninstall.js',
  'integration.js': 'cli.js'
}

const TESTDIR_PREFIX_RE = /^test\//

module.exports = arg => {
  //fs.writeFileSync('coverage-map-input.txt', arg + '\n', { flag: 'as' })
  const key = arg.replace(TESTDIR_PREFIX_RE, '')
  return fileMap[key] || null
}

