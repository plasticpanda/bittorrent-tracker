/*jshint node:true, laxcomma:true, indent:2, undef:true, strict:true, unused:true, curly:true, white:true */

'use strict';

require('sugar');

var logger = require('coolog').logger('Tracker.js', true)
  , EventEmitter = require('events').EventEmitter
  , assert = require('assert')
  , util = require('util');

var EVENT_TYPES = {
    NONE: 0,
    COMPLETED: 1,
    STARTED: 2,
    STOPPED: 3
  }  
  , PEERSTATE = {
    SEEDER: 0,
    LEECHER: 1
  }
  , ANNOUNCE_INTERVAL = 60;


function event(e) {
  switch (e) {
  case "completed":
    return EVENT_TYPES.COMPLETED;
  case "started":
    return EVENT_TYPES.STARTED;
  case "stopped":
    return EVENT_TYPES.STOPPED;
  }
  return EVENT_TYPES.NONE;
}


/* 
 * Utils
 */

var _PEER_IPPORT_COMPACT_SIZE = 6;
function _compact_ip_port(ip, port) {
  var b = new Buffer(_PEER_IPPORT_COMPACT_SIZE)
    , parts = ip.split(".");
    
  if (parts.length != 4) {
    throw new Error('Got an invalid IP address.');
  }
  
  b[0] = parseInt(parts[0], 10);
  b[1] = parseInt(parts[1], 10);
  b[2] = parseInt(parts[2], 10);
  b[3] = parseInt(parts[3], 10);
  b[4] = (port >> 8) & 0xff;
  b[5] = port & 0xff;
  return b;
}


/**
 * Peer class
 */

function Peer(ip, port, left) {
  this.fullAddress = ip + ':' + port;
  this.compactAddress = _compact_ip_port(ip, port);
  this.state = (left > 0) ? PEERSTATE.LEECHER : PEERSTATE.SEEDER;
  this.lastAction = -1;
  
  this.touch();
}

Peer.prototype.toString = function () {
  return 'Peer ' + this.fullAddress.underline + ': ' + (this.state === PEERSTATE.SEEDER ? 'SEEDER' : 'LEECHER') + '';
};

Peer.prototype.touch = function () {
  this.lastAction = new Date().valueOf();
};

Peer.prototype.timedOut = function (n) {
  return n - this.lastAction / 1000 > 2 * ANNOUNCE_INTERVAL;
};


/**
 * File class
 */

function File(infoHash) {
  File.super_.call(this);
  
  if (!Buffer.isBuffer(infoHash)) {
    throw new Error('infoHash must be a buffer.');
  }
  
  this.peerDict = {};
  this.downloads = 0;
  this.seeders = 0;
  this.leechers = 0;
  this.created_on = new Date();
  
  // private
  this._infoHash = infoHash;
  this._peerCheckHandle = null;
  this._startPeerCheck();
}
util.inherits(File, EventEmitter);


File.prototype.toString = function () {
  return 'Torrent ...' + this._infoHash.toString('hex').last(10).underline + 
    ': ' + Object.keys(this.peerDict).length + ' peers, ' +
    this.seeders + ' seeders, ' +
    this.leechers + ' leechers. Downloaded ' + this.downloads + ' times';
};


File.prototype._startPeerCheck = function () {
  var that = this;
  
  var _doPeerCheck = function () {
    var stalePeers = [];
    
    Object.keys(that.peerDict).forEach(function (peerId) {
      var peer = that.peerDict[peerId];
      
      if (peer.timedOut()) {
        stalePeers.push(peerId);

        if (peer.state == PEERSTATE.LEECHER) {
          that.leechers--;
        } else {
          that.seeders--;
        }
      }
    });
    
    if (stalePeers.length > 0) {
      logger.debug('Cleaning up ' + stalePeers.length + ' stale peers.');
      that.peerDict = Object.reject(that.peerDict, stalePeers);
    }
  
    that._peerCheckHandle = setTimeout(_doPeerCheck, ANNOUNCE_INTERVAL * 2);
  };
  
  process.nextTick(_doPeerCheck);
};


