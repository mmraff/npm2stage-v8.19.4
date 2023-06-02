const Emitter = require('events')
const path = require('path')

const tap = require('tap')

const mockFS = require('./lib/mock-fs')

const constants = require('../lib/constants')
// Made it immutable, so now we must hack it for testing:
const mockConstants = {
  targets: {
    CHANGED_FILES: [ ...constants.targets.CHANGED_FILES ],
    ADDED_FILES: [ ...constants.targets.ADDED_FILES ],
    ADDED_DIRS: [ ...constants.targets.ADDED_DIRS ]
  },
  backupFlag: constants.backupFlag,
  errorCodes: constants.errorCodes
}
const {
  targets: TGTS,
  backupFlag: BAKFLAG,
  errorCodes: ERRS
} = mockConstants

// Mock, not trying to be correct, just plausible:
const globalNpmRoot = process.platform == 'win32' ?
  'C:\\Program Files\\node_modules' : '/usr/local/lib/node_modules'

const REAL_cwd = process.cwd
const REAL_chdir = process.chdir
let execErr

const n2sMocksCfg = {
  graft: { throwIt: false },
  expectCorrectNpmVersion: { throwIt: false },
  removeAddedItems: { throwIt: false },
  restoreBackups: { throwIt: false },
  addFaultMessage: { throwIt: false }
}
function mockMaybeReject(fnName) {
  if (n2sMocksCfg[fnName].throwIt) {
    const err = new Error(`mock ${fnName} error`)
    if (n2sMocksCfg[fnName].code)
      err.code = n2sMocksCfg[fnName].code
    if (n2sMocksCfg[fnName].exitcode)
      err.exitcode = n2sMocksCfg[fnName].exitcode
    return Promise.reject(err)
  }
  return Promise.resolve()
}
function setN2SError(fnName, state, errCode, exitcode) {
  if (!n2sMocksCfg[fnName])
    throw new Error(`Unrecognized export "${fnName}", can't setN2SError`)
  n2sMocksCfg[fnName].throwIt = state
  n2sMocksCfg[fnName].code = errCode
  n2sMocksCfg[fnName].exitcode = exitcode
}

const n2sInstaller = tap.mock('../lib/install.js', {
  'fs': mockFS.mocks,
  '../lib/file-tools.js': {
    graft: () => mockMaybeReject('graft')
  },
  '../lib/constants.js': mockConstants,
  '../lib/shared.js': {
    emitter: new Emitter(),
    expectCorrectNpmVersion: () => mockMaybeReject('expectCorrectNpmVersion'),
    removeAddedItems: () =>
      mockMaybeReject('removeAddedItems').then(() => {
        const addedFiles = TGTS.ADDED_FILES.map(f => path.normalize(f) + '.js')
        for (const filepath of addedFiles) mockFS.removePath(filepath)
        // We don't have to worry about TGTS.ADDED_DIRS, because those were
        // glossed by the fileTools graft mock above.
      }),
    restoreBackups: () =>
      mockMaybeReject('restoreBackups').then(() => {
        const names = TGTS.CHANGED_FILES
        for (let i = 0; i < names.length; ++i) {
          const oldName = names[i]
          const backupName = path.normalize(`${oldName}${BAKFLAG}.js`)
          if (mockFS.hasPath(backupName)) {
            mockFS.removePath(backupName)
            mockFS.addPath(path.normalize(oldName + '.js'), 'file')
          }
          else {
            const err = new Error('Mock restoreBackups: could not find ' + backupName)
            err.exitcode = ERRS.FS_ACTION_FAIL
            throw err
          }
        }
      }),
    addFaultMessage: () => mockMaybeReject('addFaultMessage')
  },
  'child_process': {
    ...require('child_process'),
    exec (...args) {
      tap.equal(args.length, 2)
      if (execErr)
        return process.nextTick(() => args.pop()(execErr))

      const stderr = ''
      let stdout
      if (args[0] == 'npm root -g') {
        stdout = globalNpmRoot + '\n'
      }
      else stdout = 'whatever'
      return process.nextTick(() => args.pop()(null, { stdout, stderr }))
    }
  }
})

