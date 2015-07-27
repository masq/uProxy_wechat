/*
 *  Author: Spencer Walden
 *  Date:   June 16th, 2015
 *
 *  Description: This is proof of concept code for authentication with the WeChat
 *          webclient. It will hopefully help with WeChat authentication
 *          support in uProxy as a social provider.
 *
 */

/********** Requires **********/
"use strict";
var httpsWrapper = require("./httpsWrapper.js");
var https = new httpsWrapper.https();
var chalk = require("chalk");

/********** Globals **********/

var weChatClient = function() {
  this.debug = true;

  this.LOGDOM  = "login.wechat.com";  // "login.weixin.qq.com" for zh_CN/qq users.
  this.WEBDOM  = "web2.wechat.com";  // "wx.qq.com" for zh_CN/qq users.
  this.WEBPATH = "/cgi-bin/mmwebwx-bin/";
  this.SYNCDOM = "webpush2.wechat.com";
  this.USERAGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/43.0.2357.81 Safari/537.36";

  this.events = {};
  this.events.onMessage = function(message) { return; };
  this.events.onQRCode = function(qrCode) { return; };
  this.events.onIcon = function(iconURLPath) { return; };
  this.events.onUUID = function(url) { return; };
  
  this.QRserver = null;  // QRserver... serves QR code at localhost:8000 (for now)
  this.cookies = [];  // cookies to be sent in requests.
  this.syncKeys = null;  // Object with List of key/value objects, and Count=List.Length
  this.contacts = [];  // List of user objects.
  this.thisUser = null;  // User object.
  this.slctdUser = null;  // User we're currently watching messages from
  this.messages = [];  // List of message objects.
};

module.exports.weChatClient = weChatClient;

/*********************************** FUNCTIONS *********************************/

// Checks to see if there is new data relevant to the current user
weChatClient.prototype.synccheck = function(loginData) {
  this.log(2, "Looping to check for updates");
  var retcode = 0;
  return this.promiseWhile(function() {
    return new Promise(function (resolve, reject) {
      if (retcode === 0) resolve(retcode);
      else reject(retcode);
    });
  }, function() {
    return new Promise(function (resolve, reject) {
      var syncParams = {  // #encodeeverythingthatwalks
        "r": Date.now(),
        "skey": encodeURIComponent(loginData.skey),
        "sid": encodeURIComponent(loginData.wxsid),
        "uin": encodeURIComponent(loginData.wxuin),
        "deviceid": this.getDeviceID(),
        "synckey": encodeURIComponent(this.formSyncKeys()),
        "lang": "en_US",
        "pass_ticket": encodeURIComponent(loginData.pass_ticket)
      };
      var url = this.makeURL(this.SYNCDOM, this.WEBPATH + "synccheck", syncParams);
      https.get(url, function(response) {
        var result = "";
        if (response.headers["set-cookie"]) {
          this.updateCookies(response.headers["set-cookie"]);
        }
        response.on("error", this.handleError);
        response.on("data", function(chunk) {
          result += chunk;
        });
        response.on("end", function() {
          try {
            //this.log(4, "Synccheck response: " + result);  // Verbose
            var fields = result.split("=")[1].trim().slice(1, -1).split(",");
            //this.log(2, "SyncCheck: { Retcode: " + retcode + ", Selector: " + type + " }");  // Verbose
            retcode  = parseInt(fields[0].split(":")[1].slice(1,-1), 10);
            var type = parseInt(fields[1].split(":")[1].slice(1,-1), 10);
            this.log(2, "SyncCheck: { Retcode: " + retcode + ", Selector: " + type + " }");  // Verbose
            if (retcode !== 0) this.log(-1, "Synccheck error code: " + retcode);
            if (type === 0) {  // when selector is zero, just loop again.
              this.log(-1, "Syncchecked with type " + type + ". No new info..");
              resolve();
            } else {
              // sendmessage just happens,
              // webwxsync gets data based on Selector passed by synccheck.
              // possibly need to call StatusNotify on certain Selectors
              // to recieve messages... TBD
              // type 1 is profile sync.
              // type 2 is sync. FIXME  // typically associated with sendmessage
              // think type 2 is new synckey
              // type 4 is ModContact sync.  // typically associated with sendmessage
              // type 7 is AddMsg sync.
              //  MMWEBWX_OK = 0 ,
              //  MMWEBWX_ERR_SYS = -1 ,
              //  MMWEBWX_ERR_LOGIC = -2 ,
              //  MMWEBWX_ERR_SESSION_NOEXIST = 1100,
              //  MMWEBWX_ERR_SESSION_INVALID = 1101,
              //  MMWEBWX_ERR_PARSER_REQUEST = 1200,
              //  MMWEBWX_ERR_FREQ = 1205 // 频率拦截

              resolve(this.webwxsync(loginData, type));
            }
          } catch(e) {
            handleError(e);
          }
        }.bind(this));
      }.bind(this)).on("error", this.handleError);
    }.bind(this));
  }.bind(this), function() {  // also is getting passed the retcode in case of code revision, ignored here.
    if (retcode === 1100) {
      this.log(-1, "Attempted to synccheck a nonexistant session");
    } else {
      if (retcode === 1101) {
        this.log(-1, "Attempted to synccheck an invalid session");
      } else if (retcode === 1200) {
        this.log(-1, "Webservice couldn't understand your request.");
      }
      this.handleError(retcode);
    }
  }.bind(this));
}

