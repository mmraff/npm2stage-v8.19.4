const assert = require('assert')
const fs = require('fs')
const path = require('path')

let mockCWD = process.cwd()
const startDir = process.cwd()
const _paths = {}
const fileContents = {}
const dirLists = {}
const errors = {}

function hasPath (item) {
  const resolvedPath = path.resolve(mockCWD, item)
  return (resolvedPath == startDir) || _paths[resolvedPath] ? true : false
}
function addPath (item, kind) {
  const resolvedPath = path.resolve(mockCWD, item)
  const mockStats = {}
  if (kind === 'dir') {
    mockStats.isDirectory = () => true
    mockStats.isFile = () => false
    dirLists[resolvedPath] = []
  }
  else if (kind === 'file') {
    mockStats.isDirectory = () => false
    mockStats.isFile = () => true
    delete dirLists[resolvedPath] // just in case

// experiment (causes lib_install_test to fail):
/*
    const parentDir = path.dirname(resolvedPath)
    const list = dirLists[parentDir]
    if (list) {
      const set = new Set(list)
      set.add(path.basename)
      dirLists[parentDir] = Array.from(set)
    }
*/
  }
  else {
    mockStats.isFile = () => false
    mockStats.isDirectory = () => false
    delete dirLists[resolvedPath] // just in case
  }
  _paths[resolvedPath] = mockStats
}
function addFileContents(item, data) {
  const resolvedPath = path.resolve(mockCWD, item)
  addPath(resolvedPath, 'file')
  fileContents[resolvedPath] = data
}
function addDirList (d, list) {
  // Because we don't know what the current directory will be when the
  // dir list is fetched:
  if (!path.isAbsolute(d))
    throw new Error('path argument must be absolute')
  _paths[d] = {
    isDirectory: () => true,
    isFile: () => false
  }
  dirLists[d] = list
}
function getStats(item) {
  const resolvedPath = path.resolve(mockCWD, item)
  return _paths[resolvedPath]
}
function removePath (item) {
  const resolvedPath = path.resolve(mockCWD, item)
  delete _paths[resolvedPath]
}
function purge () {
  for (const item in _paths) delete _paths[item]
  for (const item in dirLists) delete dirLists[item]
  for (const item in fileContents) delete fileContents[item]
}
function knownPaths () { return Object.keys(_paths) } // diagnostic

const validFuncs = [
  'access', 'copyFile', 'lstat', 'mkdir', 'readdir', 'readFile', 'rename',
  'rmdir', 'unlink'
]
function setError (fn, item, err) {
  assert(typeof fn == 'string' && validFuncs.includes(fn))
  const resolvedPath = path.resolve(mockCWD, item)
  if (!err && errors[fn]) delete errors[fn][resolvedPath]
  else {
    if (!errors[fn]) errors[fn] = {}
    errors[fn][resolvedPath] = err
  }
}
// Internal use only:
function getError (fn, item) {
  assert(typeof fn == 'string' && validFuncs.includes(fn))
  if (!errors[fn]) return null
  const resolvedPath = path.resolve(mockCWD, item)
  return errors[fn][resolvedPath] || null
}

const chdirErrors = {}
function setChdirError(dir, err) {
  assert(typeof dir == 'string')
  if (!err) delete chdirErrors[dir]
  else chdirErrors[dir] = err
}

