const Emitter = require('events')
const path = require('path')

const tap = require('tap')

const mockFS = require('./lib/mock-fs')

const ft = tap.mock('../lib/file-tools.js', { 'fs': mockFS.mocks })

const testEmitter = new Emitter()
const messages = []
const notStrings = [ true, 42, { type: 'url' }, ['url'], () => 'url' ]

tap.before(() => {
  testEmitter.on('msg', (msg) => messages.push(msg))
})
tap.afterEach(() => {
  mockFS.purge()
  messages.splice(0, messages.length)
})
tap.teardown(() => {
  testEmitter.removeAllListeners()
})

tap.test('setEmitter', t1 => {
  t1.throws(() => ft.setEmitter(), new SyntaxError('No argument given'))
  t1.throws(() => ft.setEmitter(null), new SyntaxError('No argument given'))
  for (item of [ true, 42, 'fish', { type: 'url' }, ['url'], () => 'url' ])
    t1.throws(
      () => ft.setEmitter(item),
      new TypeError('Given argument is not an Emitter'),
      'expect error on', item, 'given as an emitter'
    )
  t1.doesNotThrow(() => ft.setEmitter(testEmitter))
  t1.end()
})

tap.test('prune', t1 => {
  const emptyArgError = new SyntaxError('Target directory argument must not be empty')
  t1.rejects(ft.prune(), emptyArgError)
  t1.rejects(ft.prune(null), emptyArgError)
  t1.rejects(ft.prune(''), emptyArgError)

  // This gets a mock readdir error, because we haven't registered the path:
  t1.rejects(ft.prune('NO_SUCH_DIR'), 'expect rejection for nonexistent path')

  const testDir = path.resolve('imaginary/prunable')
  const testSubdirName = 'subdir'
  const testSubdir = path.join(testDir, testSubdirName)
  const filenames1 = [ 'file_a', 'file_b' ]
  const filenames2 = [ 'file_c', 'file_d' ]
  for (const f of filenames1)
    mockFS.addPath(path.join(testDir, f), 'file')
  for (const f of filenames2)
    mockFS.addPath(path.join(testSubdir, f), 'file')
  mockFS.addDirList(testDir, [ ...filenames1, testSubdirName ])
  mockFS.addDirList(testSubdir, filenames2)
  t1.resolves(ft.prune(testDir))
  .then(() => {
    for (const f of filenames2)
      t1.equal(mockFS.hasPath(path.join(testSubdir, f)), false)
    t1.equal(mockFS.hasPath(testSubdir), false)
    for (const f of filenames1)
      t1.equal(mockFS.hasPath(path.join(testDir, f)), false)
    t1.equal(mockFS.hasPath(testDir), false)

    // Note: no emitter messages to verify
  })
  .finally(() => {
    t1.end()
  })
})

