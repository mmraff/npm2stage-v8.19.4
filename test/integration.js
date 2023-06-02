const { access, copyFile, unlink, writeFile } = require('fs').promises
const path = require('path')
const { promisify } = require('util')
const execAsync = promisify(require('child_process').exec)

const tap = require('tap')
const rimrafAsync = promisify(require('rimraf'))

const testTools = require('./lib/tools')
const {
  targets: TGTS,
  backupFlag: BAKFLAG,
  errorCodes: ERRS,
  messages: MSGS
} = require('../lib/constants')

const emptyDirName = 'EMPTY_DIR'
const scratchDirName = 'MUTABLE_DIR'
const assets = {
  root: tap.testdir({
    [emptyDirName]: {},
    [scratchDirName]: {}
  }),
  get emptyDir () { return path.join(this.root, emptyDirName) },
  get scratchDir () { return path.join(this.root, scratchDirName) },
  get npmDir () { return path.join(this.root, 'npm') },
  get npmLibDir () { return path.join(this.root, 'npm/lib') }
}
const wrongVersionPJFile = path.resolve(
  __dirname, './fixtures/npm-wrong-version-package.json'
)
const cliPath = path.resolve(__dirname, '../cli.js')

const runCLI = (argList, opts) => {
  if (!argList) argList = []
  if (!opts) opts = { env: {} }
  if (!opts.env) opts.env = {}
  // On Windows, PATH is in process.env, but gets inherited automatically;
  // process.env.SHELL is undefined, but child_process uses cmd.exe by default
  // (can't set that to '/usr/bin/bash', because Windows doesn't know that path)
  if (process.platform != 'win32') {
    opts.env.PATH = process.env.PATH
    opts.env.SHELL = process.env.SHELL
  }
  return execAsync([ 'node', cliPath ].concat(argList).join(' '), opts)
  // resolves to { stdout, stderr };
  // rejects as error E with E.stdout and E.stderr
}

const getEntryStates = basePath => {
  const result = {}
  const checkEntries = (wanted, i) => {
    if (i >= wanted.length) return Promise.resolve()
    let f = wanted[i]
    if (wanted === TGTS.CHANGED_FILES) f += BAKFLAG + '.js'
    else if (wanted !== TGTS.ADDED_DIRS) f += '.js'
    const fPath = path.join(basePath, f)
    return access(fPath).then(() => { result[f] = true })
    .catch(err => { result[f] = false })
    .then(() => checkEntries(wanted, i + 1))
  }
  return checkEntries(TGTS.CHANGED_FILES, 0)
  .then(() => checkEntries([ ...TGTS.CHANGED_FILES ], 0))
  .then(() => checkEntries(TGTS.ADDED_FILES, 0))
  .then(() => checkEntries(TGTS.ADDED_DIRS, 0))
  .then(() => result)
}

tap.before(() => testTools.copyFreshMockNpmDir(assets.root))

const RE_GENL_USAGE = /^Usage: npm2stage <command> \[cmdOption\] \[npmPath\]/
const INSTALL_USAGE = 'Usage: npm2stage install|i [options] [npmPath]'
const STATUS_USAGE = 'Usage: npm2stage status [options] [npmPath]'
const UNINST_USAGE = 'Usage: npm2stage uninstall|un [options] [npmPath]'
const STATUS_NO_NPM = `
   Checking npm version at given path...
   npm not found at given location.
`
const STATUS_WRONG_VER = `
   Checking npm version at given path...
   Wrong version of npm for this version of npm-two-stage.
`
const NO_LIB_DIR = 'Unable to access lib directory at supposed npm path\n'

