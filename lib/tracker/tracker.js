/*jshint node:true, laxcomma:true, indent:2, undef:true, strict:true, unused:false, curly:false, white:true */

'use strict';

require('sugar');

var redis = require('redis')
  , msgpack = require('msgpack')
  , logger = require('coolog')('Tracker.js', true)
  , assert = require('assert');

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

function Peer(tracker, ip, port, left) {
  this.tracker = tracker;
  this.fullAddress = ip + ':' + port; // Use only for logging purposes
  this.compactAddress = _compact_ip_port(ip, port);
  this.state = (left > 0) ? PEERSTATE.LEECHER : PEERSTATE.SEEDER;
  // this.lastAction = -1;
  
  // this.touch();
}

Peer.prototype.toString = function () {
  return 'Peer ' + this.fullAddress.underline + ': ' + (this.state === PEERSTATE.SEEDER ? 'SEEDER' : 'LEECHER') + '';
};

// Peer.prototype.touch = function () {
//   this.lastAction = new Date().valueOf();
// };

Peer.prototype.timedOut = function (n) {
  return n - this.lastAction / 1000 > 2 * ANNOUNCE_INTERVAL;
};


/**
 * File class
 */

function File(tracker, info_hash) {
  if (!Buffer.isBuffer(info_hash)) {
    throw new Error('info_hash must be a buffer.');
  }
  
  this.tracker = tracker;
  
  this.peerDict = {};
  // this.downloads = 0; // Downloads in this session
  // this.seeders = 0;
  // this.leechers = 0;
  
  this.created_on = new Date();
  
  // private
  this._info_hash = info_hash;
  this._peerCheckHandle = null;
}


File.prototype.toString = function () {
  return 'Torrent ...' + this._info_hash.toString('hex').last(10).underline; /* + 
    ': ' + Object.keys(this.peerDict).length + ' peers, ' +
    this.seeders + ' seeders, ' +
    this.leechers + ' leechers. ' +
    'Downloads count: ' + this.downloads;*/
};


/*File.prototype._startPeerCheck = function () {
  var that = this;
  
  var _doPeerCheck = function () {
    var stalePeers = [];
    
    Object.keys(that.peerDict).forEach(function (peerId) {
      var peer = that.peerDict[peerId];
      
      if (peer.timedOut()) {
        stalePeers.push(peerId);

        if (peer.state == PEERSTATE.LEECHER) {
          that.tracker.store.decrLeechers(that._info_hash);
        } else {
          that.tracker.store.decrSeeders(that._info_hash);
        }
      }
    });
    
    that.peerDict = Object.reject(that.peerDict, stalePeers);
    that._peerCheckHandle = setTimeout(_doPeerCheck, ANNOUNCE_INTERVAL * 2);
  };
  
  process.nextTick(_doPeerCheck);
};*/


File.prototype.announce = function (peerId, peer, evt) {
  var that = this;
  
  this.tracker.store.getPeer(this._info_hash, peerId, function (err, peer_packed) {
    if (err) throw err;
    
    var oldPeer;
    
    if (peer_packed === null) {
      logger.log('Welcome ' + peerId + '. This is your first time here!');

      if (evt === EVENT_TYPES.STOPPED) {
        logger.warn('Refusing to handle announce of a stopped torrent.');
        return false;
      }
      
      // Add peer and update torrent stats
      that.tracker.store.addPeer(that._info_hash, peerId, peer, function (err) {
        if (err) throw err;
        
        if (peer.state === PEERSTATE.LEECHER) {
          that.tracker.store.incrLeechers(that._info_hash);
        } else {
          that.tracker.store.incrSeeders(that._info_hash);
        }      
      });
      
    } else {
      oldPeer = msgpack.unpack(peer_packed);
      console.log('Got peer from redis: ', oldPeer);
      
      // 1. Peer has stopped that torrent
      if (evt == EVENT_TYPES.STOPPED) {
        
        that.tracker.store.removePeer(that._info_hash, peerId, function (err) {
          if (err) throw err;
          
          if (oldPeer.state === PEERSTATE.LEECHER) {
            that.tracker.store.decrLeechers(that._info_hash);
          } else {
            that.tracker.store.decrSeeders(that._info_hash);
          }
        });
        
      } else {
        // TODO: Should probably update compact in the old peer. So we
        // handle the case if the user switched IP or Port. But we
        // probably only want to do it if they differ
        // oldPeer.compact = peer.compact;
        
        // 2. Peer has changed state (e.g. download completed)
        if (oldPeer.state != peer.state) {
          if (peer.state === PEERSTATE.LEECHER) {
            that.tracker.store.incrLeechers(that._info_hash);
            that.tracker.store.decrSeeders(that._info_hash);
          } else {
            // 3. Peer has completed the download (and will become a seeder)
            if (evt == EVENT_TYPES.COMPLETED) {
              that.tracker.store.incDownloads(that._info_hash);
            }
            
            that.tracker.store.decrLeechers(that._info_hash);
            that.tracker.store.incrSeeders(that._info_hash);
          }

          oldPeer.state = peer.state;
        }
      }
      
    }
    
  });
  
  return true;
};
  
