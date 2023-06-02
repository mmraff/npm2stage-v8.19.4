/* istanbul ignore file */

const cfg = {
  prune: { throwIt: false },
  removeFiles: { throwIt: false },
  graft: { throwIt: false }
}

function dummyMaybeThrow(fnName) {
  if (cfg[fnName].throwIt) {
    const err = new Error('Dummy error from file-tools mock')
    if (cfg[fnName].code) err.code = cfg[fnName].code
    return Promise.reject(err)
  }
  return Promise.resolve()
}

module.exports = {
  setEmitter: () => {},
  prune: () => dummyMaybeThrow('prune'),
  removeFiles: () => dummyMaybeThrow('removeFiles'),
  graft: () => dummyMaybeThrow('graft'),
  setErrorState: (fnName, state, errCode) => {
    if (!cfg[fnName])
      throw new Error(`Unrecognized export "${fnName}", can't setErrorState`)
    // removeFiles *never* throws ENOENT!
    if (fnName == 'removeFiles' && errCode == 'ENOENT') return
    cfg[fnName].throwIt = state
    cfg[fnName].code = errCode
  }
}