const mocks = {
  constants: fs.constants,

  access (...args) {
    let err
    assert.equal(args.length, 2)
    if (err = getError('access', args[0]))
      return process.nextTick(() => args.pop()(err))
    if (!hasPath(args[0])) {
      err = new Error('mock access: cannot find path ' + args[0])
      err.code = 'ENOENT'
    }
    return process.nextTick(() => args.pop()(err))
  },
  copyFile (...args) {
    let err
    assert.equal(args.length, 4)
    assert.equal(args[2], fs.constants.COPYFILE_EXCL)
    if (err = getError('copyFile', args[0]))
      return process.nextTick(() => args.pop()(err))
    if (!hasPath(args[0])) {
      err = new Error('mock copyFile: cannot find source file ' + args[0])
      err.code = 'ENOENT'
    }
    else if (hasPath(args[1])) {
      err = new Error('mock copyFile: destination already exists ' + args[0])
      err.code = 'EEXIST'
    }
    else if (!hasPath(path.dirname(args[1]))) {
      err = new Error(
        'mock copyFile: cannot find path ' + path.dirname(args[1])
      )
      err.code = 'ENOENT'
    }
    else addPath(args[1], 'file')
    return process.nextTick(() => args.pop()(err))
  },
  lstat (...args) {
    let err
    assert.equal(args.length, 2)
    if (err = getError('lstat', args[0]))
      return process.nextTick(() => args.pop()(err))
    if (!hasPath(args[0])) {
      err = new Error('mock lstat: no such path ' + args[0])
      err.code = 'ENOENT'
      return process.nextTick(() => args.pop()(err))
    }
    return process.nextTick(() => args.pop()(null, getStats(args[0])))
  },
  mkdir (...args) {
    let err
    assert.equal(args.length, 2) // we don't use options
    if (err = getError('mkdir', args[0]))
      return process.nextTick(() => args.pop()(err))
    if (!hasPath(path.dirname(args[0]))) {
      err = new Error('mock mkdir: no such path ' + path.dirname(args[0]))
      err.code = 'ENOENT'
    }
    else addPath(args[0], 'dir')
    return process.nextTick(() => args.pop()(err))
  },
  readdir (...args) {
    let err
    assert.equal(args.length, 2)
    if (err = getError('readdir', args[0]))
      return process.nextTick(() => args.pop()(err))
    const resolvedPath = path.resolve(mockCWD, args[0])
    const entries = dirLists[resolvedPath]
    if (entries === undefined) {
      err = new Error('mock readdir: no such path ' + resolvedPath)
      err.code = 'ENOENT'
      return process.nextTick(() => args.pop()(err))
    }
    return process.nextTick(() => args.pop()(null, entries))
  },
  readFile (...args) {
    let err
    assert.equal(args.length, 3) // #2 is 'utf8'
    if (err = getError('readFile', args[0]))
      return process.nextTick(() => args.pop()(err))
    const resolvedPath = path.resolve(mockCWD, args[0])
    const contents = fileContents[resolvedPath]
    if (!contents) {
      err = new Error('mock readFile: no such path ' + resolvedPath)
      err.code = 'ENOENT'
      return process.nextTick(() => args.pop()(err))
    }
    return process.nextTick(() => args.pop()(null, contents))
  },
  rename (...args) {
    let err
    assert.equal(args.length, 3)
    if (err = getError('rename', args[0]))
      return process.nextTick(() => args.pop()(err))
    if (!hasPath(args[0])) {
      err = new Error('mock rename: cannot find path ' + args[0])
      err.code = 'ENOENT'
    }
    else {
      const mockStats = getStats(args[0])
      if (mockStats.isFile)
        addPath(args[1],
          mockStats.isFile() ? 'file' :
          mockStats.isDirectory() ? 'dir' : null
        )
      else addPath(args[1])
      removePath(args[0])
    }
    return process.nextTick(() => args.pop()(err))
  },
  rmdir (...args) {
    let err
    assert.equal(args.length, 2)
    if (err = getError('rmdir', args[0]))
      return process.nextTick(() => args.pop()(err))
    if (!hasPath(args[0])) {
      err = new Error('mock rmdir: cannot find path ' + args[0])
      err.code = 'ENOENT'
    }
    else removePath(args[0])
    return process.nextTick(() => args.pop()(err))
  },
  unlink (...args) {
    let err
    assert.equal(args.length, 2)
    if (err = getError('unlink', args[0]))
      return process.nextTick(() => args.pop()(err))
    if (!hasPath(args[0])) {
      err = new Error('mock unlink: cannot find path ' + args[0])
      err.code = 'ENOENT'
    }
    else if (getStats(args[0]).isDirectory()) {
      err = new Error('mock unlink: illegal operation on a directory, unlink ' + args[0])
      err.code = 'EISDIR'
    }
    else removePath(args[0])
    return process.nextTick(() => args.pop()(err))
  }
}

// mock process.cwd
const cwd = () => mockCWD
// mock process.chdir
function chdir (dir) {
  const resolvedPath = path.resolve(mockCWD, dir)
  if (chdirErrors[resolvedPath]) {
    throw chdirErrors[resolvedPath] // other than 'ENOENT'
  }
  if (!hasPath(resolvedPath)) {
    const err = new Error('mock chdir: cannot find path: ' + resolvedPath)
    err.code = 'ENOENT'
    throw err
  }
  mockCWD = resolvedPath
}

module.exports = {
  cwd, chdir, mocks,
  hasPath, addPath, removePath, addDirList, addFileContents,
  purge, setError, setChdirError, knownPaths
}

