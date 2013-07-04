/*jshint node:true, laxcomma:true, indent:2, undef:true, strict:true, unused:true, curly:true, white:true, eqnull:true */

'use strict';

var logger = require('coolog').logger('HTTPTracker.js', true)
  , trackerlib = require('./tracker')
  , querystring = require('querystring')
  , url = require('url')
  , util = require('util');

// Until it is possible to tell url.parse that you don't want a string back
// we need to override querystring.unescape so it returns a buffer instead of a string.
// Yes, we actually can do this: http://nodejs.org/api/querystring.html#querystring_querystring_unescape
querystring.unescape = function (s, decodeSpaces) {
  return querystring.unescapeBuffer(s, decodeSpaces);
};


function HTTPTracker() {
  HTTPTracker.super_.call(this); // Call super's constructor
}
util.inherits(HTTPTracker, trackerlib.Tracker);


var FAILURE_REASONS = {
    100: 'Invalid request type: client request was not a HTTP GET',
    101: 'Missing info_hash',
    102: 'Missing peer_id',
    103: 'Missing port',
    150: 'Invalid infohash: infohash is not 20 bytes long',
    151: 'Invalid peerid: peerid is not 20 bytes long',
    152: 'Invalid numwant. Client requested more peers than allowed by tracker',
    200: 'info_hash not found in the database. Sent only by trackers that do not automatically include new hashes into the database',
    500: 'Client sent an eventless request before the specified time',
    900: 'Generic error'
  },
  PARAMS_INTEGER = [
    'port', 'uploaded', 'downloaded', 'left', 'compact', 'numwant'
  ],
  PARAMS_STRING = [
    'event'
  ];


/**
 * Utils
 */

function _validateRequest(method, query) {
  var p, i;
  
  if (method != 'GET') {
    throw new Failure(100);
  }

  if (typeof query.info_hash == 'undefined') {
    throw new Failure(101);
  }

  if (typeof query.peer_id == 'undefined') {
    throw new Failure(102);
  }

  if (typeof query.port == 'undefined') {
    throw new Failure(103);
  }

  if (query.info_hash.length != 20) {
    throw new Failure(150);
  }

  if (query.peer_id.length != 20) {
    throw new Failure(151);
  }

  for (i = 0; i < PARAMS_INTEGER.length; i++) {
    p = PARAMS_INTEGER[i];
    if (typeof query[p] != 'undefined') {
      query[p] = parseInt(query[p].toString(), 10);
    }
  }

  for (i = 0; i < PARAMS_STRING.length; i++) {
    p = PARAMS_STRING[i];
    if (typeof query[p] != 'undefined') {
      query[p] = query[p].toString();
    }
  }

  if (typeof query.compact == 'undefined' || query.compact != 1) {
    throw new Failure(null, 'This tracker only supports compact mode');
  }
}


/**
 * Failure class
 */

function Failure(code, reason) {
  this.code = code;
  this.reason = reason;
  
  if (this.code == null) {
    this.code = 900;
  }
    
  if (reason == null && typeof FAILURE_REASONS[this.code] !== undefined) {
    this.reason = FAILURE_REASONS[this.code];
  }
}

Failure.prototype.bencode = function () {
  return 'd14:failure reason' + this.reason.length  + ':' + this.reason + '12:failure codei' + this.code + 'ee';
};


/**
 * Extending Tracker with HTTP interface
 */

HTTPTracker.prototype.requestHandler = function () {
  var that = this;
  
  return function _requestHandler(request, response) {
    var query = url.parse(request.url, true).query
      , want = parseInt(query.numwant, 10) || 50
      , file
      , peer
      , announceResult
      , writeResult;
    
    logger.debug('Announce request from', request.connection.remoteAddress, query);

    try {
      // info_hash peer_id port uploaded downloaded left compact numwant event
      _validateRequest(request.method, query);
      
      file = that.getFile(query.info_hash);
      if (file === undefined) {
        // Start tracking this file
        file = that.addFile(query.info_hash);
      }
      
      peer = new trackerlib.Peer(request.connection.remoteAddress, query.port, query.left);
      
      logger.log(peer.toString());
      logger.log(file.toString());
      
      announceResult = file.announce(query.peer_id, peer, trackerlib.event(query.event));
      
      if (!announceResult) {
        throw new Failure(null, 'Annunce failed.');
      }

      writeResult = file.writePeers(want, query.peer_id); // .buffer, .count (number of peers returned, === .buffer.length / 6)

      var resp = 'd8:intervali' + trackerlib.ANNOUNCE_INTERVAL + 
        'e8:completei' + file.seeders + 
        'e10:incompletei' + file.leechers + 
        'e10:downloadedi' + file.downloads + 
        'e5:peers' + writeResult.buffer.length + ':';
      
      // Write the response!  
      response.writeHead(200, {
        'Content-Length': resp.length + writeResult.buffer.length + 1,
        'Content-Type': 'text/plain'
      });
      response.write(resp);
      response.write(writeResult.buffer);
      response.end('e');
      
      logger.debug('Sent response', resp + writeResult.buffer.toString('hex') + 'e');
      
    } catch (failure_or_error) {
      logger.error('Failure', failure_or_error);
      
      if ('function' === typeof failure_or_error.bencode) {
        var resp = failure_or_error.bencode();
        response.writeHead(500, {
          'Content-Length': resp.length,
          'Content-Type': 'text/plain'
        });
        response.end(resp);
      } else {
        throw failure_or_error;
      }
    }
  };
};


module.exports = HTTPTracker;