const notStrings = [ true, 42, { type: 'url' }, ['url'], () => 'url' ]
const messages = []
const msgPatterns = [
  /^Checking npm version/,
  /^Target npm home is/,
  /^Backing up files to be replaced:/,
  /^Copying into target directory:/   // just before chdir(src)
]
msgPatterns.splice(3, 0, ...TGTS.CHANGED_FILES.map(f => f + '.js'))

function expectStandardMessages(t, msgList, size) {
  if (msgList.length < size)
    return t.fail('Emitter gave less messages than expected')
  for (let i = 0; i < size; ++i) {
    if (!msgList[i].match(msgPatterns[i] || null))
      return t.fail(
        `Expected message #${i+1} was not found: ${msgPatterns[i]}`
      )
  }
}
function expectNoTestLeftovers(t, libPath) {
  for (const name of TGTS.CHANGED_FILES) {
    if (!mockFS.hasPath(path.join(libPath, name + '.js')))
      return t.fail('An expected original file was not found')
    if (mockFS.hasPath(path.join(libPath, name + BAKFLAG + '.js')))
      return t.fail('An unexpected backup file was found')
  }
  for (const name of TGTS.ADDED_FILES) {
    if (mockFS.hasPath(path.join(libPath, name + '.js')))
      return t.fail('An unexpected npm-two-stage file was found')
  }
}

tap.before(() => {
  n2sInstaller.installProgress.on('msg', (msg) => messages.push(msg))

  // Monkey patching! Necessary evil.
  process.chdir = mockFS.chdir
  process.cwd = mockFS.cwd
})
tap.afterEach(() => {
  mockFS.purge()
  messages.splice(0, messages.length)
})
tap.teardown(() => {
  n2sInstaller.installProgress.removeAllListeners()
  // Undo the monkey patching, just in case
  process.chdir = REAL_chdir
  process.cwd = REAL_cwd
})

/*
tap.test('Various kinds of bad input', t1 => {
  function nextBadInput(i) {
    if (i >= notStrings.length) return Promise.resolve()
    const value = notStrings[i]
    return t1.rejects(
      n2sInstaller.install(value),
      {
        message: 'Value passed to install function is not a string',
        exitcode: -666
      }
    )
    .then(() => nextBadInput(i+1))
  }
  nextBadInput(0).then(() => t1.end())
})
*/

tap.test('if checking the npm version at target gets a rejection', t1 => {
  const startDir = mockFS.cwd()
  const dummyPath = path.join(__dirname, 'NOSUCHDIR')
  setN2SError('expectCorrectNpmVersion', true, 'ENOENT')
  t1.rejects(n2sInstaller.install(dummyPath), { code: 'ENOENT' })
  .then(() =>{
    expectStandardMessages(t1, messages, 1)
    t1.equal(mockFS.cwd(), startDir)
  })
  .finally(() => {
    setN2SError('expectCorrectNpmVersion', false)
    t1.end()
  })
})

tap.test('target is global npm', t1 => {
  const startDir = mockFS.cwd()
  setN2SError('expectCorrectNpmVersion', true)
  t1.rejects(
    n2sInstaller.install(), 'rejection when expectCorrectNpmVersion rejects'
  )
  .then(() => {
    expectStandardMessages(t1, messages, 1)
    t1.equal(mockFS.cwd(), startDir)

    messages.splice(0, messages.length)
    setN2SError('expectCorrectNpmVersion', false)
    execErr = new Error('Mock exec: to make "npm root -g" fail')
    return t1.rejects(
      n2sInstaller.install(), 'rejection when exec "npm root -g" fails'
    )
  })
  .then(() => {
    expectStandardMessages(t1, messages, 1)
    t1.equal(mockFS.cwd(), startDir)
    messages.splice(0, messages.length)
    /*
      We don't need to pursue the entire chain of events for the global case,
      because it's identical to the local case after "npm root -g" succeeds.
      However, we do need to get past that step if we're to get 100% coverage.
    */
    execErr = null
    return t1.rejects(
      n2sInstaller.install(),
      {
        message: 'Unable to access lib directory at supposed npm path',
        exitcode: ERRS.BAD_NPM_INST
      },
      'rejection when global npm has no lib directory'
    )
  })
  .then(() => {
    expectStandardMessages(t1, messages, 2)
    t1.ok(messages[0].endsWith(' (live)...'))
    t1.ok(messages[1].endsWith(path.join(globalNpmRoot, 'npm')))
    t1.equal(mockFS.cwd(), startDir)
  })
  .finally(() => {
    t1.end()
  })
})

