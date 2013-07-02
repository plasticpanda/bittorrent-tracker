/*jshint node:true, laxcomma:true, indent:2, undef:true, strict:true, unused:true, curly:true, white:true, eqnull:true */

'use strict';

var http = require('http')
  , logger = require('coolog')('example.js');

var HTTPTracker = require("./lib/tracker").HTTPTracker
  , tracker = new HTTPTracker()
  , server = http.createServer(tracker.requestHandler);
  
server.listen(6969);
logger.ok('Tracker server listening on port ' + 6969);
