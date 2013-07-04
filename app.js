/*jshint node:true, laxcomma:true, indent:2, undef:true, strict:true, unused:true, curly:true, white:true, eqnull:true */

'use strict';

require('sugar');

var http = require('http')
  , logentries = require('node-logentries')
  , coolog = require('coolog')
  , logger = coolog.logger('app.js', true)
  , util = require('util');

var LOGENTRIES_APIKEY = process.env.LOGENTRIES_APIKEY
  , TRACKER_PORT = 6969;

/**
 * Setup logging
 */

if (LOGENTRIES_APIKEY) {
  var logentries_logger = logentries.logger({
    token: LOGENTRIES_APIKEY
  });

  coolog.on('log', function (severity, args) {
    var _logger;
    
    if ('function' === typeof logentries_logger[severity]) {
      _logger = logentries_logger[severity];
    } else {
      _logger = logentries_logger.info;
    }
    
    args = args.map(function (arg) {
      if ('object' === typeof arg) {
        try {
          return JSON.stringify(arg);
        } catch (e) {
          // e.g. circular json structures...
          return util.inspect(arg);
        }
      } else {
        return arg;
      }
    });
    
    _logger.apply(null, args);
  });
}


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
  /*jshint unused:false */
  file.on('announce',               function (peerId, peer, evt) { /* ... */ });
  file.on('peerRemoved',            function (peerId) { /* ... */ });
  file.on('peerBecameLeecher',      function (peerId) { /* ... */ });
  file.on('peerBecameSeeder',       function (peerId) { /* ... */ });
  file.on('peerCompletedDownload',  function (peerId) { /* ... */ });
});

server.listen(TRACKER_PORT);
logger.ok('Tracker server listening on port ' + TRACKER_PORT);