tap.test('usage help output', t1 => {
  t1.test('no args given', t2 =>
    t2.rejects(
      runCLI(),
      { code: 1, stderr: RE_GENL_USAGE, stdout: MSGS.HELP_ADDENDUM }
    )
  )
  t1.test('h option alone', t2 =>
    runCLI([ '-h' ]).then(({ stdout, stderr }) => {
      t2.match(stdout, RE_GENL_USAGE)
      t2.ok(stdout.endsWith(MSGS.HELP_ADDENDUM + '\n'))
      t2.equal(stderr, '')
    })
  )
  t1.test('top-level help command', t2 =>
    runCLI([ 'help' ]).then(({ stdout, stderr }) => {
      t2.match(stdout, RE_GENL_USAGE)
      t2.ok(stdout.endsWith(MSGS.HELP_ADDENDUM + '\n'))
      t2.equal(stderr, '')
    })
  )
  t1.test('help status', t2 =>
    runCLI([ 'help', 'status' ]).then(({ stdout, stderr }) => {
      t2.ok(stdout.startsWith(STATUS_USAGE))
      t2.equal(stderr, '')
    })
  )
  t1.test('status command with h option', t2 =>
    runCLI([ 'status', '-h' ]).then(({ stdout, stderr }) => {
      t2.ok(stdout.startsWith(STATUS_USAGE))
      t2.equal(stderr, '')
    })
  )
  t1.test('help uninstall', t2 =>
    runCLI([ 'help', 'uninstall' ]).then(({ stdout, stderr }) => {
      t2.ok(stdout.startsWith(UNINST_USAGE))
      t2.equal(stderr, '')
    })
  )
  t1.test('uninstall command with h option', t2 =>
    runCLI([ 'uninstall', '-h' ]).then(({ stdout, stderr }) => {
      t2.ok(stdout.startsWith(UNINST_USAGE))
      t2.equal(stderr, '')
    })
  )

  t1.end()
})

tap.test('status command, anomalous cases', t1 => {
  t1.test('given a path with no package.json', t2 =>
    t2.rejects(
      runCLI([ 'status', assets.emptyDir ]),
      {
        code: ERRS.NO_NPM, stdout: STATUS_NO_NPM,
        stderr: /^ERROR: ENOENT: no such file or directory/
      },
      'should report no npm'
    )
  )
  t1.test('given a path to an installation that is not npm', t2 =>
    copyFile(
      path.resolve(__dirname, './fixtures/dummy/package.json'),
      path.join(assets.scratchDir, 'package.json')
    )
    .then(() => t2.rejects(
      runCLI([ 'status', assets.scratchDir ]),
      {
        code: ERRS.NO_NPM, stdout: STATUS_NO_NPM,
        stderr: /^ERROR: package at .+ is not npm\n$/
      },
      'should report not npm'
    ))
  )
  t1.test('given a path where package.json cannot be parsed', t2 =>
    writeFile(
      path.join(assets.scratchDir, 'package.json'),
      String.fromCharCode(0xFEFF) + "I just can't live up to your standards."
    )
    .then(() => t2.rejects(
      runCLI([ 'status', assets.scratchDir ]),
      {
        code: ERRS.BAD_NPM_INST,
        stdout: /   failed to parse package.json at /,
        stderr: /^ERROR: failed to parse package.json at /
      },
      'should report bad npm installation'
    ))
  )
  t1.test('given a path to wrong version of npm', t2 =>
    copyFile(
      wrongVersionPJFile, path.join(assets.scratchDir, 'package.json')
    )
    .then(() => t2.rejects(
      runCLI([ 'status', assets.scratchDir ]),
      {
        code: ERRS.WRONG_NPM_VER,
        stdout: STATUS_WRONG_VER,
        stderr: /^ERROR: wrong version of npm: found /
      },
      'should report non-matching version'
    ))
  )
  t1.test('given npm path has no lib directory', t2 =>
    copyFile(
      path.join(assets.npmDir, 'package.json'),
      path.join(assets.scratchDir, 'package.json')
    )
    .then(() => t2.rejects(
      runCLI([ 'status', assets.scratchDir ]),
      {
        code: ERRS.BAD_NPM_INST,
        stdout: new RegExp(NO_LIB_DIR), stderr: 'ERROR: ' + NO_LIB_DIR
      },
      'should report: no lib directory'
    ))
  )

  t1.end()
})