// takes type selector to select a corresponding type of data from the response to
// possibly store.
// is POST request to web2.wechat.com/cgi-bin/mmwebwx-bin/webwxsync with query
// parameters of sid, skey, lang, and pass_ticket, and postData of BaseRequest, syncKey
// object, and the bitflip of the currrent time.
//    syncKey has a count field which is the amount of keys, and then the list
//    of keys, each an object as Key: N, and Value.
// responds with JSON, most notably the syncKeys.
weChatClient.prototype.webwxsync = function (loginData, type) {
  return new Promise(function (resolve, reject) {
    var postData = JSON.stringify({
      "BaseRequest": {
        "Uin": loginData.wxuin,
        "Sid": loginData.wxsid,
        "Skey": loginData.skey,
        "DeviceID": this.getDeviceID()
      },
      "SyncKey": this.syncKeys,
      "rr": ~Date.now()
    });
    var params = {
      "sid": loginData.wxsid,
      "skey": loginData.skey,
      "lang": "en_US",
      "pass_ticket": loginData.pass_ticket
    };
    var url = this.makeURL(this.WEBDOM, this.WEBPATH + "webwxsync", params, postData.length);
    //this.log(2, "posting: " + postData);  // Verbose
    //this.log(2, "requesting: " + JSON.stringify(url));  // Verbose
    var request = https.request(url, function(response) {
      var result = "";
      if (response.headers["set-cookie"]) {
        this.updateCookies(response.headers["set-cookie"]);
      }
      response.on("error", this.handleError);
      response.on("data", function(chunk) {
        result += chunk;
      });
      response.on("end", function() {
        var jason;
        try {
          jason = JSON.parse(result);
          //this.log(1, "webwxsync response: " + JSON.stringify(jason));  // Verbose
          if (jason.BaseResponse.Ret !== 0) {
            this.log(-1, "webwxsync error: " + jason.BaseResponse.Ret);
          }
          // TODO: check type here and get relevant data.
          // BaseResponse
          // AddMsgCount: n => AddMsgList
          // ModContactCount: n => ModContactList
          // DelContactCount: n => DelContactList
          // ModChatRoomMemberCount: n => ModChatRoomMemberList
          // Profile [obj]
          // ContinueFlag: n
          // SyncKey
          // Skey
          if (jason.AddMsgCount !== 0) {
            for (var i = 0; i < jason.AddMsgList.length; i++) {
              var currMsg = jason.AddMsgList[i];
              this.messages.push(currMsg);
              if (!currMsg.StatusNotifyCode) {
                // For only handling plaintext messages here ( && currMsg.MsgType === 1)
                var from = currMsg.FromUserName;
                var sender = "<unknown>";
                for (var j = 0; j < this.contacts.length; j++) {
                  if (from === this.contacts[j].UserName) {
                    sender = this.contacts[j].NickName;
                    this.events.onMessage(currMsg);
                    j = this.contacts.length;
                  }
                }
                var ts = this.formTimeStamp(currMsg.CreateTime * 1000);
                if (!this.slctdUser || from !== this.slctdUser) {
                  this.log(3, ts + "Recieved message from \"" + sender + "\"", -1);
                } else {
                  this.log(5, ts + currMsg.Content, -1);
                }
                this.webwxStatusNotify(loginData, 1, from);
              }
            }
          }
          //if (jason.SyncKey.Count !== syncKeys.Count) {
          //  syncKeys = jason.SyncKey;
          //}
          this.syncKeys = jason.SyncKey;
          //this.log(0, "Synced with type " + type);  // Verbose
          resolve();
        } catch (air) {
          handleError(air);
        }
      }.bind(this));
    }.bind(this)).on("error", this.handleError);
    request.end(postData);
  }.bind(this));
}

