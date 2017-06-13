var multifeed = require('./')
var ram = require('random-access-memory')

var m = multifeed(ram, {sparse: true})

m.on('add-feed', function (feed) {
  console.log('m: added, ' + feed.key.toString('hex'))
})

m.on('append', function () {
  // m.update(noop)
})


m.append({hello: 'world'})

m.ready(function () {
  var d = multifeed(ram, m.key, {sparse: true})
  var c = multifeed(ram, m.key, {sparse: true})

  c.on('add-feed', function (feed) {
    console.log('c: added, ' + feed.key.toString('hex'))
  })

  d.on('add-feed', function (feed) {
    console.log('d: added, ' + feed.key.toString('hex'))
  })

  c.on('append', function () {
    // c.update(noop)
  })

  d.on('append', function () {
    // d.update(noop)
  })

  c.ready(function (err) {
    if (err) throw err

    d.ready(function (err) {
      if (err) throw err

      console.log('m === ' + m.local.key.toString('hex'), 'local.length', m.local.length)
      console.log('c === ' + c.local.key.toString('hex'), 'local.length', m.local.length)
      console.log('d === ' + d.local.key.toString('hex'), 'local.length', m.local.length)

      console.log()
      console.log()

      c.authorize(d.local.key, function (err) {
        if (err) throw err
        console.log('d authorized')
      })

      m.authorize(c.local.key, function () {
        console.log('replicating')

        connect(m, c, function () {
          connect(m, d, function () {
            connect(c, d, onconnected)
          })
        })
      })
    })
  })

  function onconnected () {
    m.update(function () {
      console.log('m has ' + m.feeds.length + ' feeds')
    })
    c.update(function () {
      console.log('c has ' + c.feeds.length + ' feeds')
    })
    d.update(function () {
      console.log('d has ' + c.feeds.length + ' feeds')
    })
  }

  function connect (a, b, cb) {
    var s1 = a.replicate()
    var s2 = b.replicate()

    s1.pipe(s2).pipe(s1)
    s1.once('handshake', cb)
  }

  // init()

  function init () {
    c.append({hello: 'world'}, function () {
      m.authorize(c.local.key, function (err) {
        if (err) throw err

        console.log('-->', m.feeds[0].has(0))

        m.feeds[0].get(0, console.log)

        var s1 = m.replicate()
        var s2 = c.replicate()

        s1.pipe(s2).pipe(s1)
      })
    })
  }

})


function noop () {}
// m.append('hello')
