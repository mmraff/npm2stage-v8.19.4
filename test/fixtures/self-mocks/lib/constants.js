/* istanbul ignore file */
/*
  The only reason to mock this module (so far) is to make targetVersion mutable.
  The path of the original must be relative to the target location, which will be
  test/tempAssets/lib/
*/
const origConstants = require('../../../lib/constants')
module.exports = Object.assign({}, origConstants)
