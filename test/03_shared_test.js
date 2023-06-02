const Emitter = require('events')
const path = require('path')

const tap = require('tap')

const {
  targetVersion: EXPECTED_NPM_VER,
  targets: TGTS,
  backupFlag: BAKFLAG,
  errorCodes: ERRS
} = require('../lib/constants')

const mockFS = require('./lib/mock-fs')

const REAL_cwd = process.cwd
const REAL_chdir = process.chdir
let mockVersion
let execErr

const n2sMocksCfg = {
  prune: { throwIt: false },
  removeFiles: { throwIt: false }
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

const shared = tap.mock('../lib/shared.js', {
  'fs': mockFS.mocks, // shared.js uses readFile and rename
  '../lib/file-tools.js': {
    prune: () => mockMaybeReject('prune'),
    removeFiles: () => mockMaybeReject('removeFiles'),
    setEmitter: () => {}
  },
  'child_process': {
    ...require('child_process'),
    exec (...args) {
      tap.equal(args.length, 2)
      if (execErr)
        return process.nextTick(() => args.pop()(execErr))

      const stderr = ''
      const stdout = args[0] == 'npm --version' ?
        mockVersion + '\n' : 'whatever'
      return process.nextTick(() => args.pop()(null, { stdout, stderr }))
    }
  }
})

const messages = []

tap.before(() => {
  shared.emitter.on('msg', (msg) => messages.push(msg))
})
tap.afterEach(() => {
  mockFS.purge()
  messages.splice(0, messages.length)
})
tap.teardown(() => {
  shared.emitter.removeAllListeners()
})

tap.test('expectCorrectNpmVersion', t1 => {
  const mockNpmDir = 'imaginary/location/npm'
  execErr = new Error('mock exec: to trigger NO_NPM')
  t1.rejects(shared.expectCorrectNpmVersion(), { exitcode: ERRS.NO_NPM })
  .then(() => {
    execErr = undefined
    mockVersion = '999.999.999'
    return t1.rejects(
      shared.expectCorrectNpmVersion(), { exitcode: ERRS.WRONG_NPM_VER }
    )
  })
  .then(() => {
    mockVersion = EXPECTED_NPM_VER
    return t1.resolves(shared.expectCorrectNpmVersion())
  })
  .then(() => {
    mockFS.addPath(mockNpmDir, 'dir')
    return t1.rejects(
      shared.expectCorrectNpmVersion(mockNpmDir),
      { exitcode: ERRS.NO_NPM },
      'expect rejection because no package.json'
    )
  })
  .then(() => {
    const err = new Error('mock readFile: something unexpected')
    err.code = 'EACCES'
    mockFS.setError('readFile', path.join(mockNpmDir, 'package.json'), err)
    return t1.rejects(
      shared.expectCorrectNpmVersion(mockNpmDir),
      { exitcode: ERRS.BAD_NPM_INST },
      'expect rejection from error trying to read package.json, not ENOENT'
    )
  })
  .then(() => {
    mockFS.setError('readFile', path.join(mockNpmDir, 'package.json'), null)
    mockFS.addFileContents(
      path.join(mockNpmDir, 'package.json'), "THIS IS NOT JSON"
    )
    return t1.rejects(
      shared.expectCorrectNpmVersion(mockNpmDir),
      {
        message: new RegExp(`failed to parse package.json at ${mockNpmDir}`),
        exitcode: ERRS.BAD_NPM_INST
      }
    )
  })
  .then(() => {
    const pkg = { name: 'this-is-not-npm', version: '9.9.9' }
    mockFS.addFileContents(
      path.join(mockNpmDir, 'package.json'),
      String.fromCharCode(0xFEFF) + JSON.stringify(pkg)
    )
    return t1.rejects(
      shared.expectCorrectNpmVersion(mockNpmDir),
      {
        message: new RegExp(`package at ${mockNpmDir} is not npm`),
        exitcode: ERRS.NO_NPM
      }
    )
  })
  .then(() => {
    const pkg = { name: 'npm', version: '999.999.999' }
    mockFS.addFileContents(
      path.join(mockNpmDir, 'package.json'), JSON.stringify(pkg)
    )
    return t1.rejects(
      shared.expectCorrectNpmVersion(mockNpmDir),
      {
        message: /wrong version of npm: found /,
        exitcode: ERRS.WRONG_NPM_VER
      }
    )
  })
  .then(() => {
    const pkg = { name: 'npm', version: EXPECTED_NPM_VER }
    mockFS.addFileContents(
      path.join(mockNpmDir, 'package.json'), JSON.stringify(pkg)
    )
    return t1.resolves(shared.expectCorrectNpmVersion(mockNpmDir))
  })
  .finally(() => {
    t1.end()
  })
})

// TODO: see if there's a way to verify that ft has the same emitter as
// shared.emitter (look above where we're mocking filetools)

tap.test('removeAddedItems', t1 => {
  const startDir = mockFS.cwd()
  const mockNpmLibDir = 'imaginary/npm/lib'
  mockFS.addPath(mockNpmLibDir, 'dir')
  mockFS.chdir(mockNpmLibDir)
  setN2SError('removeFiles', true)
  // shared doesn't care about error code; sets the exitcode to FS_ACTION_FAIL
  t1.rejects(
    shared.removeAddedItems(), { exitcode: ERRS.FS_ACTION_FAIL },
    'expect fileTools.removeFiles() rejection to be forwarded, with added exitcode'
  )
  .then(() => {
    setN2SError('removeFiles', false)
    // Next thing after removeFiles is to prune added directories.
    setN2SError('prune', true, 'ENOENT')
    return t1.resolves(
      shared.removeAddedItems(),
      'expect attempt to remove nonexistent directories to be a success'
    )
    .then(() => {
      t1.equal(messages.length, TGTS.ADDED_DIRS.length)
      for (let i = 0; i < TGTS.ADDED_DIRS.length; ++i) {
        const dir = TGTS.ADDED_DIRS[i]
        t1.match(
          messages[i], new RegExp(`Could not find directory ${dir} for removal`)
        )
      }
    })
  })
  .then(() => {
    setN2SError('prune', true, 'EACCES')
    return t1.rejects(
      shared.removeAddedItems(),
      { code: 'EACCES', exitcode: ERRS.FS_ACTION_FAIL },
      'expect fileTools.prune() non-ENOENT rejection to be forwarded'
    )
  })
  .then(() => {
    setN2SError('prune', false)
    return t1.resolves(shared.removeAddedItems())
  })
  .finally(() => {
    mockFS.chdir(startDir)
    t1.end()
  })
})

tap.test('restoreBackups', t1 => {
  const startDir = mockFS.cwd()
  const mockNpmLibDir = 'imaginary/npm/lib'
  mockFS.addPath(mockNpmLibDir, 'dir')
  mockFS.chdir(mockNpmLibDir)
  // Add the 1st backup file, so we get coverage of the recursing line
  // in restoreNext()
  const backupName = `${TGTS.CHANGED_FILES[0]}${BAKFLAG}.js`
  mockFS.addPath(backupName, 'file')
  t1.rejects(
    shared.restoreBackups(), { exitcode: ERRS.FS_ACTION_FAIL },
    'expect rejection if any backup files are not present'
  )
  .then(() => {
    // Expect the added file to have been renamed
    t1.equal(mockFS.hasPath(backupName), false)
    t1.equal(mockFS.hasPath(TGTS.CHANGED_FILES[0] + '.js'), true)
    t1.equal(messages.length, 1)
    t1.match(messages[0], `Unable to restore ${TGTS.CHANGED_FILES[1] + '.js'}`)

    messages.splice(0, messages.length)
    mockFS.removePath(TGTS.CHANGED_FILES[0] + '.js')
    for (const name of TGTS.CHANGED_FILES) {
      mockFS.addPath(`${name}${BAKFLAG}.js`, 'file')
    }
    return t1.resolves(shared.restoreBackups())
  })
  .then(() => {
    t1.equal(messages.length, 0)
    for (const name of TGTS.CHANGED_FILES) {
      t1.equal(mockFS.hasPath(`${name}${BAKFLAG}.js`), false)
      t1.equal(mockFS.hasPath(name + '.js'), true)
    }
  })
  .finally(() => {
    mockFS.chdir(startDir)
    t1.end()
  })
})

tap.test('addFaultMessage', t1 => {
  //t1.equal(messages.length, 1)
  //messages.splice(0, messages.length)
  t1.throws(() => shared.addFaultMessage())
  t1.equal(messages.length, 0)
  t1.doesNotThrow(() => shared.addFaultMessage('Does this count?'))
  t1.equal(messages.length, 0)
  shared.addFaultMessage(new Error('Will not be emitted')) // no exitcode
  t1.equal(messages.length, 0)
  shared.addFaultMessage(Object.assign(
    new Error('Will not be emitted'), { exitcode: 42 } // unrecognized value
  ))
  t1.equal(messages.length, 0)

  shared.addFaultMessage(Object.assign(
    new Error('Hello'), { exitcode: ERRS.WRONG_NPM_VER }
  ))
  t1.equal(messages.length, 1)
  t1.equal(
    messages[0],
    'Wrong version of npm for this version of npm-two-stage.'
  )
  messages.splice(0)

  shared.addFaultMessage(Object.assign(
    new Error('Hola'), { exitcode: ERRS.NO_NPM }
  ))
  t1.equal(messages.length, 1)
  t1.equal(
    messages[0],
    'npm not found at given location.'
  )
  messages.splice(0)

  shared.addFaultMessage(Object.assign(
    new Error('Howdy'), { exitcode: ERRS.BAD_NPM_INST }
  ))
  t1.equal(messages.length, 1)
  t1.equal(messages[0], 'Howdy')

  t1.end()
})