/**
 * Write file peers to a buffer
 * @param  {Buffer} b                destination buffer
 * @param  {int} want_num         number of peers wanted
 * @param  {string} requestingPeerId requesting peer id (used to skip himself from the peerlist)
 */
File.prototype.writePeers = function (want_num, requestingPeerId) {
  var should_num = Math.min(this.seeders + this.leechers, want_num)
    , buffer = new Buffer(0)
    , returning_peers_count = 0
    , that = this;
    
  // assert.equal(Object.keys(this.peerDict).length, this.seeders + this.leechers, 'Peer list size does not match seeders+leeechers count.');
  
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
 * Data store class - adapter for redis
 */
function DataStore() {
  this.client = redis.createClient(null, null, { return_buffers: true, /*detect_buffers: true*/ });
}

DataStore._suffix = function (buf, suffixStr) {
  return Buffer.concat([buf, new Buffer(suffixStr)]);
};

DataStore.prototype.incrLeechers = function (info_hash, cb) {
  this.client.incr(DataStore._suffix(info_hash, '.leechers'), cb);
};

DataStore.prototype.decrLeechers = function (info_hash, cb) {
  this.client.decr(DataStore._suffix(info_hash, '.leechers'), cb);
};

DataStore.prototype.incrSeeders = function (info_hash, cb) {
  this.client.incr(DataStore._suffix(info_hash, '.seeders'), cb);
};

DataStore.prototype.decrSeeders = function (info_hash, cb) {
  this.client.decr(DataStore._suffix(info_hash, '.seeders'), cb);
};

DataStore.prototype.incrDownloads = function (info_hash, cb) {
  this.client.incr(DataStore._suffix(info_hash, '.downloads'), cb);
};

DataStore.prototype.addPeer = function (info_hash, peer_id, peer, cb) {
  this.client.hset(DataStore._suffix(info_hash, '.peers'), peer_id, msgpack.pack(peer), cb);
};

DataStore.prototype.removePeer = function (info_hash, peer_id, cb) {
  this.client.hdel(DataStore._suffix(info_hash, '.peers'), peer_id, cb);
};

DataStore.prototype.getPeer = function (info_hash, peer_id, cb) {
  this.client.hget(DataStore._suffix(info_hash, '.peers'), peer_id, cb);
};

DataStore.prototype.getPeers = function (info_hash, cb) {
  // @TODO: return only a subset of peers (e.g.: want_num, 20, ...)
  this.client.hgetall(DataStore._suffix(info_hash, '.peers'), function (err, res) {
    if (err) {
      cb(err, null);
    } else {
      
      console.log('Got redis peers:', res);
      var peers = res.map(function (item) {
        return msgpack.unpack(item);
      });
      cb(null, peers);
    }
  });
};

DataStore.prototype.addFile = function (info_hash, file, cb) {
  
};

DataStore.prototype.getFile = function (info_hash, cb) {
  
};


/**
 * Tracker class
 */

function Tracker() {
  this.files = {};
  
  /**
   * Use this instance property to change data stored in redis backend
   * @public
   * @type {DataStore}
   */
  this.store = new DataStore();
}

Tracker.prototype.getFile = function (infoHash) {
  // Some trackers may want to check if this torrent exists and automatically add it to the file list.
  // ... we don't.
  return this.files[infoHash];
};
  
Tracker.prototype.addFile = function (infoHash) {
  this.files[infoHash] = new File(this, infoHash);
  return this.files[infoHash];
};

exports.ANNOUNCE_INTERVAL = ANNOUNCE_INTERVAL;
exports.Peer = Peer;
exports.Tracker = Tracker;
exports.event = event;
