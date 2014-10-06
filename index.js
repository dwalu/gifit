var http = require('http')
  , os = require('os')
  , fs = require('fs')
  , glob = require('glob')
  , util = require('util')
  , exec = require('child_process').exec
  , request = require('request')
  , static = require('node-static')
  , url = require('url')
  , twilio = require('twilio')
  , uuid = require('node-uuid')
  , child;

console.log('Starting Node server with incoming phone number: ' + 
  process.env.TWILIO_CALLER_ID);

// The directory where our animated gifs will live
var dir = new static.Server('./public');

// Twilio REST client
var client = new twilio.RestClient();

// Delete any temp files that may have been created
var cleanUp = function(id) {
  console.log('Cleaning up temp files');
  glob(os.tmpdir() + "/" + id + "*", function (err, files) {
    files.forEach(function(file) {
      fs.unlink(file, function (err) {});
    });
  });
}


// Spin up our HTTP server
http.createServer(function(req, res) {
  req.addListener('end', function () {
    // Parse the request URL
    var hash = url.parse(this.url, true);
    // This is the phone number of the person who sent the video
    var phone = hash.query['From'];
    // This is the host the machine serving this Node process 
    var host = this.headers['host']; 
    
    // If the requested path is /message, process the incoming video
    if (hash.pathname === '/message') {
      var mediaUrl = hash.query['MediaUrl0'];
      var mediaContentType = hash.query['MediaContentType0'];
      console.log('Processing video: ', mediaUrl, mediaContentType);
      
      
      res.writeHead(200, {'Content-type': 'text/xml'});
      var twiml = new twilio.TwimlResponse();

      // if media URL looks like a valid video, send ok back to the user
      if (mediaContentType.indexOf('video') >= 0) { 
        twiml.message('Video queued for processing, hang tight!');
        res.end(twiml.toString());
      }
      else {
        twiml.message('This is not a video format that we recognize. Try again?');
        res.end(twiml.toString());
        return;
      }
      
      // create a unique UUID for all of our video/gif processing
      var id = uuid.v1();

      // Save the remote movie file to the /tmp fs
      download = request(mediaUrl).pipe(fs.createWriteStream(
        util.format('%s/%s', os.tmpdir(), id)));

      download.on('finish', function() {
        // Once it's saved, it's time to spin-up a child process to
        // handle decoding the video and building the gif
        child = exec(util.format('avconv -i %s/%s -r 8 -vframes 48 -f image2 %s/%s-%03d.jpeg && convert -delay 12 -loop 0 %s/%s*.jpeg %s/public/%s.gif && convert %s/public/%s.gif -layers optimizeplus %s/public/%s.gif', os.tmpdir(), id, os.tmpdir(), id, os.tmpdir(), id, __dirname, id, __dirname, id, __dirname, id),
          function (error, stdout, stderr) {
            if (error !== null) {
              console.log('exec error: ' + error);
              client.sendMessage({
                to: phone, from: process.env.TWILIO_CALLER_ID, 
                body: 'Very sorry but an error occurred processing your video. Try a different video?'}, 
                function(err, responseData) { 
                  if (err) {
                    console.log('Error sending text: ' + err);
                  }
                });
            }
            else {
              // an assumption made here is that the protocol is HTTP
              var gifUrl = 'http://' + host + '/' + id + '.gif';
              console.log('Success! Gif URL: ', gifUrl);
              client.sendMessage({
                to: phone, from: process.env.TWILIO_CALLER_ID, 
                body: 'Powered by Twilio MMS',
                mediaUrl: gifUrl}, function(err, responseData) { 
                  if (err) {
                    console.log('Error sending MMS: ', err.toString());
                  }
                });
            }
            cleanUp(id);
        });
      });
    }
    else {
        dir.serve(req, res);
    }
  }).resume();
}).listen(process.env.PORT || 3000);

console.log('Listening on port ', process.env.PORT || 3000);
