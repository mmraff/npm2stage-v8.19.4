#!/usr/bin/env node

const { Command } = require('commander')
const { install, installProgress } = require('./lib/install')
const { uninstall, uninstallProgress } = require('./lib/uninstall')
const { getStatus, statusProgress } = require('./lib/status')
const {
  errorCodes: ERRS,
  messages: MSGS
} = require('./lib/constants')

const program = new Command()
const { version: pkgVersion, bin: pkgBin } = require('./package.json')
const progName = (() => { for (let prop in pkgBin) return prop })()

program
  .name(progName)
  .version(pkgVersion)
  .usage('<command> [cmdOption] [npmPath]')
  .on('--help', () => console.log(MSGS.HELP_ADDENDUM))

program
  .command('install [npmPath]')
  .description('Installs npm-two-stage over npm at given path or live location.')
  .alias('i')
  .option('-s, --silent', 'No console output unless error')
  .action((npmPath, options) => {
    if (!options.silent) {
      installProgress.on('msg', msg => console.log('  ', msg))
    }
    console.log('')
    install(npmPath).then(() => {
      if (!options.silent)
        console.log('\n   Installation of npm-two-stage was successful.\n')
    })
    .catch(err => {
      console.error(`ERROR: ${err.message}`)
      if (!options.silent) {
        if (err.exitcode == ERRS.LEFTOVERS)
          console.warn(MSGS.ADVICE_TO_UNINSTALL)
      }
      /*istanbul ignore next*/
      process.exitCode = err.exitcode || 1
    })
  })

program
  .command('uninstall [npmPath]')
  .description('Removes all traces of npm-two-stage from npm at given path or live location.')
  .alias('un')
  .option('-s, --silent', 'No console output unless error')
  .action((npmPath, options) => {
    if (!options.silent) {
      uninstallProgress.on('msg', msg => console.log('  ', msg))
    }
    console.log('')
    uninstall(npmPath).then(() => {
      if (!options.silent)
        console.log('\n   Removal of npm-two-stage was successful.\n')
    })
    .catch(err => {
      console.error(`ERROR: ${err.message}`)
      /*istanbul ignore next*/
      process.exitCode = err.exitcode || 1
    })
  })

program
  .command('status [npmPath]')
  .description('Reports the condition of npm-two-stage artifacts at given path or live location.')
  .action(npmPath => {
    statusProgress.on('msg', msg => console.log('  ', msg))
    console.log('')
    getStatus(npmPath).then(() => {
      console.log('')
    })
    .catch(err => {
      console.error(`ERROR: ${err.message}`)
      /*istanbul ignore next*/
      process.exitCode = err.exitcode || 1
    })
  })

program.parse()
