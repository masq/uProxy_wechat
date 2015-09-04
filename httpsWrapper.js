/*
 *  @description: A wrapper for the node.js standard "https" module to package the
 *    weChatClient module as a freedom module, by making freedomjs xhr requests
 *    instead of standard GET and POST requests.
 *
 *  @author: Spencer Walden
 *  Date created: July 14th, 2015 
 *
 */

"use strict";

/*
 *  @description: constructor for the "https" module
 */
var https = function() {
  //this.xhr = freedom["core.xhr"]();
}

/*
 *  @description: A substitute for the "https.get(...)" method, substituting in
 *    an xhr request; the only difference is that this will not accept a url as a
 *    string, it must be an object.
 *  @param: {Object} — Takes an object (JSON formatted or not), for the url to request.
 *    @see: The example given for the format of the Object in the request method.
 *  @param: {Function} — A callback to perform on the data returned by the GET request.
 *  @returns {Object} — returns itself
 */
https.prototype.get = function(url, callback) {
  return this.request(url, callback).on("error", function() {
    return request;
  }).end();
}

/*
 *  @description: A substitute for the "https.request(...)" method, replacing any
 *    requests made with an xhr. Useful in freedomjs modules. 
 *  @param: {Object} — Takes an object (JSON formatted or not) for the url to request.
 *    @example: var url = {
 *      "hostname": "www.google.com",
 *      "method": "GET",
 *      "path": "/",
 *      "port": 443
 *    };
 *    // In this module, the port is unneccessary, it will be sent as an https (443) request
 *  @param: {Function} — Takes a callback to perform on the data returned by the request.
 *  @returns {Object} — Returns itself.
 */
https.prototype.request = function(url, callback) {
  var xhr = freedom["core.xhr"]();  // FIXME: never closed; memory leak here.
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
      //console.log(headers);
    }, console.error);
    response.setEncoding = function(encoding) {
      //Don't think I need to do anything here
    };
    (isBinary ? xhr.getResponse() : xhr.getResponseText()).then(function(responseData) {
      response.on = function(eventName, onCallback) {
        if (eventName === "data") {
          if (isBinary) {
            var bytes = new Uint8Array(responseData.string.length);
            var magicNum = "";
            var dataString = "";
            var mimeType = null;
            for (var i = 0; i < responseData.string.length; i++) { 
              bytes[i] = responseData.string.charCodeAt(i);
              dataString += String.fromCharCode(bytes[i]);
            }
            var sub = bytes.subarray(0, 4);
            for (var b = 0; b < 3; b++) {  // each element except for last.
              magicNum += sub[b] + "-";
            }
            magicNum += sub[3]; // last element
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
            var dataURL = "data:" + mimeType + ";base64," + btoa(dataString);
            var imageResult = {
              "iconURLPath": url.path,
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
