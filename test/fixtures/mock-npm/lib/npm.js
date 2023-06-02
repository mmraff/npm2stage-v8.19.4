const configData = {
  offline: false
}

// Don't know what to put in here yet

const npm = module.exports = new class {
  constructor () {
    this.config = new Config({
      npmPath: dirname(__dirname),
    })
  }
}
