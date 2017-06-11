var multifeed = require('./')
var m = multifeed('./sandbox/source')

m.ready(function () {
  var c = Multifeed('./sandbox/clone', m.key)

  function init () {
    c.append({hello: 'world'}, function () {
      m.authorize(c.me.key, function (err) {
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

// m.append('hello')
