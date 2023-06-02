const Emitter = require('events')
const path = require('path')

const tap = require('tap')

const mockFS = require('./lib/mock-fs')

const {
  targets: TGTS,
  errorCodes: ERRS
} = require('../lib/constants')

// Mock, not trying to be correct, just plausible:
const globalNpmRoot = process.platform == 'win32' ?
  'C:\\Program Files\\node_modules' : '/usr/local/lib/node_modules'

const REAL_cwd = process.cwd
const REAL_chdir = process.chdir
let execErr

const n2sMocksCfg = {
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

const uninstaller = tap.mock('../lib/uninstall.js', {
  'fs': mockFS.mocks,
  '../lib/shared.js': {
    emitter: new Emitter(),
    expectCorrectNpmVersion: () => mockMaybeReject('expectCorrectNpmVersion'),
    removeAddedItems: () => mockMaybeReject('removeAddedItems'),
    restoreBackups: () => mockMaybeReject('restoreBackups'),
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
  /^Removing items added by npm-two-stage install:/,
  /^Restoring backed-up original files:/
]
const toRemove =
  TGTS.CHANGED_FILES.concat(TGTS.ADDED_FILES).map(f => f + '.js')
  .concat(TGTS.ADDED_DIRS.map(d => d + '/'))
msgPatterns.splice(3, 0, ...toRemove)

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

tap.before(() => {
  uninstaller.uninstallProgress.on('msg', (msg) => messages.push(msg))

  // Monkey patching! Necessary evil.
  process.chdir = mockFS.chdir
  process.cwd = mockFS.cwd
})
tap.afterEach(() => {
  mockFS.purge()
  messages.splice(0, messages.length)
})
tap.teardown(() => {
  uninstaller.uninstallProgress.removeAllListeners()
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
      uninstaller.uninstall(value),
      {
        message: 'Value passed to uninstall function is not a string',
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
  t1.rejects(uninstaller.uninstall(dummyPath), { code: 'ENOENT' })
  .then(() => {
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
    uninstaller.uninstall(), 'rejection when expectCorrectNpmVersion rejects'
  )
  .then(() => {
    expectStandardMessages(t1, messages, 1)
    t1.equal(mockFS.cwd(), startDir)

    messages.splice(0, messages.length)
    setN2SError('expectCorrectNpmVersion', false)
    execErr = new Error('Mock exec: to make "npm root -g" fail')
    return t1.rejects(
      uninstaller.uninstall(), 'rejection when exec "npm root -g" fails'
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
      uninstaller.uninstall(),
      {
        message: 'Unable to access lib directory at supposed npm path',
        exitcode: ERRS.BAD_NPM_INST
      },
      'rejection when global npm has no lib directory' // !?
    )
  })
  .then(() => {
    expectStandardMessages(t1, messages, 2)
    t1.ok(messages[0].endsWith('(live)...'))
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
    uninstaller.uninstall(dummyPath),
    {
      message: 'Unable to access lib directory at supposed npm path',
      exitcode: ERRS.BAD_NPM_INST
    }
  )
  .then(() => {
    const resolvedPath = path.resolve(path.normalize(dummyPath))
    expectStandardMessages(t1, messages, 2)
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
  mockFS.addPath(resolvedLib)
  mockFS.setChdirError(resolvedLib, err)
  t1.rejects(
    uninstaller.uninstall(dummyPath),
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

tap.test('explicit target location, failure to remove added files', t1 => {
  const startDir = mockFS.cwd()
  const dummyPath = path.join('b','c')
  const resolvedLib = path.resolve(dummyPath, 'lib')
  mockFS.addPath(resolvedLib)
  setN2SError('removeAddedItems', true, 'ENOENT')
  t1.rejects(
    uninstaller.uninstall(dummyPath), { exitcode: ERRS.FS_ACTION_FAIL }
  )
  .then(() => {
    const wantedMsgCount =
      4 + TGTS.ADDED_FILES.length + TGTS.ADDED_DIRS.length
    expectStandardMessages(t1, messages, 9)
    t1.equal(mockFS.cwd(), startDir)
  })
  .finally(() => {
    setN2SError('removeAddedItems', false)
    t1.end()
  })
})

tap.test('explicit target location, failure to restore backups', t1 => {
  const startDir = mockFS.cwd()
  const dummyPath = path.join('c','d')
  const resolvedLib = path.resolve(dummyPath, 'lib')
  mockFS.addPath(resolvedLib)
  setN2SError('restoreBackups', true, 'EACCES')
  t1.rejects(
    uninstaller.uninstall(dummyPath), { exitcode: ERRS.FS_ACTION_FAIL }
  )
  .then(() => {
    const wantedMsgCount =
      4 + TGTS.ADDED_FILES.length + TGTS.ADDED_DIRS.length
      + TGTS.CHANGED_FILES.length
    expectStandardMessages(t1, messages, wantedMsgCount)
    t1.equal(mockFS.cwd(), startDir)
  })
  .finally(() => {
    setN2SError('restoreBackups', false)
    t1.end()
  })
})

tap.test('explicit target location, no problems', t1 => {
  const startDir = mockFS.cwd()
  const dummyPath = path.join('d','e')
  const resolvedLib = path.resolve(dummyPath, 'lib')
  mockFS.addPath(resolvedLib)
  t1.resolves(uninstaller.uninstall(dummyPath), 'success case')
  .then(() => {
    const wantedMsgCount =
      4 + TGTS.ADDED_FILES.length + TGTS.ADDED_DIRS.length
      + TGTS.CHANGED_FILES.length
    expectStandardMessages(t1, messages, wantedMsgCount)
    t1.equal(mockFS.cwd(), startDir)

    // The uninstall actions are all done by functions of shared.js that are
    // entirely mocked here, so there are no mockFS artifacts to look for,
    // unlike in the install test.
  })
  .finally(() => {
    t1.end()
  })
})

