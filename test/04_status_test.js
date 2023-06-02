const Emitter = require('events')
const path = require('path')

const tap = require('tap')

const mockFS = require('./lib/mock-fs')

const constants = require('../lib/constants')
// Made it immutable, so now we must do backflips to modify it for testing:
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

// Assume that constants.targets.ADDED_FILES does not have enough new files
// to thoroughly test expectNoLeftovers().
// This will also be significant down in test named
// 'target has signs of npm-two-stage installation'
TGTS.ADDED_FILES.push('fake', 'unreal/dummy', 'unreal/poser')

// Mock, not trying to be correct, just plausible:
const globalNpmRoot = process.platform == 'win32' ?
  'C:\\Program Files\\node_modules' : '/usr/local/lib/node_modules'

const REAL_cwd = process.cwd
const REAL_chdir = process.chdir
let execErr

const n2sMocksCfg = {
  expectCorrectNpmVersion: { throwIt: false },
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

const n2sStatus = tap.mock('../lib/status.js', {
  'fs': mockFS.mocks,
  '../lib/constants.js': mockConstants,
  '../lib/shared.js': {
    emitter: new Emitter(),
    expectCorrectNpmVersion: () => mockMaybeReject('expectCorrectNpmVersion'),
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
  {
    failure: /^Wrong version of npm/,
    success: /^Target npm home is/
  },
  {
    all: /^All backups/,
    none: /^No backups/,
    some: /^Incomplete set of backups/
  },
  {
    none: /^No standard files missing/,
    some: /^Some standard files are missing/
  },
  {
    all: /^All expected new files/,
    none: /^No new files present/,
    some: /^Some expected new files/
  },
  { // Summary line
    full: /fully installed/,
    not: /not installed/,
    partial: /^Incomplete/,
    bad: /^Files expected .+ are missing/
  }
]

function expectStandardMessages(t, size, hints) {
  t.equal(messages.length, size)
  t.match(messages[0], msgPatterns[0])
  for (let msgIdx = 1, hintIdx = 1; msgIdx < size; ++msgIdx, ++hintIdx) {
    t.match(messages[msgIdx], msgPatterns[hintIdx][hints[hintIdx]])
    if (hints[hintIdx] == 'some')
      t.match(messages[++msgIdx], /^Missing:/)
  }
}

tap.before(() => {
  n2sStatus.statusProgress.on('msg', (msg) => messages.push(msg))

  // Monkey patching! Necessary evil.
  process.chdir = mockFS.chdir
  process.cwd = mockFS.cwd
})
tap.afterEach(() => {
  mockFS.purge()
  messages.splice(0, messages.length)
})
tap.teardown(() => {
  n2sStatus.statusProgress.removeAllListeners()
  // Undo the monkey patching, just in case
  process.chdir = REAL_chdir
  process.cwd = REAL_cwd
})

/* Input validation removed
tap.test('Various kinds of bad input', t1 => {
  function nextBadInput(i) {
    if (i >= notStrings.length) return Promise.resolve()
    const value = notStrings[i]
    return t1.rejects(
      n2sStatus.getStatus(value),
      {
        message: 'Value passed to getStatus function is not a string',
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
  const testNpmDir = 'test/npm'
  setN2SError('expectCorrectNpmVersion', true, 'ENOENT')
  t1.rejects(n2sStatus.getStatus('NOSUCHDIR'), { code: 'ENOENT' })
  .then(() => {
    t1.equal(messages.length, 1)
    t1.equal(messages[0], 'Checking npm version at given path...')
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
    n2sStatus.getStatus(), 'rejection when expectCorrectNpmVersion rejects'
  )
  .then(() => {
    t1.equal(messages.length, 1)
    t1.equal(messages[0], 'Checking npm version (live)...')
    t1.equal(mockFS.cwd(), startDir)

    messages.splice(0, messages.length)
    setN2SError('expectCorrectNpmVersion', false)
    execErr = new Error('Mock exec: to make "npm root -g" fail')
    return t1.rejects(
      n2sStatus.getStatus(), 'rejection when exec "npm root -g" fails'
    )
  })
  .then(() => {
    t1.equal(messages.length, 1)
    t1.equal(messages[0], 'Checking npm version (live)...')
    t1.equal(mockFS.cwd(), startDir)
    messages.splice(0, messages.length)
    // We don't need to pursue the entire chain of events for the global case,
    // because it's identical to the local case after "npm root -g" succeeds.
    // However, we do need to get past that step if we're to get 100% coverage.
    execErr = null
    return t1.rejects(
      n2sStatus.getStatus(),
      {
        message: 'Unable to access lib directory at supposed npm path',
        exitcode: ERRS.BAD_NPM_INST
      },
      'rejection when global npm has no lib directory' // !?
    )
  })
  .then(() => {
    t1.equal(messages.length, 2)
    t1.equal(messages[0], 'Checking npm version (live)...')
    t1.equal(messages[1], 'Target npm home is ' + path.join(globalNpmRoot, 'npm'))
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
    n2sStatus.getStatus(dummyPath),
    {
      message: 'Unable to access lib directory at supposed npm path',
      exitcode: ERRS.BAD_NPM_INST
    }
  )
  .then(() => {
    const resolvedPath = path.resolve(path.normalize(dummyPath))
    t1.equal(messages[0], 'Checking npm version at given path...')
    t1.equal(messages[1], 'Target npm home is ' + resolvedPath)
    t1.equal(mockFS.cwd(), startDir)
  })
  .finally(() => {
    t1.end()
  })
})

tap.test('cannot chdir to lib directory in explicit target location', t1 => {
  const startDir = mockFS.cwd()
  const dummyPath = path.join('b','c')
  const resolvedLib = path.resolve(dummyPath, 'lib')
  const err = new Error('Mock chdir, dir exists but cannot access')
  err.code = 'EACCES'
  mockFS.addPath(resolvedLib)
  mockFS.setChdirError(resolvedLib, err)
  t1.rejects(
    n2sStatus.getStatus(dummyPath),
    {
      message: new RegExp(err.message), exitcode: ERRS.FS_ACTION_FAIL
    }
  )
  .then(() => {
    const resolvedPath = path.resolve(path.normalize(dummyPath))
    t1.equal(messages[0], 'Checking npm version at given path...')
    t1.equal(messages[1], 'Target npm home is ' + resolvedPath)
    t1.equal(mockFS.cwd(), startDir)
  })
  .finally(() => {
    mockFS.setChdirError(resolvedLib, null)
    t1.end()
  })
})

tap.test('Access problems within the target directory', t1 => {
  const startDir = mockFS.cwd()
  const dummyPath = path.join('c','d')
  const resolvedPath = path.resolve(path.normalize(dummyPath))
  const resolvedLib = path.resolve(dummyPath, 'lib')
  const firstBackup = path.join(
    resolvedLib, `${TGTS.CHANGED_FILES[0]}${BAKFLAG}.js`
  )
  const firstDeepNew = path.join(
    resolvedLib, TGTS.ADDED_FILES.filter(f => f.includes('/'))[0] + '.js'
  )
  const err = new Error('test: cannot access 1st backup file')
  err.code = 'EACCES'
  mockFS.setError('access', firstBackup, err)
  mockFS.addDirList(resolvedLib, [])
  t1.rejects(
    n2sStatus.getStatus(dummyPath), err,
    'expect non-ENOENT error on backup file access to cause rejection'
  )
  .then(() => {
    expectStandardMessages(t1, 2, [ null, 'success' ])
    t1.equal(messages[1], 'Target npm home is ' + resolvedPath)
    t1.equal(mockFS.cwd(), startDir)
    messages.splice(0, messages.length)

    const err = new Error('mock error, accessing deep new file')
    err.code = 'EACCES'
    mockFS.setError('access', firstDeepNew, err)
    mockFS.setError('access', firstBackup, null)
    return t1.rejects(
      n2sStatus.getStatus(dummyPath), err,
      'expect non-ENOENT error on deep new file error to cause rejection'
    )
  })
  .then(() => {
    expectStandardMessages(t1, 2, [ null, 'success' ])
    t1.equal(messages[1], 'Target npm home is ' + resolvedPath)
    t1.equal(mockFS.cwd(), startDir)
  })
  .finally(() => {
    mockFS.setError('access', firstBackup, null)
    mockFS.setError('access', firstDeepNew, null)
    t1.end()
  })
})

tap.test('lib directory at target location is missing expected files', t1 => {
  const startDir = mockFS.cwd()
  const dummyPath = path.join('d','e')
  const resolvedLib = path.resolve(dummyPath, 'lib')
  mockFS.addDirList(resolvedLib, [])
  t1.resolves(n2sStatus.getStatus(dummyPath))
  .then(() => {
    expectStandardMessages(
      t1, 7, [ null, 'success', 'none', 'some', 'none', 'bad' ]
    )
    t1.equal(mockFS.cwd(), startDir)
  })
  .finally(() => {
    t1.end()
  })
})

tap.test('target looks like a complete unmodified npm installation', t1 => {
  const startDir = mockFS.cwd()
  const dummyPath = path.join('d','e')
  const resolvedLib = path.resolve(dummyPath, 'lib')
  const originalFiles = TGTS.CHANGED_FILES.map(f => f + '.js')
  const topOrigFiles = originalFiles.filter(f => !f.includes('/'))
  mockFS.addDirList(resolvedLib, topOrigFiles)
  mockFS.chdir(resolvedLib)
  for (const fpath of originalFiles)
    mockFS.addPath(fpath, 'file')
  mockFS.chdir(startDir)
  t1.resolves(n2sStatus.getStatus(dummyPath))
  .then(() => {
    expectStandardMessages(
      t1, 6, [ null, 'success', 'none', 'none', 'none', 'not' ]
    )
    t1.equal(mockFS.cwd(), startDir)
  })
  .finally(() => {
    t1.end()
  })
})

tap.test('target has signs of npm-two-stage installation', t1 => {
  const startDir = mockFS.cwd()
  const dummyPath = path.join('e','f')
  const resolvedLib = path.resolve(dummyPath, 'lib')

  const allBaseNames = TGTS.CHANGED_FILES.concat(TGTS.ADDED_FILES)
    .concat(TGTS.CHANGED_FILES.map(f => f + BAKFLAG))
  const allFiles = allBaseNames.map(f => f + '.js')
  const allTopLevel = allFiles.filter(f => !f.includes('/'))
    .concat(TGTS.ADDED_DIRS)

  // Since the dirlist of lib is only searched for topNewFiles, it's tempting
  // to use only that in addDirList; however, this is based on knowledge of the
  // implementation, which is against my testing principles.
  mockFS.addDirList(resolvedLib, allTopLevel)
  mockFS.chdir(resolvedLib)
  for (const fpath of allFiles) mockFS.addPath(fpath, 'file')
  mockFS.chdir(startDir)
  t1.resolves(
    n2sStatus.getStatus(dummyPath),
    'expect report of complete npm-two-stage installation'
  )
  .then(() => {
    expectStandardMessages(
      t1, 6, [ null, 'success', 'all', 'none', 'all', 'full' ]
    )
    t1.equal(mockFS.cwd(), startDir)

    const choice = TGTS.CHANGED_FILES.slice(-1)[0]
    const choicePath = path.join(resolvedLib, `${choice}${BAKFLAG}.js`)
    mockFS.removePath(choicePath)
    messages.splice(0, messages.length)
    return t1.resolves(
      n2sStatus.getStatus(dummyPath),
      'expect report of npm-two-stage installation missing a backup file'
    )
  })
  .then(() => {
    expectStandardMessages(
      t1, 7, [ null, 'success', 'some', 'none', 'all', 'partial' ]
    )
    t1.equal(mockFS.cwd(), startDir)

    const choice = TGTS.ADDED_FILES.slice(-1)[0]
    const choicePath = path.join(resolvedLib, choice + '.js')
    mockFS.removePath(choicePath)
    messages.splice(0, messages.length)
    return t1.resolves(
      n2sStatus.getStatus(dummyPath),
      'expect report of npm-two-stage installation missing an added file'
    )
  })
  .then(() => {
    expectStandardMessages(
      t1, 8, [ null, 'success', 'some', 'none', 'some', 'partial' ]
    )
    t1.equal(mockFS.cwd(), startDir)

  })
  .finally(() => {
    t1.end()
  })
})

