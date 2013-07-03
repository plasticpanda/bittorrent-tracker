/*jshint node:true, laxcomma:true, indent:2, undef:true, strict:true, unused:true, curly:true, white:true, eqnull:true */

'use strict';

var http = require('http')
  , logentries = require('node-logentries')
  , logger = require('coolog')('app.js', true);

var LOGENTRIES_APIKEY = process.env.LOGENTRIES_APIKEY
  , TRACKER_PORT = 6969;

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


/**
 * tracker instance emits some events
 */
tracker.on('fileAdded', function (infoHash, file) {
  file.on('announce',               function (peerId, peer, evt) { /* ... */ });
  file.on('peerRemoved',            function (peerId) { /* ... */ });
  file.on('peerBecameLeecher',      function (peerId) { /* ... */ });
  file.on('peerBecameSeeder',       function (peerId) { /* ... */ });
  file.on('peerCompletedDownload',  function (peerId) { /* ... */ });
});

server.listen(TRACKER_PORT);
logger.ok('Tracker server listening on port ' + TRACKER_PORT);