tap.test('install command, anomalous cases', t1 => {
  t1.test('given a path with no package.json', t2 =>
    t2.rejects(
      runCLI([ 'install', assets.emptyDir ]),
      {
        code: ERRS.NO_NPM, stdout: STATUS_NO_NPM,
        stderr: /^ERROR: ENOENT: no such file or directory/
      },
      'should fail and report no npm'
    )
    .then(() => getEntryStates(assets.emptyDir)).then(states => {
      for (const f in states) {
        if (states[f])
          t2.fail('should have no npm-two-stage artifacts')
      }
    })
  )
  t1.test('given path to an installation that is not npm', t2 =>
    copyFile(
      path.resolve(__dirname, './fixtures/dummy/package.json'),
      path.join(assets.scratchDir, 'package.json')
    )
    .then(() => t2.rejects(
      runCLI([ 'install', assets.scratchDir ]),
      {
        code: ERRS.NO_NPM, stdout: STATUS_NO_NPM,
        stderr: /^ERROR: package at .+ is not npm\n$/
      },
      'should fail and report not npm'
    ))
    .then(() => getEntryStates(assets.scratchDir)).then(states => {
      for (const f in states) {
        if (states[f])
          t2.fail('should have no npm-two-stage artifacts')
      }
    })
  )
  t1.test('package.json cannot be parsed', t2 =>
    writeFile(
      path.join(assets.scratchDir, 'package.json'),
      String.fromCharCode(0xFEFF) + '{{{block "what-is-this?"}}}'
    )
    .then(() => t2.rejects(
      runCLI([ 'install', assets.scratchDir ]),
      {
        code: ERRS.BAD_NPM_INST,
        stdout: /   failed to parse package.json at /,
        stderr: /^ERROR: failed to parse package.json at /
      },
      'should fail and report bad npm installation'
    ))
    .then(() => getEntryStates(assets.scratchDir)).then(states => {
      for (const f in states) {
        if (states[f])
          t2.fail('should have no npm-two-stage artifacts')
      }
    })
  )
  t1.test('given a path to wrong version of npm', t2 =>
    copyFile(
      wrongVersionPJFile, path.join(assets.scratchDir, 'package.json')
    )
    .then(() => t2.rejects(
      runCLI([ 'install', assets.scratchDir ]),
      {
        code: ERRS.WRONG_NPM_VER,
        stdout: STATUS_WRONG_VER,
        stderr: /^ERROR: wrong version of npm: found /
      },
      'should fail and report non-matching version'
    ))
    .then(() => getEntryStates(assets.scratchDir)).then(states => {
      for (const f in states) {
        if (states[f])
          t2.fail('should have no npm-two-stage artifacts')
      }
    })
  )
  t1.test('given npm path has no lib directory', t2 =>
    copyFile(
      path.join(assets.npmDir, 'package.json'),
      path.join(assets.scratchDir, 'package.json')
    )
    .then(() => t2.rejects(
      runCLI([ 'install', assets.scratchDir ]),
      {
        code: ERRS.BAD_NPM_INST,
        stdout: new RegExp(NO_LIB_DIR), stderr: 'ERROR: ' + NO_LIB_DIR
      },
      'should fail and report: no lib directory'
    ))
    .then(() => getEntryStates(assets.scratchDir)).then(states => {
      for (const f in states) {
        if (states[f])
          t2.fail('should have no npm-two-stage artifacts')
      }
    })
  )
  // This one hits restoreOldFiles() (inside changeToBackupNames()), so it
  // gets more coverage than the previous test, but it doesn't get far enough
  // to trigger doCleanup(). To do that, we would have to make changes to the
  // src directory of npm-two-stage dynamically; but that's unacceptably risky.
  t1.test('npm installation is missing a file', t2 => {
    // ... where the file is one of relevance to npm-two-stage.
    const brokenNpmDir = path.join(assets.scratchDir, 'npm')
    const expectedErrMsg = 'ENOENT: no such file or directory, rename '
    return rimrafAsync(brokenNpmDir)
    .then(() => testTools.copyFreshMockNpmDir(assets.scratchDir))
    .then(() => unlink(path.join(brokenNpmDir, 'lib/commands/install.js')))
    .then(() => t2.rejects(
      runCLI([ 'install', brokenNpmDir ]),
      {
        code: ERRS.BAD_NPM_INST,
        stdout: new RegExp([
          '   Backing up files to be replaced:[\\s\\SS]+',
          '   Error while renaming files; restoring original names...',
          '   ' + expectedErrMsg
        ].join('\n')),
        stderr: new RegExp(expectedErrMsg)
      },
      'should fail and report the missing file'
    ))
  })

  t1.end()
})

