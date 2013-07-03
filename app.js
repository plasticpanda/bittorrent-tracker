/*jshint node:true, laxcomma:true, indent:2, undef:true, strict:true, unused:true, curly:true, white:true, eqnull:true */

'use strict';

var http = require('http')
  , logger = require('coolog')('app.js', true);

var HTTPTracker = require("./lib/tracker").HTTPTracker
  , tracker = new HTTPTracker()
  , server = http.createServer(tracker.requestHandler());

server.listen(6969, '0.0.0.0');
logger.ok('Tracker server listening on port ' + 6969);