tap.test('explicit target location has no lib directory', t1 => {
  const startDir = mockFS.cwd()
  const dummyPath = path.join('a','b')
  t1.rejects(
    n2sInstaller.install(dummyPath),
    {
      message: 'Unable to access lib directory at supposed npm path',
      exitcode: ERRS.BAD_NPM_INST
    }
  )
  .then(() => {
    const resolvedPath = path.resolve(path.normalize(dummyPath))
    expectStandardMessages(t1, messages, 2)
    t1.ok(messages[0].endsWith(' at given path...'))
    t1.ok(messages[1].endsWith(resolvedPath))
    t1.equal(mockFS.cwd(), startDir)
  })
  .finally(() => {
    t1.end()
  })
})

tap.test('cannot chdir to lib directory in explicit target location', t1 => {
  const startDir = mockFS.cwd()
  const dummyPath = path.join('z','y')
  const resolvedLib = path.resolve(dummyPath, 'lib')
  const err = new Error('Mock chdir, dir exists but cannot access')
  err.code = 'EACCES'
  mockFS.addPath(resolvedLib, 'dir')
  mockFS.setChdirError(resolvedLib, err)
  t1.rejects(
    n2sInstaller.install(dummyPath),
    {
      message: new RegExp(err.message),
      exitcode: ERRS.FS_ACTION_FAIL
    }
  )
  .then(() =>
    t1.equal(mockFS.cwd(), startDir)
  )
  .finally(() => {
    mockFS.setChdirError(resolvedLib, null)
    t1.end()
  })
})

