const fs = require('fs')
const path = require('path')
const { promisify } = require('util')
const accessAsync = promisify(fs.access)
const execAsync = promisify(require('child_process').exec)
const readdirAsync = promisify(fs.readdir)

const {
  targets: TGTS,
  backupFlag: BAKFLAG,
  errorCodes: ERRS
} = require('./constants')

const {
  emitter,
  expectCorrectNpmVersion,
  addFaultMessage
} = require('./shared')

module.exports.statusProgress = emitter

module.exports.getStatus = function(npmDir) {
  const startDir = process.cwd()
  let liveNpmDir
  if (npmDir) npmDir = path.resolve(path.normalize(npmDir))
  emitter.emit('msg',
    `Checking npm version ${npmDir ? 'at given path' : '(live)'}...`
  )
  return expectCorrectNpmVersion(npmDir)
  .then(() => npmDir ||
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
    return checkForChanges()
  })
  .then(results => analyzeAndReport(results))
  .then(() => process.chdir(startDir))
  .catch(err => {
    process.chdir(startDir)
    if (!err.exitcode) err.exitcode = ERRS.FS_ACTION_FAIL
    addFaultMessage(err)
    throw err
  })
}

function checkForChanges() {
  const checked = {
    std: { files: {}, present: 0, missing: 0 },
    bak: { files: {}, present: 0, missing: 0 },
    added: { files: {}, present: 0, missing: 0 }
  }
  const topNewFiles =
    TGTS.ADDED_FILES.filter(f => !f.includes('/'))
    .map(f => f + '.js').concat(TGTS.ADDED_DIRS)
  const deepNewFiles =
    TGTS.ADDED_FILES.filter(f => f.includes('/'))

  function iterateChangedFiles(i) {
    if (i >= TGTS.CHANGED_FILES.length) return Promise.resolve()
    const stdName = TGTS.CHANGED_FILES[i]
    const stdFilePath = stdName + '.js'
    const backupFilePath = `${stdName}${BAKFLAG}.js`
    return accessAsync(path.normalize(backupFilePath))
    .then(() => {
      checked.bak.files[stdFilePath] = true
      checked.bak.present++
    })
    .catch(err => {
      if (err.code != 'ENOENT') throw err
      checked.bak.files[stdFilePath] = false
      checked.bak.missing++
    })
    .then(() => accessAsync(path.normalize(stdFilePath)))
    .then(() => {
      checked.std.files[stdFilePath] = true
      checked.std.present++
    })
    .catch(err => {
      if (err.code != 'ENOENT') throw err
      checked.std.files[stdFilePath] = false
      checked.std.missing++
    })
    .then(() => iterateChangedFiles(i+1))
  }

   /* istanbul ignore next: see comment in install.js */
  function checkForDeepNewFiles(i) {
    if (i >= deepNewFiles.length) return Promise.resolve()
    const itemName = deepNewFiles[i]
    const file = path.normalize(itemName) + '.js'
    return accessAsync(file).then(() => {
      checked.added.files[file] = true
      checked.added.present++
    })
    .catch(err => {
      if (err.code != 'ENOENT') throw err
      checked.added.files[file] = false
      checked.added.missing++
    })
    .then(() => checkForDeepNewFiles(i+1))
  }

  return iterateChangedFiles(0)
  .then(() => readdirAsync('.').then(entryList => {
    for (let item of topNewFiles) {
      if (entryList.includes(item)) {
        checked.added.files[item] = true
        checked.added.present++
      }
      else {
        checked.added.files[item] = false
        checked.added.missing++
      }
    }
  }))
  .then(() => checkForDeepNewFiles(0))
  .then(() => checked)
}

function getMissing(fileMap) {
  const missingList = []
  for (const filename in fileMap)
    if (!fileMap[filename]) missingList.push(filename)

  return missingList.join(', ')
}

function analyzeAndReport(data) {
  //console.log(data) // TEMP!!!
  if (!data.bak.present)
    emitter.emit('msg', 'No backups present.')
  else if (!data.bak.missing)
    emitter.emit('msg', 'All backups present.')
  else {
    emitter.emit('msg', 'Incomplete set of backups present.')
    emitter.emit('msg', `Missing: ${getMissing(data.bak.files)}`)
  }
  if (!data.std.missing)
    emitter.emit('msg', 'No standard files missing.')
  else {
    emitter.emit('msg', 'Some standard files are missing.')
    emitter.emit('msg', `Missing: ${getMissing(data.std.files)}`)
  }
  if (!data.added.present)
    emitter.emit('msg', 'No new files present.')
  else if (!data.added.missing)
    emitter.emit('msg', 'All expected new files present.')
  else {
    emitter.emit('msg', 'Some expected new files are missing.')
    emitter.emit('msg', `Missing: ${getMissing(data.added.files)}`)
  }

  // Summary
  if (!data.std.missing) {
    if (!data.bak.missing && !data.added.missing)
      emitter.emit('msg', 'npm-two-stage is fully installed at this location.')
    else if (data.bak.present || data.added.present)
      emitter.emit('msg', 'Incomplete npm-two-stage installation found - cleanup required.')
    else
      emitter.emit('msg', 'npm-two-stage is not installed at this location.')
  }
  else
    emitter.emit('msg', 'Files expected in a standard npm installation are missing!')
}
