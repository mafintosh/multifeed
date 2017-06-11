var hypercore = require('hypercore')
var thunky = require('thunky')
var path = require('path')
var protocol = require('hypercore-protocol')

module.exports = MultiFeed

function MultiFeed (dir, key) {
  if (!(this instanceof MultiFeed)) return new MultiFeed(dir, key)

  var self = this

  this.directory = dir
  this.key = key || null
  this.discoveryKey = null
  this.source = null
  this.me = null
  this.feeds = []
  this.ready = thunky(open)
  this.ready()

  function open (cb) {
    self._open(cb)
  }
}

MultiFeed.prototype._open = function (cb) {
  var self = this
  var source = hypercore(path.join(this.directory, 'source'), this.key, {valueEncoding: 'json'})

  source.ready(function (err) {
    if (err) return cb(err)

    self.source = source
    self.key = source.key
    self.discoveryKey = source.discoveryKey
    self.feeds.push(source)

    if (source.writable) self.me = source
    if (self.me) return onme()

    // lazy load writable peer
    self.me = hypercore(path.join(self.directory, 'me'), {valueEncoding: 'json'})
    self.me.ready(onme)
  })

  function onme (err) {
    if (err) return cb(err)

    if (!self.source.length) return cb()

    // TODO: get latest LOCAL head instead!
    self.source.get(self.source.length - 1, function (err, head) {
      if (err) return cb(err)
      if (head.type !== 'writers') throw new Error('not implemented writer jump')

      head.auth


      console.log('??', head)
    })
  }
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

    self.append({
      type: 'writers',
      feeds: authorized
    }, cb)
  })
}

MultiFeed.prototype.replicate = function () {
  var self = this
  var stream = protocol()

  this.ready(function () {
    self.source.replicate({stream: stream, live: true})
  })

  return stream
}

MultiFeed.prototype.heads = function (cb) {

}

MultiFeed.prototype.append = function (data, cb) {
  if (!cb) cb = noop

  var self = this

  this.ready(function (err) {
    if (err) return cb(err)
    // if (!self.writer) self.writer = hypercore(path.join(self.directory, 'me'))
    self.me.append(data, cb)
  })
}

function noop () {}
