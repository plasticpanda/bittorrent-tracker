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

function _compact_ip_port(ip, port) {
  var b = new Buffer(6)
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
  this.peerList = [];
  this.peerDict = {};
  this.downloads = 0;
  this.seeders = 0;
  this.leechers = 0;
  this.lastCompact = now();
  
  // private
  this._peerCheck = null;
}


File.prototype._startPeerCheck = function () {
  var that = this;
  
  var _doPeerCheck = function () {
    // Check if it is time to compact the peer list
    var n = now();
    if (that.seeders + that.leechers < that.peerList.length / 2 && that.peerList.length > 10 || (n - that.lastCompact) > ANNOUNCE_INTERVAL * 2) {
      var newPeerList = [];
      var i = 0;
      for (var p in that.peerDict) {
        if (!that.peerDict.hasOwnProperty(p)) {
          continue;
        }

        var tmpPeer = that.peerList[that.peerDict[p]];

        // Check if the peer is still alive
        if (tmpPeer.timedOut(n)) {
          if (tmpPeer.state == PEERSTATE.LEECHER) {
            that.leechers--;
          } else {
            that.seeders--;
          }

          delete that.peerDict[p];
          continue;
        }

        newPeerList.push(tmpPeer);
        that.peerDict[p] = i++;
      }

      that.peerList = newPeerList;

      that.lastCompact = n;
      
      that._peerCheckHandle = setTimeout(_doPeercheck, ANNOUNCE_INTERVAL * 2);
    }
  }
  
  _doPeerCheck();
};


File.prototype.addPeer = function (peerId, peer, event) {

  if (event == EVENT_TYPES.COMPLETED && peer.state == PEERSTATE.SEEDER) {
    this.downloads++;
  }

  // Check if the peer already exists
  if (this.peerDict.hasOwnProperty(peerId)) {
    var index = this.peerDict[peerId];
    var oldPeer = this.peerList[index];

    if (event == EVENT_TYPES.STOPPED) {
      if (oldPeer.state === PEERSTATE.LEECHER) {
        this.leechers--;
      } else {
        this.seeders--;
      }

      delete this.peerList[index];
      delete this.peerDict[peerId];
    } else {
      // TODO: Should probably update compact in the old peer. So we
      // handle the case if the user switched IP or Port. But we
      // probably only want to do it if they differ
      // oldPeer.compact = peer.compact;

      if (oldPeer.state != peer.state) {
        if (peer.state === PEERSTATE.LEECHER) {
          this.leechers++;
          this.seeders--;
        } else {
          this.leechers--;
          this.seeders++;
        }

        oldPeer.state = peer.state;
      }
    }

    peer = oldPeer;
    peer.touch();

  } else if (event != EVENT_TYPES.STOPPED) {
    this.peerDict[peerId] = this.peerList.length;
    this.peerList.push(peer);

    if (peer.state === PEERSTATE.LEECHER) {
      this.leechers++;
    } else {
      this.seeders++;
    }
  }

  return peer;
};
  
  
  
  writePeers: function (b, count, selfPeer) {
    var c = 0
      , i
      , p;
      
    if (count > this.seeders + this.leechers) {
      for (i = this.peerList.length - 1; i >= 0; i--) {
        p = this.peerList[i];
        if (p != undefined && p != selfPeer) {
          p.compact.copy(b, c++ * PEER_COMPACT_SIZE);
        }
      }
    } else {
      var m = Math.min(this.peerList.length, count);
      for (i = 0; i < m; i++) {
        var index = Math.floor(Math.random() * this.peerList.length);
        p = this.peerList[index];
        if (p != undefined && p != selfPeer) {
          p.compact.copy(b, c++ * PEER_COMPACT_SIZE);
        }
      }
    }

    return c * PEER_COMPACT_SIZE;
  }
};

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


exports.PEER_COMPACT_SIZE = PEER_COMPACT_SIZE;
exports.ANNOUNCE_INTERVAL = ANNOUNCE_INTERVAL;

exports.event = event;
exports.Peer = Peer;
exports.Tracker = Tracker;