tap.test('explicit target location has leftovers', t1 => {
  const startDir = mockFS.cwd()
  // Assume that constants.targets.ADDED_FILES does not have enough
  // new files to thoroughly test expectNoLeftovers()
  TGTS.ADDED_FILES.push('fake', 'unreal/dummy', 'unreal/poser')

  // There are no new top-level files in npm-two-stage 8
  const topNewFiles = TGTS.ADDED_FILES.filter(f => !f.includes('/'))
    .map(f => f + '.js')

  const deepNewFiles = TGTS.ADDED_FILES.filter(f => f.includes('/'))
    .map(f => path.normalize(f) + '.js')

  const existingDirs = TGTS.CHANGED_FILES.filter(f => f.includes('/'))
    .map(f => path.dirname(path.normalize(f)))

  const dummyPath = path.join('b','c')
  const libPath = path.resolve(path.join(dummyPath, 'lib'))
  mockFS.addPath(libPath, 'dir') // So that our chdir mock does not throw ENOENT.
  // Make npm-two-stage top-level files show up in the npm/lib listing,
  // which is the 1st directory examined by expectNoLeftovers():
  mockFS.addDirList(libPath, topNewFiles)
  return t1.rejects(
    n2sInstaller.install(dummyPath),
    {
      message: /evidence of previous npm-two-stage installation/,
      exitcode: ERRS.LEFTOVERS
    }
  )
  .then(() => {
    t1.equal(mockFS.cwd(), startDir)

    const bakSuffix = BAKFLAG + '.js'
    // When looking for signs of leftovers, npm-two-stage install doesn't care
    // about the identity of backed-up files, only about the presence of any
    // files with the known backup suffix:
    const firstJSFile = 'install.js'
    const firstBackup = firstJSFile.replace(/\.js$/, bakSuffix)
    mockFS.addDirList(libPath, [ firstJSFile, firstBackup ]) // 1st is for coverage, line 88
    return t1.rejects(
      n2sInstaller.install(dummyPath),
      {
        message: new RegExp(`old backup ${firstBackup} in target location`),
        exitcode: ERRS.LEFTOVERS
      },
      'expect to find a backup file that is not the 1st file iterated'
    )
  })
  .then(() => {
    t1.equal(mockFS.cwd(), startDir)

    // By having no top-level backups, enable expectNoOldBackups() to go on to
    // the next directory, which we have not yet mocked, so that we can expect
    // it to fail: coverage, lines 78-9.
    mockFS.addDirList(libPath, [])
    return t1.rejects(
      n2sInstaller.install(dummyPath),
      { code: 'ENOENT', exitcode: ERRS.BAD_NPM_INST },
      'expect a required subdir of npm/lib/ to be missing'
    )
  })
  .then(() => {
    t1.equal(mockFS.cwd(), startDir)

    mockFS.addPath(path.join(libPath, path.dirname(deepNewFiles[1])), 'dir')
    mockFS.addPath(path.join(libPath, deepNewFiles[1]), 'file')
    // Actual contents of mocked directories not important; we only need to
    // reach successful completion of expectNoOldBackups():
    for (const d of existingDirs)
      mockFS.addDirList(path.join(libPath, d), [])
    return t1.rejects(
      n2sInstaller.install(dummyPath),
      {
        message: /evidence of previous npm-two-stage installation/,
        exitcode: ERRS.LEFTOVERS
      },
      'expect to find a leftover deep new file'
    )
  })
  .then(() =>
    t1.equal(mockFS.cwd(), startDir)
  )
  .finally(() => {
    TGTS.ADDED_FILES = [ ...constants.targets.ADDED_FILES ]
  })
})

tap.test('explicit target location is missing a required file', t1 => {
  const startDir = mockFS.cwd()
  const existingDirs = TGTS.CHANGED_FILES.filter(f => f.includes('/'))
    .map(f => path.dirname(path.normalize(f)))
  const dummyPath = path.join('c','d')
  const libPath = path.resolve(path.join(dummyPath, 'lib'))
  mockFS.addPath(libPath, 'dir')
  mockFS.addDirList(libPath, [])
  for (const d of existingDirs)
    mockFS.addDirList(path.join(libPath, d), [])
  // That's enough to get us to the next phase.
  // We also need to make the 1st iteration of backUpOldFiles succeed, for the
  // sake of coverage (lines 120-1), so we mock the presence of the 1st file
  // that is to be renamed:
  const firstFile = path.normalize(TGTS.CHANGED_FILES[0])
  mockFS.addPath(path.join(libPath, firstFile + '.js'), 'file')
  t1.rejects(
    n2sInstaller.install(dummyPath), { exitcode: ERRS.BAD_NPM_INST },
    'expect a file we want to back up, after the 1st, to be missing'
  )
  .then(() => {
    const wantedMsgCount = 3 + TGTS.CHANGED_FILES.length
    expectStandardMessages(t1, messages, wantedMsgCount)
    t1.ok(messages[6].match('Error while renaming files; restoring original names...'))
    t1.equal(mockFS.hasPath(path.join(libPath, `${firstFile}${BAKFLAG}.js`)), false)
    t1.equal(mockFS.hasPath(path.join(libPath, firstFile + '.js')), true)
    t1.equal(mockFS.cwd(), startDir)
  })
  .finally(() => {
    t1.end()
  })
})