// Sends a message
//
// msg is an object with an integer type (1 for plaintext, 51 for hidden), a string content, and
// a recipient taken from the contacts list (or any other wechat UserName).
weChatClient.prototype.webwxsendmsg = function (loginData, msg) {
  var id = this.getMessageId();
  var params = {
    "lang": "en_US",
    "pass_ticket": loginData.pass_ticket
  };
  var postData = JSON.stringify({
    "BaseRequest": {
      "Uin": loginData.wxuin,
      "Sid": loginData.wxsid,
      "Skey": loginData.skey,
      "DeviceID": this.getDeviceID()
    },
    "Msg": {
      "Type": msg.type,
      "Content": msg.content,
      "FromUserName": this.thisUser.UserName,
      "ToUserName": msg.recipient,
      "LocalID": id,
      "ClientMsgId": id
    }
  });
  var url = this.makeURL(this.WEBDOM, this.WEBPATH + "webwxsendmsg", params, postData.length);
  var request = https.request(url, function(response) {
    var result = "";
    if (response.headers["set-cookie"]) {
      this.updateCookies(response.headers["set-cookie"]);
    }
    response.on("error", this.handleError);
    response.on("data", function(chunk) {
      result += chunk;
    });
    response.on("end", function() {
      try {
        var jason = JSON.parse(result);
        //this.log(4, "sendmessage response: " + result);  // Verbose
        var ts = this.formTimeStamp(parseInt(id.slice(0, -4)));
        this.log(0, ts + "Message sent");
        if (jason.BaseResponse.Ret !== 0) {
          this.log(-1, "sendmessage error: " + jason.BaseResponse.Ret);
        }

        this.messages.push(JSON.parse(postData).Msg);
        //TODO: want jason.MsgID (the messages' ID within their database)
        //or to keep msg.id?
      } catch(e) {
        handleError(e);
      }
    }.bind(this));
  }.bind(this)).on("error", this.handleError);
  request.end(postData);
}

// Called when receiving a message. Also once at login.
weChatClient.prototype.webwxStatusNotify = function(loginData, statCode, sender) {
  // StatusNotify is a post request.
  if (statCode === 3) {
    this.log(2, "Notifying others of login");
  }
  return new Promise(function (resolve, reject) {
    var params = {
      "lang": "en_US"
    };
    var from = (!sender ? this.thisUser.UserName : sender);
    var postData = JSON.stringify({
      "BaseRequest": {
        "Uin": loginData.wxuin,
        "Sid": loginData.wxsid,
        "Skey": loginData.skey,
        "DeviceID": this.getDeviceID()
      },
      "Code": statCode,  // 3 for init, 1 for typical messages
      "FromUserName": this.thisUser.UserName,
      "ToUserName": from,
      "ClientMsgId": Date.now()
    });
    var url = this.makeURL(this.WEBDOM, this.WEBPATH + "webwxstatusnotify", params, postData.length);
    var request = https.request(url, function(response) {
      var data = "";
      if (response.headers["set-cookie"]) {
        this.updateCookies(response.headers["set-cookie"]);
      }
      response.on("error", this.handleError);
      response.on("data", function(chunk) {
        data += chunk;
      });
      response.on("end", function() {
        var jason = JSON.parse(data);
        //this.log(2, JSON.stringify(jason));  // verbose
        if (jason.BaseResponse.ErrMsg) {
          this.log(-1, jason.BaseResponse.ErrMsg);
        }
        if (statCode === 3) this.log(0, "Other devices notified of login");
        else if (statCode === 1) this.log(0, "Other devices notified of message");
        resolve();
      }.bind(this));
    }.bind(this)).on("error", this.handleError);
    request.end(postData);
  }.bind(this));
}

