const { bin: pkgBin } = require('../package.json')
const progName = (() => { for (let prop in pkgBin) return prop })()
/*
  WARNING: the files named in this script are specific to the
  referenced version of npm:
*/
module.exports.targetVersion = '8.19.4'

module.exports.targets = Object.freeze({
  CHANGED_FILES:
    Object.freeze([ 'commands/install', 'utils/cmd-list', 'utils/config/definitions' ]),
  ADDED_FILES:
    Object.freeze([ 'commands/download' ]),
  ADDED_DIRS:
    Object.freeze([ 'download', 'offliner' ])
})

module.exports.backupFlag = '_ORIG'

module.exports.errorCodes = Object.freeze({
  BAD_PROJECT: 19,
  NO_NPM: 11,
  WRONG_NPM_VER: 12,
  BAD_NPM_INST: 13,
  LEFTOVERS: 14,
  FS_ACTION_FAIL: 15
})

module.exports.messages = Object.freeze({
  ADVICE_TO_UNINSTALL: `
   The remains of a previous installation of npm-two-stage were found.
   This complicates the current installation, so it will be aborted.
   The best action to take now is to run '${progName} uninstall' using the
   same npm-two-stage version as when the previous installation was run.`,
  HELP_ADDENDUM: `
  npmPath (the path to the target npm installation) is required with the
  commands install, status, and uninstall, unless the help option is given.
`
})

Object.freeze(module.exports)
