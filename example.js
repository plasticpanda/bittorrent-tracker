var tracker = require("./lib/tracker");

var t = tracker.Tracker();

tracker.http.createServer(t, 6969);