// Logs the current user out.
weChatClient.prototype.webwxlogout = function(loginData) {
  return new Promise(function (resolve, reject) {
    var params = {
      "redirect": 0,  // They normally do 1 here, but I don't think I want redirect.
      "type": 0,
      "skey": loginData.skey
    };
    var postData = "sid=" + loginData.wxsid + "&uin=" + loginData.wxuin;
    var url = this.makeURL(this.WEBDOM, this.WEBPATH + "webwxlogout", params, postData.length);
    var request = https.request(url, function(response) {
      var result = "";
      response.on("error", this.handleError);
      response.on("data", function(chunk) {
        result += chunk;
      });
      response.on("end", function() {
        //this.log(4, "logout result: " + result);  // Verbose
        // ^ this literally sends back nothing.
        this.log(0, "Logged out");
        if (this.QRserver) this.QRserver.close();
        resolve();
      }.bind(this));
    }.bind(this)).on("error", this.handleError);
    request.end(postData);
  }.bind(this));
}

// Gets the icon/photo for a contact, given the friends iconURLPath.
// also accepts a current and total number of contact icons to get.
weChatClient.prototype.webwxgeticon = function() {
  this.log(1, "Getting contacts' icons");
  var completed = [];
  var max = this.contacts.length;
  for (var i = 0; i < max; i++) {
    var iconURLPath = this.contacts[i].HeadImgUrl;
    var the_earl_of_iconia = this.makeURL(this.WEBDOM, iconURLPath, "");
    the_earl_of_iconia["encoding"] = "binary";  // FIXME
    completed.push(false);
    https.get(the_earl_of_iconia, function(response) {
      if (response.headers["set-cookie"]) {
        this.updateCookies(response.headers["set-cookie"]);
      }
      response.setEncoding("binary");
      var result = "";
      response.on("error", this.handleError);
      response.on("data", function(chunk) {
        result += chunk;
      });
      response.on("end", function() {
        this.log(4, "result = " + result);
        this.events.onIcon(result);  // icon image
      }.bind(this));
    }.bind(this)).on("error", this.handleError);
  }
}

// Gets contact list.
weChatClient.prototype.webwxgetcontact = function (loginData, noGetIcon) {
  this.log(1, "Getting ContactList");
  return new Promise(function (resolve, reject) {
    var clParams = {
      "lang": "en_US",
      "pass_ticket": loginData.pass_ticket,
      "r": Date.now(),
      "skey": loginData.skey
    };
    var url = this.makeURL(this.WEBDOM, this.WEBPATH + "webwxgetcontact", clParams);
    //this.log(4, JSON.stringify(the_earl_of_contax));  // Verbose
    https.get(url, function(response) {
      var result = "";
      if (response.headers["set-cookie"]) {
        this.updateCookies(response.headers["set-cookie"]);
      }
      response.on("error", this.handleError);
      response.on("data", function(chunk) {
        result += chunk;
      });
      response.on("end", function() {
        try {
          var jason = JSON.parse(result);
          //this.log(4, "Contacts received: " + JSON.stringify(jason));  // Verbose
          if (jason.BaseResponse.ErrMsg) {
            this.log(-1, jason.BaseResponse.ErrMsg);
          }
          for (var i = 0; i < jason.MemberList.length; i++) {
            if (jason.MemberList[i].UserName.startsWith("@")) {
              this.contacts.push(jason.MemberList[i]);
            }
          }
          this.log(0, "Got ContactList");
          if (!noGetIcon) this.webwxgeticon();
          resolve(loginData);
        } catch (e) {
          this.handleError(e);
        }
      }.bind(this));
    }.bind(this)).on("error", this.handleError);
  }.bind(this));
}

// Gets session data from the passed URL.
//
// returns a promise, resolved with an object containing skey, sid, uin, pass_ticket.
// sets cookies in the form of one long string separated by "; ", in key=value format.
weChatClient.prototype.webwxnewloginpage = function (redirectURL) {
  redirectURL += "&fun=new&version=v2";
  var url = this.makeURL(this.WEBDOM, redirectURL.substring(redirectURL.indexOf(this.WEBPATH)), "");
  this.log(1, "Getting login data");
  return new Promise(function (resolve, reject) {
    https.get(url, function(response) {
      var xml = "";
      if (response.headers["set-cookie"]) {
        this.updateCookies(response.headers["set-cookie"]);
      }
      response.on("error", this.handleError);
      response.on("data", function(chunk) {
        xml += chunk;
      });
      response.on("end", function() {
        var loginData = {
          "skey": "",
          "wxsid": "",
          "wxuin": "",
          "pass_ticket": ""
        };
        for (var key in loginData) {
          var openTag  = "<" + key + ">";
          var closeTag = "</" + key + ">";
          var begin = xml.indexOf(openTag) + openTag.length;
          var end   = xml.indexOf(closeTag);
          var value = xml.substring(begin, end);
          loginData[key] = value;
          this.log(4, "Got xml data: " + key + " = " + value);  // Verbose
        }
        this.log(4, "Cookies: " + this.formCookies());  // Verbose
        this.log(0, "Got login data");
        resolve(loginData);
      }.bind(this));
    }.bind(this)).on("error", this.handleError);
  }.bind(this));
}

