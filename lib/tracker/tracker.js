/*jshint node:true, laxcomma:true, indent:2, undef:true, strict:true, unused:true, curly:true, white:true */

'use strict';

function now() {
  return Math.floor(new Date().getTime() / 1000);
}


require('sugar');

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


// function event(e) {
//   switch (e) {
//   case "completed":
//     return EVENT_TYPES.COMPLETED;
//   case "started":
//     return EVENT_TYPES.STARTED;
//   case "stopped":
//     return EVENT_TYPES.STOPPED;
//   }
//   return EVENT_TYPES.TYPES.NONE;
// }


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
  this.compact = this._compact_ip_port(ip, port);
  this.state = (left > 0) ? PEERSTATE.LEECHER : PEERSTATE.SEEDER;
  this.touch();
}

Peer.prototype.touch = function () {
  this.lastAction = now();
};

Peer.prototype.timedOut = function (n) {
  return n - this.lastAction > ANNOUNCE_INTERVAL * 2;
};


/**
 * File class
 */

function File() {
  this.peerDict = {};
  this.downloads = 0;
  this.seeders = 0;
  this.leechers = 0;
  this.lastCompact = now();
  
  // private
  this._peerCheckHandle = null;
}


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
    
    that.peerDict = Object.reject(that.peerDict, stalePeers);
    that.lastCompact = now();
    that._peerCheckHandle = setTimeout(_doPeercheck, ANNOUNCE_INTERVAL * 2);
  };
  
  process.nextTick(_doPeerCheck);
};


File.prototype.announce = function (peerId, peer, evt) {
  
  // Check if the peer already exists
  if (this.peerDict[peerId] !== undefined) {
    var oldPeer = this.peerDict[peerId];
    oldPeer.touch();

    // 1. Peer has stopped this torrent
    if (evt == EVENT_TYPES.STOPPED) {
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
          this.leechers++;
          this.seeders--;
        } else {
          // 3. Peer has completed the download (and will become a seeder)
          if (evt == EVENT_TYPES.COMPLETED) {
            this.downloads++;
          }
          
          this.leechers--;
          this.seeders++;
        }

        oldPeer.state = peer.state;
      }
    }

  } else {
    
    if (evt === EVENT_TYPES.STOPPED) {
      clog.warn('Refusing to handle announce of a stopped torrent.');
      return false;
    }
    
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
File.prototype.writePeers = function (b, want_num, requestingPeerId) {
  assert.equal(Object.keys(this.peerDict).length, this.seeders + this.leechers, 'Peer list size does not match seeders+leeechers count.');
    
  var should_num = Math.min(this.seeders + this.leechers, want_num);
  var returning_peers = Object.keys(this.peerDict).sample(should_num).map(function (peerId) {
    if (peerId !== requestingPeerId) {
      // don't return myself -- why?
      return this.peerDict[peerId];
    } else {
      return null;
    }
  }).compact();
  
  // Add peers to a buffer
  p.compact.copy(b, c++ * _PEER_IPPORT_COMPACT_SIZE);
}


function Tracker() {
  if (!(this instanceof Tracker)) {
    return new Tracker();
  }

  this.files = {};
}

Tracker.prototype = {
  getFile: function (infoHash) {
    if (this.files.hasOwnProperty(infoHash)) {
      return this.files[infoHash];
    }

    return this.addFile(infoHash);
  },
  addFile: function (infoHash) {
    return (this.files[infoHash] = new File());
  }
};


exports._PEER_IPPORT_COMPACT_SIZE = _PEER_IPPORT_COMPACT_SIZE;
exports.ANNOUNCE_INTERVAL = ANNOUNCE_INTERVAL;

exports.event = event;
exports.Peer = Peer;
exports.Tracker = Tracker;