File.prototype.announce = function (peerId, peer, evt) {
  this.emit('announce', peerId, peer, evt);
  
  // Check if the peer already exists
  if (this.peerDict[peerId] !== undefined) {
    var oldPeer = this.peerDict[peerId];
    oldPeer.touch();

    // 1. Peer has stopped this torrent
    if (evt == EVENT_TYPES.STOPPED) {
      this.emit('peerRemoved', peerId);
      
      if (oldPeer.state === PEERSTATE.LEECHER) {
        this.leechers--;
      } else {
        this.seeders--;
      }
      delete this.peerDict[peerId];
      
    } else {
      // TODO: Should probably update compact in the old peer. So we
      // handle the case if the user switched IP or Port. But we
      // probably only want to do it if they differ
      // oldPeer.compact = peer.compact;
      
      // 2. Peer has changed state (e.g. download completed)
      if (oldPeer.state != peer.state) {
        if (peer.state === PEERSTATE.LEECHER) {
          this.emit('peerBecameLeecher', peerId);
          this.leechers++;
          this.seeders--;
        } else {
          // 3. Peer has completed the download (and will become a seeder)
          if (evt == EVENT_TYPES.COMPLETED) {
            this.emit('peerCompletedDownload', peerId);
            this.downloads++;
          }
          
          this.emit('peerBecameSeeder', peerId);
          this.leechers--;
          this.seeders++;
        }

        oldPeer.state = peer.state;
      }
    }

  } else {
    // if (evt === EVENT_TYPES.STOPPED) {
    //  --- @FIXME why on earth do you announce a stopped torrent?
    //   logger.warn('Refusing to handle announce of a stopped torrent.');
    //   return false;
    // }
    
    this.emit('peerAdded', peerId, peer);
    this.peerDict[peerId] = peer;

    if (peer.state === PEERSTATE.LEECHER) {
      this.leechers++;
    } else {
      this.seeders++;
    }
  }

  return true;
};
  
/**
 * Write file peers to a buffer
 * @param  {Buffer} b                destination buffer
 * @param  {int} want_num         number of peers wanted
 * @param  {string} requestingPeerId requesting peer id (used to skip himself from the peerlist)
 */
File.prototype.writePeers = function (want_num, requestingPeerId) {
  // @TODO: rename this method
  
  var should_num = Math.min(this.seeders + this.leechers, want_num)
    , buffer = new Buffer(0)
    , returning_peers_count = 0
    , that = this;
    
  assert.equal(Object.keys(this.peerDict).length, this.seeders + this.leechers, 'Peer list size does not match seeders+leeechers count.');
  
  Object.keys(this.peerDict).sample(should_num).forEach(function (peerId) {
    if (peerId !== requestingPeerId) {
      // don't return myself -- why?
      returning_peers_count++;
      buffer = Buffer.concat([buffer, that.peerDict[peerId].compactAddress]);
    } else {
      return null;
    }
  });
  
  return { count: returning_peers_count, buffer: buffer };
};


/**
 * Tracker class
 */

function Tracker() {
  Tracker.super_.call(this);
  
  this.files = {};
}
util.inherits(Tracker, EventEmitter);

Tracker.prototype.getFile = function (infoHash) {
  // Some trackers may want to check if this torrent exists and automatically add it to the file list.
  // ... we don't.
  return this.files[infoHash];
};
  
Tracker.prototype.addFile = function (infoHash) {
  var file = new File(infoHash);
  this.files[infoHash] = file;
  this.emit('fileAdded', infoHash, file);
  return file;
};

exports.ANNOUNCE_INTERVAL = ANNOUNCE_INTERVAL;
exports.Peer = Peer;
exports.Tracker = Tracker;
exports.event = event;
