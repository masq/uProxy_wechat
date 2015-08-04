"use strict";

var https = function() {
  //this.xhr = freedom["core.xhr"]();
}

https.prototype.get = function(url, callback) {
  return this.request(url, callback).on("error", function() {
    return request;
  }).end();
}

https.prototype.request = function(url, callback) {
  var xhr = freedom["core.xhr"]();  // TODO: never closed, memory leak here.
  var isBinary = (url.encoding ? true : false);

  xhr.open(url.method, "https://" + url.hostname + url.path, true);
  if (isBinary) xhr.overrideMimeType("text/plain; charset=x-user-defined");
  if (typeof url === "object") {
    for (var key in url) {
      if (key !== "headers") {
        //console.log("Setting header: " + key + " = " + url[key]);  // Verbose
        xhr.setRequestHeader(key, url[key]);
      }
    }
  }
  xhr.on("error", function(e) {
    xhr.on("onerror", function() {
      console.error(Error(e));
      throw e;
    });
  });
  xhr.on("onload", function(thing) {
    var response = {};
    xhr.getAllResponseHeaders().then(function(headers) {
      response.headers = headers;
    }, console.error);
    response.setEncoding = function(encoding) {
      //Don't think I need to do anything here
    };
    (isBinary ? xhr.getResponse() : xhr.getResponseText()).then(function(responseData) {
      response.on = function(eventName, onCallback) {
        if (eventName === "data") {
          if (isBinary) {
            // TODO: see if there is a better way to make the "data" event promise-able, so we 
            // don't make the "end" event get called when not all of the data has been processed.
            // Right now, I'm just running through this code twice for "data" and "end". 
            // If it's the end though, I don't pass anything back.
            var bytes = new Uint8Array(responseData.string.length);
            var magicNum = "";
            var dataString = "";
            var mimeType = null;
            for (var i = 0; i < responseData.string.length; i++) { 
              bytes[i] = responseData.string.charCodeAt(i);
              dataString += String.fromCharCode(bytes[i]);
              if (i < 4) {
                magicNum += bytes[i] + (i < 3 ? "-" : "");
              }
            }
            // Yes, I'm reading the file headers here since I had to strip off the mimeType
            // earlier so it wasn't passed to me encoded >_> 
            if (magicNum === "255-216-255-224") {  // yoya
              mimeType = "image/jpeg";
            } else if (magicNum === "137-80-78-71") {  // .PNG
              mimeType = "image/png";
            } else {
              mimeType = "image/webp";
              console.log("Unsupported image type: " + magicNum);
            }
            var blob = new Blob([bytes], {type: mimeType}); 
            var blobURL = URL.createObjectURL(blob); // just to see breakage.
            var dataURL = "data:" + mimeType + ";base64," + btoa(dataString);
            var imageResult = {
              "iconURLPath": url.path,
              "blobURL": blobURL,
              "dataURL": dataURL
            };
            onCallback(JSON.stringify(imageResult));
          } else {
            onCallback(responseData);
          }
        } else if (eventName === "end") {
          onCallback();
        }
      }.bind(this);
      callback(response);
    }.bind(this), function(e) {
      console.error("[-] " + Error(e));
      throw e;
    });
  }.bind(this));

  var request = {};
  request.on = function(eventName, networkErrorCallback) {
    request.end = function(data) {
      var toSend = "";
      if (data) {
        //console.log("PostData: " + data);  // Verbose
        toSend = {string: data};
      }
      xhr.send(toSend);
      return xhr; // optional...?
    };
    return request;
  };
  return request;
}.bind(this);

module.exports.https = https;
