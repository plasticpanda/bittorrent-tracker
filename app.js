/*jshint node:true, laxcomma:true, indent:2, undef:true, strict:true, unused:true, curly:true, white:true, eqnull:true */

'use strict';

var http = require('http')
  , logentries = require('node-logentries')
  , logger = require('coolog')('app.js', true);

var LOGENTRIES_APIKEY = process.env.LOGENTRIES_APIKEY;

/**
 * Setup logging
 */

var logentries_logger = logentries.logger({
  token: LOGENTRIES_APIKEY
});

logger.on('log', function (severity, args) {
  var _logger;
  
  if ('function' === typeof logentries_logger[severity]) {
    _logger = logentries_logger[severity];
  } else {
    _logger = logentries_logger.info;
  }
  
  _logger.apply(null, args);
});


/**
 * Create and start the Tracker
 */

var HTTPTracker = require("./lib/tracker").HTTPTracker
  , tracker = new HTTPTracker()
  , server = http.createServer(tracker.requestHandler());

server.listen(6969, '0.0.0.0');
logger.ok('Tracker server listening on port ' + 6969);
