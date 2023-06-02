const semver = require('semver')
const tap = require('tap')

const C = require('../lib/constants')

tap.test('constants module features', t1 => {
  t1.type(C.targetVersion, 'string')
  t1.equal(semver.valid(C.targetVersion), C.targetVersion)

  t1.type(C.targets, 'object')
  t1.hasStrict(C.targets, {
    CHANGED_FILES: [], ADDED_FILES: [], ADDED_DIRS: []
  })
  for (const tgtList in C.targets)
    for (const item of tgtList) {
      t1.type(item, 'string')
      t1.equal(item.length > 0, true)
    }

  t1.type(C.backupFlag, 'string')
  t1.equal(C.backupFlag.length > 0, true)

  t1.type(C.errorCodes, 'object')
  t1.hasOwnProps(C.errorCodes, [
      'BAD_PROJECT', 'NO_NPM', 'WRONG_NPM_VER', 'BAD_NPM_INST',
      'LEFTOVERS', 'FS_ACTION_FAIL'
    ],
    'expect specific error code names'
  )
  const seenCodeValues = new Set()
  for (const code in C.errorCodes) {
    const value = C.errorCodes[code]
    t1.type(value, 'number')
    t1.equal(seenCodeValues.has(value), false)
    seenCodeValues.add(value)
  }

  t1.end()
})

tap.test('constants module immutability', t1 => {
  const originalTgtVersion = C.targetVersion
  C.targetVersion = '999.999.999'
  t1.equal(C.targetVersion, originalTgtVersion)

  const originalTgts = {}
  for (const listName in C.targets) {
    originalTgts[listName] = [ ...C.targets[listName] ]
  }
  C.targets = [ "NOT GOOD" ]
  t1.same(C.targets, originalTgts)

  for (const listName in originalTgts) {
    const list = C.targets[listName] // we will try to mangle list later
    C.targets[listName] = null
    t1.same(C.targets[listName], originalTgts[listName])
    if (list.length < 1) continue // just in case
    list[0] = 'OWNED'
    list[list.length - 1] = 'OOPS'
    t1.throws(function(){ C.targets[listName].push(999) }, /not extensible/)
  }
  t1.same(C.targets, originalTgts)

  const originalBackupFlag = C.backupFlag
  C.backupFlag = function(){}
  t1.equal(C.backupFlag, originalBackupFlag)

  const originalErrorCodes = { ...C.errorCodes }
  C.errorCodes = new Date()
  t1.same(C.errorCodes, originalErrorCodes)
  for (const field in C.errorCodes)
    C.errorCodes[field] = 0
  C.errorCodes.NEVER_HEARD_OF_THIS_ONE = 42
  t1.same(C.errorCodes, originalErrorCodes)

  t1.end()
})