// Gets the initial data for the current user.
//
// returns a Promise
weChatClient.prototype.webwxinit = function (loginData) {
  // init is a post request.
  this.log(1, "Logging in");
  return new Promise(function (resolve, reject) {
    var params = {
      "r": ~Date.now(),
      "lang": "en_US",
      "pass_ticket": loginData.pass_ticket
    };
    var postData = JSON.stringify({
      "BaseRequest": {
        "Uin": loginData.wxuin,
        "Sid": loginData.wxsid,
        "Skey": loginData.skey,
        "DeviceID": this.getDeviceID()
      }
    });
    var url = this.makeURL(this.WEBDOM, this.WEBPATH + "webwxinit", params, postData.length);
    var request = https.request(url, function(response) {
      var data = "";
      if (response.headers["set-cookie"]) {
        this.updateCookies(response.headers["set-cookie"]);
      }
      response.on("error", this.handleError);
      response.on("data", function(chunk) {
        data += chunk;
      });
      response.on("end", function() {
        try {
          //this.log(2, "data: " + data);  // verbose
          var jason = JSON.parse(data);
          if (jason.BaseResponse.Ret) {
            this.log(-1, jason.BaseResponse.Ret);
          }
          //contacts = jason.ContactList;
          // this gets less contacts than webwxgetcontact, but it DOES get
          // the file transfer agent's user, whereas webwxgetcontact does not.
          this.thisUser = jason.User;
          this.syncKeys = jason.SyncKey;
          this.log(0, "\"" + this.thisUser.NickName + "\" is now logged in");
          this.webwxStatusNotify(loginData, 3);
          resolve(loginData);
        } catch (e) {
          handleError(e);
        }
      }.bind(this));
    }.bind(this)).on("error", this.handleError);
    request.end(postData);
  }.bind(this));
}

// Gets the uuid for the session.
weChatClient.prototype.getUUID = function() {
  var uuidURLParameters = {
    "appid": "wx782c26e4c19acffb",
    "redirect_uri": encodeURIComponent("https://" + this.WEBDOM + this.WEBPATH + "webwxnewloginpage"),
    "fun": "new",
    "lang": "en_US"
  };
  var url = this.makeURL(this.LOGDOM, "/jslogin", uuidURLParameters);
  this.log(1, "Getting UUID");
  return new Promise(function(resolve, reject) {
    https.get(url, function(response) {
      var data = "";
      response.on("error", this.handleError);
      response.on("data", function(chunk) {
        data += chunk;
      });
      response.on("end", function() {
        var uuid = data.split(";")[1].split(" = ")[1].trim().slice(1,-1);
        this.log(0, "Got UUID " + uuid);
        this.events.onUUID("https://" + this.LOGDOM + "/qrcode/" + uuid);
        resolve(uuid);
      }.bind(this));
    }.bind(this)).on("error", this.handleError);
  }.bind(this));
}

// Gets the QR code corresponding to the given uuid.
// takes the url of where to get the QR code from as a parameter.
weChatClient.prototype.getQR = function(uuid) {
  var url = this.makeURL(this.LOGDOM, "/qrcode/" + uuid, { "t": "webwx" });
  this.log(1, "Getting QR code");
  return new Promise(function(resolve, reject) {
    https.get(url, function(response) {
      var imgQR = "";
      response.setEncoding("binary");
      response.on("error", this.handleError);
      response.on("data", function(chunk) {
        imgQR += chunk;
      });
      response.on("end", function() {
        this.log(0, "Got QR code");
        resolve(imgQR);
      }.bind(this));
    }.bind(this)).on("error", this.handleError);
  }.bind(this));
}