tap.test('uninstall command, anomalous cases', t1 => {
  t1.test('given a path with no package.json', t2 =>
    t2.rejects(
      runCLI([ 'uninstall', assets.emptyDir ]),
      {
        code: ERRS.NO_NPM, stdout: STATUS_NO_NPM,
        stderr: /^ERROR: ENOENT: no such file or directory/
      },
      'should fail and report no npm'
    )
  )
  t1.test('given path to installation that is not npm', t2 =>
    copyFile(
      path.resolve(__dirname, './fixtures/dummy/package.json'),
      path.join(assets.scratchDir, 'package.json')
    )
    .then(() => t2.rejects(
      runCLI([ 'uninstall', assets.scratchDir ]),
      {
        code: ERRS.NO_NPM, stdout: STATUS_NO_NPM,
        stderr: /^ERROR: package at .+ is not npm\n$/
      },
      'should fail and report not npm'
    ))
  )
  t1.test('package.json cannot be parsed', t2 =>
    writeFile(
      path.join(assets.scratchDir, 'package.json'), '{ *&^%$#@!? }'
    )
    .then(() => t2.rejects(
      runCLI([ 'uninstall', assets.scratchDir ]),
      {
        code: ERRS.BAD_NPM_INST,
        stdout: /   failed to parse package.json at /,
        stderr: /^ERROR: failed to parse package.json at /
      },
      'should fail and report bad npm installation'
    ))
  )
  t1.test('given a path to wrong version of npm', t2 =>
    copyFile(
      wrongVersionPJFile, path.join(assets.scratchDir, 'package.json')
    )
    .then(() => t2.rejects(
      runCLI([ 'uninstall', assets.scratchDir ]),
      {
        code: ERRS.WRONG_NPM_VER,
        stdout: STATUS_WRONG_VER,
        stderr: /^ERROR: wrong version of npm: found /
      },
      'should fail and report non-matching version'
    ))
  )
  t1.test('given path has no lib directory', t2 =>
    copyFile(
      path.join(assets.npmDir, 'package.json'),
      path.join(assets.scratchDir, 'package.json')
    )
    .then(() => t2.rejects(
      runCLI([ 'uninstall', assets.scratchDir ]),
      {
        code: ERRS.BAD_NPM_INST,
        stdout: new RegExp(NO_LIB_DIR), stderr: 'ERROR: ' + NO_LIB_DIR
      },
      'should fail and report: no lib directory'
    ))
  )
  t1.test('npm with no npm-two-stage', t2 => {
    const unchangedNpmDir = path.join(assets.scratchDir, 'npm')
    return rimrafAsync(unchangedNpmDir)
    .then(() => testTools.copyFreshMockNpmDir(assets.scratchDir))
    .then(() => t2.rejects(
      runCLI([ 'uninstall', unchangedNpmDir ]),
      {
        code: ERRS.FS_ACTION_FAIL,
        stdout: new RegExp([
          '   Removing items added by npm-two-stage install:[\\s\\S]+',
          '   Could not find file [^ ]+ for removal',
          '[\\s\\S]+',
          '   Restoring backed-up original files:[\\s\\S]+',
          '   Unable to restore '
        ].join('\n')),
        stderr: /ENOENT: no such file or directory, rename /
      },
      'should fail and report anomalies at location'
    ))
  })

  t1.end()
})

const STATUS_NOT_INST = `
   No backups present.
   No standard files missing.
   No new files present.
   npm-two-stage is not installed at this location.`

const RE_INSTALL_GOOD = new RegExp(`
   Backing up files to be replaced:
   [\\s\\S]+
   Copying into target directory:
   [\\s\\S]+
   Installation of npm-two-stage was successful.`)

const STATUS_INSTALLED = `
   All backups present.
   No standard files missing.
   All expected new files present.
   npm-two-stage is fully installed at this location.`

const RE_UNINSTALL_GOOD = new RegExp(`
   Removing items added by npm-two-stage install:
   [\\s\\S]+
   Restoring backed-up original files:
   [\\s\\S]+

   Removal of npm-two-stage was successful.`)