tap.test('explicit target location good, but project src bad', t1 => {
  const startDir = mockFS.cwd()
  const existingDirs = TGTS.CHANGED_FILES.filter(f => f.includes('/'))
    .map(f => path.dirname(path.normalize(f)))
  const dummyPath = path.join('d','e')
  const libPath = path.resolve(path.join(dummyPath, 'lib'))
  mockFS.addPath(libPath, 'dir')
  mockFS.addDirList(libPath, [])
  for (const d of existingDirs)
    mockFS.addDirList(path.join(libPath, d), [])
  for (let i = 0; i < TGTS.CHANGED_FILES.length; ++i) {
    const nextFile = path.normalize(TGTS.CHANGED_FILES[i])
    mockFS.addPath(path.join(libPath, nextFile + '.js'), 'file')
  }
  const srcPath = path.resolve(
    __dirname, '../node_modules/npm-two-stage/src'
  )
  // But we don't immediately mock existence of that;
  // coverage, catch after try { process.chdir(srcDir) }
  t1.rejects(
    n2sInstaller.install(dummyPath), { exitcode: ERRS.BAD_PROJECT },
    'expect to fail on chdir to nonexistent project src directory'
  )
  .then(() => {
    const wantedMsgCount = 3 + TGTS.CHANGED_FILES.length + 1
    expectStandardMessages(t1, messages, wantedMsgCount)
    expectNoTestLeftovers(t1, libPath)
    t1.equal(mockFS.cwd(), startDir)
    messages.splice(0, messages.length)

    const firstChangedFile = path.normalize(TGTS.CHANGED_FILES[0]) + '.js'
    mockFS.addPath(srcPath, 'dir')
    mockFS.addPath(path.join(srcPath, firstChangedFile), 'file')
    return t1.rejects(
      n2sInstaller.install(dummyPath), { exitcode: ERRS.BAD_PROJECT },
      'expect to fail when a project src file other than the 1st is missing'
    )
  })
  .then(() => {
    const wantedMsgCount = 3 + TGTS.CHANGED_FILES.length + 1
    expectStandardMessages(t1, messages, wantedMsgCount)
    expectNoTestLeftovers(t1, libPath)
    t1.equal(mockFS.cwd(), startDir)
  })
  .finally(() => {
    t1.end()
  })
})

tap.test('explicit target location, no problems', t1 => {
  const startDir = mockFS.cwd()
  const n2sFiles = TGTS.CHANGED_FILES.concat(TGTS.ADDED_FILES)
    .map(f => path.normalize(f + '.js'))
  const existingDirs = TGTS.CHANGED_FILES.filter(f => f.includes('/'))
    .map(f => path.dirname(path.normalize(f)))
  const dummyPath = path.join('e','f')
  const libPath = path.resolve(path.join(dummyPath, 'lib'))
  const srcPath = path.resolve(
    __dirname, '../node_modules/npm-two-stage/src'
  )
  mockFS.addPath(libPath, 'dir')
  mockFS.addPath(srcPath, 'dir')
  for (const d of existingDirs) {
    mockFS.addPath(path.join(libPath, d), 'dir')
    mockFS.addPath(path.join(srcPath, d), 'dir')
  }
  for (let i = 0; i < TGTS.CHANGED_FILES.length; ++i) {
    const nextFile = path.normalize(TGTS.CHANGED_FILES[i])
    mockFS.addPath(path.join(libPath, nextFile + '.js'), 'file')
  }
  for (let i = 0; i < n2sFiles.length; ++i)
    mockFS.addPath(path.join(srcPath, n2sFiles[i]), 'file')
  t1.resolves(n2sInstaller.install(dummyPath), 'success case')
  .then(() => {
    t1.equal(mockFS.cwd(), startDir)

    for (const name of TGTS.CHANGED_FILES) {
      t1.equal(mockFS.hasPath(path.join(libPath, name + '.js')), true)
      t1.equal(mockFS.hasPath(path.join(libPath, name + BAKFLAG + '.js')), true)
    }
    for (const name of TGTS.ADDED_FILES) {
      t1.equal(mockFS.hasPath(path.join(libPath, name + '.js')), true)
    }
    // We mock graft, thus the added directories won't be there
  })
  .finally(() => {
    t1.end()
  })
})
