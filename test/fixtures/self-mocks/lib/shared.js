const Emitter = require('events')

const cfg = {
  expectCorrectNpmVersion: { throwIt: false },
  removeAddedItems: { throwIt: false },
  restoreBackups: { throwIt: false }
}

function dummyMaybeThrow(fnName) {
  if (cfg[fnName].throwIt) {
    const err = new Error('Dummy error from shared.js mock')
    if (cfg[fnName].code) err.code = cfg[fnName].code
    if (cfg[fnName].exitcode) err.exitcode = cfg[fnName].exitcode
    return Promise.reject(err)
  }
  return Promise.resolve()
}

const em = module.exports.emitter = new Emitter()

module.exports.expectCorrectNpmVersion =
  () => dummyMaybeThrow('expectCorrectNpmVersion')

module.exports.removeAddedItems =
  () => dummyMaybeThrow('removeAddedItems')

module.exports.restoreBackups =
  () => dummyMaybeThrow('restoreBackups')

module.exports.addFaultMessage = (err) => {}

module.exports.setErrorState = (fnName, state, errCode, exitcode) => {
  if (!cfg[fnName])
    throw new Error(`Unrecognized export "${fnName}", can't setErrorState`)
  cfg[fnName].throwIt = state
  cfg[fnName].code = errCode
  cfg[fnName].exitcode = exitcode
}