tap.test('normal command sequence', t1 => {
  t1.test('status command, target is untouched npm', t2 =>
    runCLI([ 'status', assets.npmDir ])
    .then(({ stdout, stderr }) => {
      t2.ok(
        stdout.includes(STATUS_NOT_INST),
        'should report status of not installed'
      )
      t2.equal(stderr, '')
    })
  )

  t1.test('install command, target is untouched npm', t2 =>
    runCLI([ 'install', assets.npmDir ])
    .then(({ stdout, stderr }) => {
      t2.match(stdout, RE_INSTALL_GOOD, 'should report success')
      t2.equal(stderr, '')
      return getEntryStates(assets.npmLibDir).then(states => {
        for (const f in states) {
          if (!states[f])
            t2.fail('npm-two-stage artifact(s) missing')
        }
      })
    })
  )

  t1.test('status command after successful installation', t2 =>
    runCLI([ 'status', assets.npmDir ])
    .then(({ stdout, stderr }) => {
      t2.ok(
        stdout.includes(STATUS_INSTALLED),
        'should report status of fully installed'
      )
      t2.equal(stderr, '')
    })
  )

  t1.test('install command, existing npm-two-stage installation', t2 =>
    t2.rejects(
      runCLI([ 'install', assets.npmDir ]),
      {
        code: ERRS.LEFTOVERS,
        stderr: new RegExp(MSGS.ADVICE_TO_UNINSTALL)
      },
      'should refuse to install, and display advice'
    )
    .then(() => getEntryStates(assets.npmLibDir))
    .then(states => {
      for (const f in states) {
        if (!states[f])
          t2.fail('npm-two-stage installation compromised')
      }
    })
  )

  t1.test('install, existing npm-two-stage installation, silent option', t2 =>
    t2.rejects(
      runCLI([ 'install --silent', assets.npmDir ]),
      {
        code: ERRS.LEFTOVERS,
        stdout: /^\s*$/,
        stderr: /ERROR: evidence of previous npm-two-stage installation \([^)]+\) in target location/
      },
      'should refuse to install, giving only error output'
    )
    .then(() => getEntryStates(assets.npmLibDir))
    .then(states => {
      for (const f in states) {
        if (!states[f])
          t2.fail('npm-two-stage installation compromised')
      }
    })
  )

  t1.test('uninstall command, existing npm-two-stage installation', t2 =>
    runCLI([ 'uninstall', assets.npmDir ])
    .then(({ stdout, stderr }) => {
      t2.match(stdout, RE_UNINSTALL_GOOD, 'should report success')
      t2.equal(stderr, '')
      return getEntryStates(assets.npmLibDir).then(states => {
        for (const f in states) {
          if (TGTS.CHANGED_FILES.includes(f.slice(0,-3))) {
            if (!states[f])
              t2.fail('npm installation compromised')
          }
          else if (states[f])
            t2.fail('npm installation compromised')
        }
      })
    })
  )

  t1.test('status command after successful uninstall at target', t2 =>
    runCLI([ 'status', assets.npmDir ])
    .then(({ stdout, stderr }) => {
      t2.ok(
        stdout.includes(STATUS_NOT_INST),
        'should report status of not installed (clean)'
      )
      t2.equal(stderr, '')
    })
  )

  t1.test('install command, silent option', t2 =>
    runCLI([ 'install --silent', assets.npmDir ])
    .then(({ stdout, stderr }) => {
      t2.equal(stdout.trim(), '', 'should display nothing')
      t2.equal(stderr, '')
      return getEntryStates(assets.npmLibDir).then(states => {
        for (const f in states) {
          if (!states[f])
            t2.fail('npm-two-stage installation compromised')
        }
      })
    })
  )

  t1.test('uninstall command, silent option', t2 =>
    runCLI([ 'uninstall --silent', assets.npmDir ])
    .then(({ stdout, stderr }) => {
      t2.equal(stdout.trim(), '', 'should display nothing')
      t2.equal(stderr, '')
      return getEntryStates(assets.npmLibDir).then(states => {
        for (const f in states) {
          if (TGTS.CHANGED_FILES.includes(f.slice(0,-3))) {
            if (!states[f])
              t2.fail('npm installation compromised')
          }
          else if (states[f])
            t2.fail('npm installation compromised')
        }
      })
    })
  )

  t1.end()
})