// Gets the QR code corresponding to the given UUID, Saves the QR code to disk,
// and then creates a server displaying it.
weChatClient.prototype.serveQR = function(uuid) {
  this.getQR(uuid).then(function(imgQR) {
    this.handlers["onQRCode"](imgQR, uuid);
  }.bind(this), this.handleError);
}


// Pings server for indication of the QR code being scanned. Upon being scanned,
// gets a response code of 201, and  200 when confirmed. A response code of 408
// shows up when the ping "expires", and another ping needs to be sent. 400 shows
// up when this QR expires, which means we need to start this whole process over.
//
// returns promise.
weChatClient.prototype.checkForScan = function(uuid, noGetQR) {
  if (!noGetQR) this.serveQR(uuid);
  var result = { "code": 999 };  //initialize to nonexistant http code.
  var tip;
  this.log(2, "Checking for response codes indicating QR code scans");
  return this.promiseWhile(function() {
    return new Promise(function (resolve, reject) {
      //test if url exists in the result, and the QR hasn't expired.
      if ((result.code !== 400) && (!result.url))
        resolve(result);
      else  // Want this case, means we got redirect url.
        reject(result);
    });
  }, function() {  // Check server for code saying there's been a scan.
    return new Promise(function (resolve, reject) {
      if (typeof tip !== "number") tip = 1;  // tip is set to 1 on first request, zero otherwise
      else {
        this.log(2, "Checking for response code");
        tip = 0;
      }
      var params = {
        "loginicon": true,
        "uuid": uuid,
        "tip": tip,
        "r": ~Date.now(),
        "lang": "en_US"
      };
      var the_Czech_earl = this.makeURL(this.LOGDOM, this.WEBPATH + "login", params);
      //this.log(3, the_Czech_earl);
      https.get(the_Czech_earl, function(response) {
        var data = "";
        response.on("error", this.handleError);
        response.on("data", function(chunk) {
          data += chunk;
        });
        response.on("end", function() {
          //this.log(3, data);
          var values = data.split(";");
          result.code = parseInt(values[0].split("=")[1]);
          var sign;
          var respCode = "Got response code " + result.code + ": ";
          var meaning  = "";
          if (parseInt(result.code / 100) === 2) {
            sign = 0;
            if (result.code === 200) {
              meaning += "Login confirmed, got redirect URL";
              var temp = values[1].trim();
              result.url = temp.slice(temp.indexOf("https://"), -1);
            } else if (result.code === 201) {
              meaning += "QR code scanned, confirm login on phone";
            }
          } else {
            sign = -1;
            if (result.code === 400) {
              reject(Error(result));
              this.handleError("Response code 400: UUID Expired.");
              // Should we have this whole thing in a loop so it
              // automatically gets a new UUID, avoiding this issue?
            } else if (result.code === 408) {
              meaning += "Nothing eventful, QR code not scanned usually";
            }
          }
          this.log(sign, respCode + (!meaning ? "Abnormal code" : meaning));
          resolve(result);
        }.bind(this));
      }.bind(this)).on("error", this.handleError);
    }.bind(this));
  }.bind(this), function(onRejectparam) {  // this will be our result object here
    return new Promise(function (resolve, reject) {
      // When we reject the condition, we got the redirect url.
      if (onRejectparam.code === 200) {
        resolve(onRejectparam.url); // resolve with url.
      } else this.handleError(onRejectparam);
    }.bind(this));
  }.bind(this));
}


/**************************** HELPER FUNCTIONS *********************************/

// Comes up with some random string of numbers appended to an "e".
// Full Disclosure: I copied and pasted this from WeChat code.
// Not sure why it's called a DeviceID if it's literally random... *shrugs*
weChatClient.prototype.getDeviceID = function() {
  return "e" + ("" + Math.random().toFixed(15)).substring(2, 17);
}

// Error handling function, accepts a message to display.
weChatClient.prototype.handleError = function(air) {
  console.error(chalk.bgRed("[-] ERROR OCCURRED:", air));
  console.error(air.stack);
  throw Error(air);
}

