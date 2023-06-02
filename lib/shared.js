const Emitter = require('events')
const fs = require('fs')
const path = require('path')
const { promisify } = require('util')
const execAsync = promisify(require('child_process').exec)
const readFileAsync = promisify(fs.readFile)
const renameAsync = promisify(fs.rename)

const constants = require('./constants')
const {
  targetVersion: EXPECTED_NPM_VER,
  targets: TGTS,
  backupFlag: BAKFLAG,
  errorCodes: ERRS
} = constants

const ft = require('./file-tools')

// For when the npm directory is given by the user.
// To execute `npm --version` may give misleading information in this case,
// so we look at the package.json file at the given location instead.
function checkVersionInPackageJson(npmDir) {
  const pkgJsonPath = path.join(npmDir, 'package.json')
  return readFileAsync(pkgJsonPath, 'utf8')
  .catch(err => {
    err.exitcode = err.code == 'ENOENT' ? ERRS.NO_NPM : ERRS.BAD_NPM_INST
    throw err
  })
  .then(s => {
    if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1)
    try {
      const pkgData = JSON.parse(s)
      if (pkgData.name != 'npm') {
        const err = new Error(`package at ${npmDir} is not npm`)
        err.exitcode = ERRS.NO_NPM
        throw err
      }
      if (pkgData.version != EXPECTED_NPM_VER) {
        const err = new Error(`wrong version of npm: found ${pkgData.version}`)
        err.exitcode = ERRS.WRONG_NPM_VER
        throw err
      }
    }
    catch (err) {
      if (err instanceof SyntaxError) {
        err = new Error(`failed to parse package.json at ${npmDir}`)
        err.exitcode = ERRS.BAD_NPM_INST
      }
      throw err
    }
  })
}

const emitter = module.exports.emitter = new Emitter()
ft.setEmitter(emitter)

module.exports.expectCorrectNpmVersion = function(npmDir) {
  if (npmDir) return checkVersionInPackageJson(npmDir)

  return execAsync('npm --version')
  .catch(err => {
    err = new Error('could not get information from \`npm --version\`')
    err.exitcode = ERRS.NO_NPM
    throw err
  })
  .then(({ stdout, stderr }) => {
    const actualNpmVer = stdout.trim()
    // Using constants.targetVersion here instead of alias EXPECTED_NPM_VER,
    // for the sake of flexibility in testing.
    if (actualNpmVer != constants.targetVersion) {
      const err = new Error(`wrong version of npm: found ${actualNpmVer}`)
      err.exitcode = ERRS.WRONG_NPM_VER
      throw err
    }
  })
}

// This is more forgiving than the install function that adds the items,
// because it may be used to restore an npm installation from an aborted
// installation of npm-two-stage.
module.exports.removeAddedItems = function() {
  const addedDirs = TGTS.ADDED_DIRS
  const addedFiles = TGTS.ADDED_FILES.map(f => path.normalize(f) + '.js')

  function removeAddedDirs(i) {
    if (i >= addedDirs.length) return Promise.resolve()
    const dir = addedDirs[i]
    return ft.prune(dir)
    .catch(err => {
      if (err.code == 'ENOENT')
        emitter.emit('msg', `Could not find directory ${dir} for removal`)
      else {
        emitter.emit('msg', `Unable to remove directory ${dir} (${err.code})`)
        throw err
      }
    })
    .then(() => removeAddedDirs(i+1))
  }

  return ft.removeFiles(addedFiles, 0)
  .then(() => removeAddedDirs(0))
  .catch(err => {
    err.exitcode = ERRS.FS_ACTION_FAIL
    throw err
  })
}

module.exports.restoreBackups = function() {
  const names = TGTS.CHANGED_FILES

  function restoreNext(i) {
    if (i >= names.length) return Promise.resolve()
    const oldName = names[i]
    const backupName = path.normalize(`${oldName}${BAKFLAG}.js`)
    return renameAsync(backupName, path.normalize(oldName + '.js'))
    .catch(err => {
      emitter.emit('msg', `Unable to restore ${oldName + '.js'} (${err.code})`)
      err.exitcode = ERRS.FS_ACTION_FAIL
      throw err
    })
    .then(() => restoreNext(i+1))
  }

  return restoreNext(0)
}

module.exports.addFaultMessage = function(err) {
  switch (err.exitcode) {
    case ERRS.WRONG_NPM_VER:
      emitter.emit('msg', 'Wrong version of npm for this version of npm-two-stage.')
      break
    case ERRS.NO_NPM:
      emitter.emit('msg', 'npm not found at given location.')
      break
    case ERRS.BAD_NPM_INST:
      emitter.emit('msg', err.message)
      break
  }
}
