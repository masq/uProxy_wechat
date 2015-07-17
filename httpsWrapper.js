

var https = function() {
  //this.xhr = freedom["core.xhr"]();
}

https.prototype.get = function(url, callback) {
  if (!url.hostname || !url.path) {
    var domain = url.match(/https:\/\/.*\//)[0].split("//")[1].slice(0,-1);
    var path = url.substring(url.indexOf(domain) + domain.length);
    url = {
      "hostname": domain,
      "path": path
    }
  }
  return this.request(url, callback, true).on("error", function() {
    return request;
  }).end();
}

https.prototype.request = function(url, callback, get) {
  // TODO: never closed, memory leak here... please deal with it.
  var xhr = freedom["core.xhr"]();
  var method;
  if (get) {
    method = "GET";
  } else {
    method = "POST";
  }
  xhr.open(method, "https://" + url.hostname + url.path, true);
  xhr.on("onload", function(thing) {
    xhr.getResponseText().then(function(responseText) {
      var obj = {};
      xhr.getAllResponseHeaders().then(function(headers) {
        obj.headers = headers;
        obj.on = function(eventName, onCallback) {
          if (eventName === "end") {
            onCallback();
          } else if (eventName === "data") {
            onCallback(responseText);
          }
        };
        callback(obj);
      });
    }.bind(this));
  }.bind(this));
  xhr.on("error", function(e) {
    xhr.on("onerror", function() {
      throw e;
    });
  });
  if (url) {
    for (key in url) {
      if (key !== "headers") {
        console.log("Setting header: " + key + " = " + url[key]);
        xhr.setRequestHeader(key, url[key]);
      }
    }
  }
  var request = {};
  request.on = function(eventName, networkErrorCallback) {
    //TODO... maybe...
    request.end = function(data) {
      console.log(data);
      xhr.send(data ? {string: data} : "");
      return xhr; // optional...?
    };
    return request;
  };
  return request;
}

module.exports.https = https;