// Takes domain, path, and then an object with all query parameters in it, and
// returns a fully formed URL. for GET requests only though.
weChatClient.prototype.makeURL = function(domain, path, params, postDataLen) {
  path += "?";
  for (var key in params) {
    path += key + "=" + params[key] + "&";
  }
  path = path.slice(0, -1); // removes trailing & or ?

  var result = {
    "hostname": domain,
    "port": 443,  //443 for https, 80 for http
    "path": path,
    "method": (postDataLen ? "POST" : "GET")
  }; 

  if (this.cookies) {
    result["headers"] = {
      "User-Agent": this.USERAGENT,
      "Connection": "keep-alive",
      "Cookie": this.formCookies()
    }
    if (postDataLen) {
      result.headers["Content-Length"] = postDataLen;
      result.headers["Content-Type"] = "application/json;charset=UTF-8";
    }
  };

  return result;
}

// Helper function to clean up outputting info to screen
weChatClient.prototype.log = function(sign, message, output) {
  var result;
  if (sign === 0) {
    result = chalk.green("[+] " + message + "!");
  } else if (sign > 0) {
    var suffix = "...";
    if (output && output === -1) {
      // if output param is passed and output is -1
      suffix = "";
    }
    var temp = "[*] " + message + suffix;
    if (sign === 1) {  // Thread 1
      result = chalk.cyan(temp);
    } else if (sign === 2) {  // Thread 2
      result = chalk.yellow(temp);
    } else if (sign === 3) {  // Local program information 3
      result = chalk.magenta(temp);
    } else if (sign === 4) {  // 4
      result = temp;  // just plain white text... use for Verbose
    } else if (sign === 5) {
      result = chalk.inverse(temp);  // received messages
    }
  } else { // sign === -1
    result = chalk.red("[-] " + message + ".");
  }
  console.log(result + (output && output !== -1 ? " " + output : ""));
}

// Helper method... provide a condition function and a main function. This will
// perform like a while loop that returns a promise when the condition fails.
weChatClient.prototype.promiseWhile = function(condition, body, onReject) {
    return new Promise(function (resolve,reject) {
    function loop() {
      condition().then(function (result) {
        // When it completes, loop again. Reject on failure...
        body().then(loop, reject);
      }, function (result) {
        resolve(onReject(result));
      });
    }
    loop();
  }.bind(this));
}

// Returns a formatted version of the SyncKeys so they can be sent in requests
weChatClient.prototype.formSyncKeys = function() {
  var result = "";
  var list = this.syncKeys.List;
  for (var i = 0; i < list.length; i++) {
    result += list[i].Key + "_" + list[i].Val + "|";
  }
  return result.slice(0, -1);  // removes trailing "|"
}

// Returns a formatted version of the cookies so they can be sent in requests.
weChatClient.prototype.formCookies = function() {
  var result = "";
  for (var i = 0; i < this.cookies.length; i++) {
    result += this.cookies[i].Key + "=" + this.cookies[i].Val + "; ";
  }
  return result.slice(0, -2)  // removes trailing "; "
}

// Updates the cookies list with cookie objects (inserts and updates)
weChatClient.prototype.updateCookies = function(setCookies) {
  for (var i = 0; i < setCookies.length; i++) {

    var cookie = setCookies[i].split("; ")[0];  // cookie is now of form: key=value
    //this.log(4, "Got cookie: " + cookie); // Verbose

    // don't use split here in case the value of cookie has an "=" in it.
    // instead, get the index of the first occurance of "=" and separate.
    var key = cookie.substr(0, cookie.indexOf("="));
    var value = cookie.substr(cookie.indexOf("=") + 1);

    // If there's an existing cookie with the same key, updates.
    // otherwise, it will put that cookie into the cookies list.
    var updated = false;
    for (var j = 0; j < this.cookies.length && !updated; j++) {
      if (key === this.cookies[j].Key && value !== this.cookies[j].Val) {
        this.cookies[j].Val = value;
        updated = true;
      }
    }
    if (!updated) {
      this.cookies.push({ "Key": key, "Val": value });
    }
  }
}

// returns an ID to be sent as the LocalID and ClientMsgId fields of a webwxsendmsg message.
weChatClient.prototype.getMessageId = function() {
  return Date.now() + Math.random().toFixed(3).replace(".", "");
}

// Takes a message sendTime and formates it into a nice timestamp for display.
weChatClient.prototype.formTimeStamp = function(sendTime) {
  var time = new Date(sendTime);
  var hh   = time.getHours();
  var min  = time.getMinutes();
  var sec  = time.getSeconds();
  var mm   = (min < 10 ? "0" + min : min);
  var ss   = (sec < 10 ? "0" + sec : sec);
  var ts   = "<" + hh + ":" + mm + ":" + ss + "> ";
  return ts;
}
