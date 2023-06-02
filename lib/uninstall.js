const fs = require('fs')
const path = require('path')
const { promisify } = require('util')
const execAsync = promisify(require('child_process').exec)
const readdirAsync = promisify(fs.readdir)
const rmdirAsync = promisify(fs.rmdir)
const unlinkAsync = promisify(fs.unlink)

const {
  targets: TGTS,
  backupFlag: BAKFLAG,
  errorCodes: ERRS
} = require('./constants')

const {
  emitter,
  expectCorrectNpmVersion,
  removeAddedItems,
  restoreBackups,
  addFaultMessage
} = require('./shared')

module.exports.uninstallProgress = emitter

// Specifying the npm root path is an alternative that allows the user to
// restore a different npm installation than the one that is active on the
// current system; for example, one on a USB drive that the user intended
// to use on another platform.
module.exports.uninstall = function(npmDir) {
  const startDir = process.cwd()
  if (npmDir) npmDir = path.resolve(path.normalize(npmDir))
  emitter.emit('msg',
    `Checking npm version ${npmDir ? 'at given path' : '(live)'}...`
  )
  return expectCorrectNpmVersion(npmDir)
  .then(() => /* istanbul ignore next */ npmDir ||
    execAsync('npm root -g').then(({ stdout, stderr }) =>
      npmDir = path.join(stdout.trim(), 'npm')
    )
  )
  .then(() => {
    emitter.emit('msg', `Target npm home is ${npmDir}`)
    try { process.chdir(path.join(npmDir, 'lib')) }
    catch (err) {
      if (err.code == 'ENOENT') {
        err = new Error('Unable to access lib directory at supposed npm path')
        err.exitcode = ERRS.BAD_NPM_INST
      }
      throw err
    }
    const files =
      TGTS.CHANGED_FILES.concat(TGTS.ADDED_FILES).map(f => f + '.js')
    const itemsToRemove = files.concat(TGTS.ADDED_DIRS.map(d => d + '/'))
    emitter.emit('msg', 'Removing items added by npm-two-stage install:')
    for (const f of itemsToRemove) {
      emitter.emit('msg', '  ' + f)
    }
    return removeAddedItems()
  })
  .then(() => {
    const files = TGTS.CHANGED_FILES.map(f => f + '.js')
    emitter.emit('msg', 'Restoring backed-up original files:')
    for (const f of files) {
      emitter.emit('msg', '  ' + f)
    }
    return restoreBackups()
  })
  .then(() => process.chdir(startDir))
  .catch(err => {
    // There is no Promise.prototype.finally() until node.js v10.0.0
    process.chdir(startDir)
    if (!err.exitcode) err.exitcode = ERRS.FS_ACTION_FAIL
    addFaultMessage(err)
    throw err
  })
}
