var hypercore = require('hypercore')
var thunky = require('thunky')
var path = require('path')
var raf = require('random-access-file')
var protocol = require('hypercore-protocol')
var inherits = require('inherits')
var events = require('events')
var toBuffer = require('to-buffer')

module.exports = MultiFeed

function MultiFeed (storage, key, opts) {
  if (!(this instanceof MultiFeed)) return new MultiFeed(storage, key, opts)

  if (isOptions(key)) {
    opts = key
    key = null
  }
  if (!opts) opts = {}

  events.EventEmitter.call(this)

  var self = this

  this.storage = typeof storage === 'string' ? fileStorage : storage
  this.key = key ? toBuffer(key, 'hex') : null
  this.discoveryKey = null
  this.sparse = opts.sparse
  this.source = null
  this.local = null
  this.feeds = []
  this.ready = thunky(open)
  this.ready()

  function fileStorage (name) {
    return raf(name, {directory: storage})
  }

  function open (cb) {
    self._open(cb)
  }
}

inherits(MultiFeed, events.EventEmitter)

MultiFeed.prototype._createFeed = function (dir, key) {
  var self = this
  var feed = hypercore(storage, key, {
    valueEncoding: 'json', // TODO; use protobuf
    sparse: this.sparse
  })

  feed.on('append', function () {
    self.emit('append', feed)
  })

  return feed

  function storage (name) {
    return self.storage(path.join(dir, name))
  }
}

MultiFeed.prototype._open = function (cb) {
  var self = this
  var source = this._createFeed('source', this.key)

  source.ready(function (err) {
    if (err) return cb(err)

    self.source = source
    self.key = source.key
    self.discoveryKey = source.discoveryKey
    self.feeds.push(source)
    self.emit('add-feed', source)

    if (source.writable) self.local = source
    if (self.local) return onme()

    self.local = self._createFeed('local')
    self.local.ready(onme)
  })

  function done () {
    var missing = self.feeds.length
    var error = null

    for (var i = 0; i < self.feeds.length; i++) self.feeds[i].ready(onready)

    function onready (err) {
      if (err) error = err
      if (--missing) return
      cb(null)
    }
  }

  function onme (err) {
    if (err) return cb(err)
    if (self.local.length > 0) return update(null)
    self.local.append({type: 'multifeed', version: 0}, update)
  }

  function update (err) {
    if (err) return cb(err)
    self._update({cached: true}, done)
  }
}

MultiFeed.prototype._addFeed = function (key) {
  if (key.equals(this.local.key)) {
    if (this.feeds.indexOf(this.local) > -1) return false
    this.feeds.push(this.local)
    this.emit('add-feed', this.local)
    return true
  }

  for (var i = 0; i < this.feeds.length; i++) {
    if (this.feeds[i].key.equals(key)) return false
  }

  var dk = hypercore.discoveryKey(key).toString('hex')
  var feed = this._createFeed('feeds/' + dk.slice(0, 2) + '/' + dk.slice(2, 4) + '/' + dk.slice(4), key)

  this.feeds.push(feed)
  this.emit('add-feed', feed)

  return true
}

MultiFeed.prototype.authorize = function (key, cb) {
  if (!cb) cb = noop

  var self = this
  var hex = key.toString('hex')

  this.ready(function (err) {
    if (err) return cb(err)

    var authorized = self.feeds
      .filter(function (feed) {
        return feed.key.toString('hex') !== hex
      })
      .map(function (feed) {
        return feed.key
      })
      .map(function (key) {
        return key.toString('hex') // gonna be removed!
      })

    authorized.push(key.toString('hex'))

    self.local.append({
      type: 'writers',
      feeds: authorized
    }, onappend)

    function onappend (err) {
      if (err) return cb(err)
      self._update({cached: true}, cb)
    }
  })
}

MultiFeed.prototype.replicate = function () {
  var self = this
  var stream = protocol({live: true})

  this.ready(function () {
    for (var i = 0; i < self.feeds.length; i++) onfeed(self.feeds[i])
    self.on('add-feed', onfeed)
    stream.on('close', onclose)
  })

  return stream

  function onclose () {
    self.removeListener('add-feed', onfeed)
  }

  function onfeed (feed) {
    feed.replicate({stream: stream, live: true})
  }
}

MultiFeed.prototype.add = function (links, value, cb) {
  if (!cb) cb = noop

  var self = this

  this.ready(function (err) {
    if (err) return cb(err)

    var node = {
      links: links,
      value: value
    }

    self.local.append(node, cb)
  })
}

MultiFeed.prototype.append = function (value, cb) {
  if (!cb) cb = noop

  var self = this

  this.ready(function (err) {
    if (err) return cb(err)

    var links = []
    for (var i = 0; i < self.feeds.length; i++) {
      var feed = self.feeds[i]
      if (!feed.length || feed === self.local) continue

      links.push({
        key: feed.key.toString('hex'),
        seq: feed.length - 1
      })
    }

    self.add(links, value, cb)
  })
}

MultiFeed.prototype.update = function (cb) {
  var self = this

  this.ready(function (err) {
    if (err) return cb(err)
    self._update(null, cb)
  })
}

MultiFeed.prototype._update = function (opts, cb) {
  var self = this
  var missing = this.feeds.length
  var error = null
  var changed = false

  for (var i = 0; i < this.feeds.length; i++) {
    getLinkedFeeds(this.feeds[i], opts, onlinks)
  }

  function onlinks (err, keys) {
    if (err) error = err

    if (keys) {
      for (var i = 0; i < keys.length; i++) {
        if (self._addFeed(keys[i])) changed = true
      }
    }

    if (--missing) return
    if (error) return cb(error)
    if (changed) return self._update(opts, cb)
    cb(null)
  }
}

function getLength (feed) {
  var len = feed.length

  for (var i = 0; i < feed.peers.length; i++) {
    if (feed.peers[i].remoteLength > len) len = feed.peers[i].remoteLength
  }

  return len
}

function getLinkedFeeds (feed, opts, cb) {
  var cached = !!(opts && opts.cached)
  var len = cached ? feed.length : getLength(feed)

  if (!len) {
    if (!cached) return feed.update(retry)
    return cb(null, [])
  }

  var top = len - 1
  feed.get(top, onhead)

  function retry (err) {
    if (err) return cb(err)
    getLinkedFeeds(feed, opts, cb)
  }

  function onhead (err, head) {
    if (err) return cb(err)

    if (head.type !== 'writers') {
      if (top === 0) return cb(null, [])
      return feed.get(top - 1, onhead)
    }

    var keys = head.feeds.map(function (key) {
      return new Buffer(key, 'hex')
    })

    cb(null, keys)
  }
}

function noop () {}

function isOptions (opts) {
  return !!(opts && typeof opts !== 'string' && !Buffer.isBuffer(opts))
}