tap.test('graft', t1 => {
  const destDir1 = path.resolve('imaginary/newhome1')
  const destDir2 = path.resolve('imaginary/newhome2')
  const srcDirName = 'graftable'
  const srcDir = path.resolve('imaginary', srcDirName)
  const srcSubdirName = 'subdir'
  const srcSubdir = path.join(srcDir, srcSubdirName)
  const filenames1 = [ 'file_e', 'file_f' ]
  const filenames2 = [ 'file_g', 'file_h' ]

  const srcArgError = new SyntaxError('Source argument must not be empty')
  t1.rejects(ft.graft(undefined, destDir1), srcArgError)
  t1.rejects(ft.graft(null, destDir1), srcArgError)
  t1.rejects(ft.graft('', destDir1), srcArgError)

  const destArgError = new SyntaxError('Destination argument must not be empty')
  t1.rejects(ft.graft(srcDir), destArgError)
  t1.rejects(ft.graft(srcDir, null), destArgError)
  t1.rejects(ft.graft(srcDir, ''), destArgError)

  for (const item of notStrings) {
    t1.rejects(ft.graft(item, destDir1), TypeError)
    t1.rejects(ft.graft(srcDir, item), TypeError)
  }

  // In the following 2 uses of graft(), the errors are mocked,
  // so they don't really have information of interest
  t1.rejects(
    ft.graft(srcDir, destDir1), { code: 'ENOENT' },
    'expect rejection if the destination does not exist'
  )
  .then(() => {
    mockFS.addDirList(destDir1, [])
    return t1.rejects(
      ft.graft(srcDir, destDir1), { code: 'ENOENT' },
      'expect rejection if the source path does not exist'
    )
  })
  .then(() => {
    t1.equal(mockFS.hasPath(destDir1), true)
    t1.equal(mockFS.hasPath(path.join(destDir1, srcDirName)), false)
    // The destination is still there, but nothing remaining in it from the
    // failed operation

    // Now we put everything needed in place in the src location
    for (const f of filenames1)
      mockFS.addPath(path.join(srcDir, f), 'file')
    for (const f of filenames2)
      mockFS.addPath(path.join(srcSubdir, f), 'file')
    mockFS.addDirList(srcDir, [ ...filenames1, srcSubdirName ])
    mockFS.addDirList(srcSubdir, filenames2)
    mockFS.addDirList(srcSubdir, filenames2)
    return t1.resolves(ft.graft(srcDir, destDir1))
  })
  .then(() => {
    // Verify that everything has been copied to the destination
    const base = path.join(destDir1, srcDirName)
    t1.equal(mockFS.hasPath(base), true)
    for (const f of filenames1)
      t1.equal(mockFS.hasPath(path.join(base, f)), true)
    t1.equal(mockFS.hasPath(path.join(base, srcSubdirName)), true)
    for (const f of filenames2)
      t1.equal(mockFS.hasPath(path.join(base, srcSubdirName, f)), true)

    mockFS.addDirList(destDir2, [])
    // Replace some items with unsupported types of file entries
    mockFS.addPath(path.join(srcSubdir, filenames2[0]), 'link')
    mockFS.addPath(path.join(srcSubdir, filenames2[1]), 'socket')
    return t1.resolves(ft.graft(srcDir, destDir2))
  })
  .then(() => {
    // Verify that *almost* everything has been copied to the destination;
    // verify the replaced items were not copied
    const base = path.join(destDir2, srcDirName)
    t1.equal(mockFS.hasPath(base), true)
    for (const f of filenames1)
      t1.equal(mockFS.hasPath(path.join(base, f)), true)
    t1.equal(mockFS.hasPath(path.join(base, srcSubdirName)), true)
    for (const f of filenames2)
      t1.equal(mockFS.hasPath(path.join(base, srcSubdirName, f)), false)

    t1.equal(messages.length, 2)
    for (const msg of messages)
      t1.match(msg, /^Not a regular file or a directory, omitting /)
  })
  .finally(() => {
    t1.end()
  })
})

tap.test('removeFiles', t1 => {
  const noArgError = new SyntaxError('Path list must be given')
  const badArgError = new TypeError('Path list must be an array')
  const badItemError = new TypeError('Path list can only contain strings')
  t1.rejects(ft.removeFiles(), noArgError)
  t1.rejects(ft.removeFiles(null), noArgError)
  for (const item of [ true, 42, 'list', { length: 1 }, () => [] ]) {
    t1.rejects(ft.removeFiles(item), badArgError)
    if (typeof item == 'string') continue
    t1.rejects(ft.removeFiles(['good', item]), badItemError)
  }

  const startDir = mockFS.cwd()
  const base = 'test/sandbox'
  const list = [ 'file_i', 'deeper/file_j' ]
  mockFS.addPath(base, 'dir')
  mockFS.chdir(base)
  t1.resolves(ft.removeFiles(list))
  .then(() => {
    t1.equal(messages.length, 2)
    for (const msg of messages)
      t1.match(msg, /^Could not find file /)

    mockFS.addPath(list[0], 'dir')
    return ft.removeFiles(list)
    .catch(err => {
      t1.notMatch(err.code, 'ENOENT')
      // The actual fs.unlink error would be EISDIR
    })
  })
  .then(() => {
    for (const item of list) mockFS.addPath(item, 'file')
    return t1.resolves(ft.removeFiles(list))
  })
  .then(() => {
    for (const item of list)
      t1.equal(mockFS.hasPath(item), false)
  })
  .finally(() => {
    mockFS.chdir(startDir)
    t1.end()
  })
})

