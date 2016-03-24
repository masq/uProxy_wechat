/*
 *  @author: Spencer Walden
 *  Date:   June 16th, 2015
 *
 *  @description: This is proof of concept code for authentication with the WeChat
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

/*
 *  @description: Constructs a new weChatClient object.
 *  @param {Boolean} — a flag to determine if this client should use an https wrapper
 *    or not. True for a wrap, false for the standard node.js "https" module.
 *  @param {Boolean} — a flag to determine if this should be run in debug mode. Debug
 *    mode simply provides more console output which can be helpful to debug.
 */
var weChatClient = function(wrapHttps, debug) {
  this.debug = debug;
  if (!wrapHttps) { 
    https = require("https");
  }

  this.WEBPATH = "/cgi-bin/mmwebwx-bin/";
  this.USERAGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/43.0.2357.81 Safari/537.36";
  this.HIDDENMSGTYPE = 51;  // As of July 23, 2015.
  this.isQQuser = false;  // Default to using the wechat domains
  this.DOMAINS = {
    "true": {
      "web": "wx.qq.com",
      "log": "login.weixin.qq.com",
      "sync": "webpush.weixin.qq.com"
    },
    "false": {
      "web": "web2.wechat.com",
      "log": "login.wechat.com",
      "sync": "webpush2.wechat.com"
    }
  };

  // Overwrite these with your own functionality
  this.events = {};
  this.events.onWrongDom = function() { return; };
  this.events.onMessage = function(message) { return; };
  this.events.onQRCode = function(qrCode) { return; };
  this.events.onIcon = function(iconURLPath) { return; };
  this.events.onUUID = function(url) { return; };
  this.events.onLogout = function() { return; };
  this.events.onModChatroom = function(modChatroom) { return; };
  this.events.onModContact = function(modContact) { return; };
  this.events.onInitialized = function() { return; };
  this.events.onWXIDs = function(wxids) { return; };
  this.events.onSpecialMessage = function(something) { return; };
  this.events.synccheckError = function(retcode) { return; };
  
  this.loginData = {
    "skey": "",
    "wxsid": "",
    "wxuin": "",
    "pass_ticket": ""
  };
  this.cookies = {};  // Cookies to be sent in requests.
  this.syncKeys = null;  // Object with List of key/value objects, and Count=List.Length
  this.contacts = {};  // Object of <user>.UserName to their corresponding user object
  this.chatrooms = {}; // Object of <user>.UserName to their corresponding chatroom object.
  this.thisUser = null;  // User object for the user that is logged in using this client.
  this.messages = {};  // Object of <user>.UserName matched to a List of relevant message objects.
};

module.exports.weChatClient = weChatClient;

/*********************************** FUNCTIONS *********************************/

/*
 *  combination of preLogin and postLoginInit
 */
weChatClient.prototype.login = function(shouldDownloadQR, shouldDownloadIcons) {
  return new Promise(function (resolve, reject) {
    this.prelogin(shouldDownloadQR)
    .then(this.postLoginInit.bind(this, shouldDownloadIcons), this.handleError)
    .then(resolve, reject);
  }.bind(this));
};

/*
 *  Technically logged in, but sets up some environment (necessary)
 */
weChatClient.prototype.postLoginInit = function(shouldDownloadIcons) {
  return new Promise(function (resolve, reject) {
    this.webwxinit()
    .then(this.webwxgetcontact.bind(this, shouldDownloadIcons), this.handleError)
    .then(resolve, reject);
  }.bind(this));
};

/*
 *  Haven't logged in yet, steps to login
 */
weChatClient.prototype.preLogin = function(shouldDownloadQR) {
  return new Promise(function (resolve, reject) {
    this.getUUID()
    .then(this.checkForScan.bind(this, shouldDownloadQR), this.handleError)
    .then(this.webwxnewloginpage.bind(this, shouldDownloadQR), this.handleError)
    .then(resolve, reject);
  }.bind(this));
};

weChatClient.prototype.webwxsearchcontact = function(keyword) {
  return new Promise(function (resolve, reject) {
    var params = {
      "lang": "en_US",
      "pass_ticket": this.loginData.pass_ticket
    };
    var postData = {
      "BaseRequest": this.formBaseRequest(),
      "KeyWord": keyword
    };
    postData = JSON.stringify(postData);
    var url = this.makeURL(this.DOMAINS[this.isQQuser].web, this.WEBPATH + "webwxsearchcontact", params, postData.length);
    var request = https.request(url, function(response) {
      var result = "";
      if (response.headers["set-cookie"]) {
        this.updateCookies(response.headers["set-cookie"]);
      }
      response.on("error", this.handleError.bind(this));
      response.on("data", function(chunk) {
        result += chunk;
      });
      response.on("end", function() {
        try {
          this.log(0, "searchcontact results: " + result);
          var jason = JSON.parse(result);
          if (jason.BaseResponse.Ret !== 0) {
            this.log(-1, "searchcontact error: " + jason.BaseResponse.Ret);
          }
          resolve();
        } catch(e) {
          this.handleError(e).bind(this);
          reject();
        }
      }.bind(this));
    }.bind(this)).on("error", this.handleError.bind(this));
    request.end(postData);
  }.bind(this));
};

// Provide List (i.e. []) with each index being a <user>.UserName for the members
// of the chat group you'd like to create. possibly also a string of topic/group name.
weChatClient.prototype.webwxcreatechatroom = function(memberlist)  {
  return new Promise(function (resolve, reject) {
    this.log(1, "creating chatroom");
    for (var i = 0; i < memberlist.length; i++) {
      memberlist[i] = {"UserName": memberlist[i]};
    }
    var params = {
      "r": Date.now(),
      "lang": "en_US",
      "pass_ticket": this.loginData.pass_ticket
    };
    var postData = {
      "MemberCount": memberlist.length,
      "MemberList": memberlist,
      "Topic": "", // stupid, but I can't change name on creation.
      "BaseRequest": this.formBaseRequest()
    };
    postData = JSON.stringify(postData);
    var url = this.makeURL(this.DOMAINS[this.isQQuser].web, this.WEBPATH + "webwxcreatechatroom", params, postData.length);
    var request = https.request(url, function(response) {
      var result = "";
      if (response.headers["set-cookie"]) {
        this.updateCookies(response.headers["set-cookie"]);
      }
      response.on("error", this.handleError.bind(this));
      response.on("data", function(chunk) {
        result += chunk;
      });
      response.on("end", function() {
        try {
          var jason = JSON.parse(result);
          if (jason.BaseResponse.ErrMsg !== "Everything is OK") {
            this.log(-1, "webwxcreatechatroom error: " + jason.BaseResponse.ErrMsg);
            reject(jason.BaseResponse.ErrMsg);
          } else {
            resolve(jason.ChatRoomName);
          }
        } catch(e) {
          this.handleError(e).bind(this);
          reject();
        }
      }.bind(this));
    }.bind(this)).on("error", this.handleError.bind(this));
    request.end(postData);
  }.bind(this));
};

// resolves with chatroom UserName
weChatClient.prototype.webwxbatchgetcontact = function(chatroomOrChatrooms, topic) {
  return new Promise(function (resolve, reject) {
    this.log(1, "getting chatroom users");
    var memberlist = [];
    if (typeof chatroomOrChatrooms === "string") {
      memberlist[0] = {"UserName": chatroomOrChatrooms, "ChatRoomId": ""};
    } else {
      for (var i = 0; i < chatroomOrChatrooms.length; i++) {
        memberlist[i] = {"UserName": chatroomOrChatrooms[i], "ChatRoomId": ""};
      }
    }
    var params = {
      "type": "ex",
      "r": Date.now(),
      "lang": "en_US",
      "pass_ticket": this.loginData.pass_ticket
    };
    var postData = {
      "BaseRequest": this.formBaseRequest(),
      "Count": memberlist.length,
      "List": memberlist
    };
    postData = JSON.stringify(postData);
    var url = this.makeURL(this.DOMAINS[this.isQQuser].web, this.WEBPATH + "webwxbatchgetcontact", params, postData.length);
    var request = https.request(url, function(response) {
      var result = "";
      if (response.headers["set-cookie"]) {
        this.updateCookies(response.headers["set-cookie"]);
      }
      response.on("error", this.handleError.bind(this));
      response.on("data", function(chunk) {
        result += chunk;
      });
      response.on("end", function() {
        try {
          //this.log(0, "webwxbatchgetcontact results: " + result); // Verbose
          var jason = JSON.parse(result);
          if (jason.BaseResponse.Ret !== 0) {
            this.log(-1, "webwxbatchgetcontact error: " + jason.BaseResponse.Ret);
          }
          var chatroomList = jason.ContactList;
          for (var j = 0; j < jason.Count; j++) {
            this.chatrooms[chatroomList[j].UserName] = chatroomList[j];
            // TBD: webwxgetheadimg();
          }
          resolve((typeof chatroomOrChatrooms === "string" ? chatroomOrChatrooms : ""));
        } catch(e) {
          this.handleError(e).bind(this);
          reject();
        }
      }.bind(this));
    }.bind(this)).on("error", this.handleError.bind(this));
    request.end(postData);
  }.bind(this));
};

// provide update type either "delmember" or "modtopic",
// provide either the <user>.UserName of the member you'd like to delete or a string with the
//  new name of the chatroom you'd like.
// provide the <user>.UserName of the chatroom you'd like to update.
// resolves with name of chatroom
weChatClient.prototype.webwxupdatechatroom = function(updatetype, topicOrDeletion, chatroom) {
  return new Promise(function (resolve, reject) {
    this.log(1, "updating chatroom");
    var postType = (updatetype === "modtopic" ? "NewTopic" : "DelMemberList")
    var params = { 
      "fun": updatetype,
      "lang": "en_US",
      "pass_ticket": this.loginData.pass_ticket
    };
    var postData = {
      "ChatRoomName": chatroom,
      "BaseRequest": this.formBaseRequest()
    };
    postData[postType] = topicOrDeletion;
    postData = JSON.stringify(postData);
    var url = this.makeURL(this.DOMAINS[this.isQQuser].web, this.WEBPATH + "webwxupdatechatroom", params, postData.length);
    var request = https.request(url, function(response) {
      var result = "";
      if (response.headers["set-cookie"]) {
        this.updateCookies(response.headers["set-cookie"]);
      }
      response.on("error", this.handleError.bind(this));
      response.on("data", function(chunk) {
        result += chunk;
      });
      response.on("end", function() {
        try {
          var jason = JSON.parse(result);
          if (jason.BaseResponse.Ret !== 0) {
            this.log(-1, "webwxupdatechatroom error: " + jason.BaseResponse.Ret);
            reject(chatroom);
          }
          resolve(chatroom);
        } catch(e) {
          this.handleError(e).bind(this);
          reject(chatroom);
        }
      }.bind(this));
    }.bind(this)).on("error", this.handleError.bind(this));
    request.end(postData);
  }.bind(this));
};

/*
 *  @description: Invoking this checks wechat servers to determine if there is new
 *    data relevant to the currently logged in user to pull down. If there is, it
 *    will return a number (called a selector) that is greater than 0, and you should
 *    invoke the webwxsync method in order to update the information this client has.
 *    This method must be called approximately every 4 or greater seconds, but should
 *    it will invoke itself when it gets data back from the server.
 */
weChatClient.prototype.synccheck = function() {
  this.log(2, "Checking for updates (e.g. new messages)");
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
        "skey": encodeURIComponent(this.loginData.skey),
        "sid": encodeURIComponent(this.loginData.wxsid),
        "uin": encodeURIComponent(this.loginData.wxuin),
        "deviceid": this.getDeviceID(),
        "synckey": encodeURIComponent(this.formSyncKeys()),
        "lang": "en_US",
        "pass_ticket": encodeURIComponent(this.loginData.pass_ticket)
      };
      var url = this.makeURL(this.DOMAINS[this.isQQuser].sync, this.WEBPATH + "synccheck", syncParams);
      https.get(url, function(response) {
        var result = "";
        if (response.headers["set-cookie"]) {
          this.updateCookies(response.headers["set-cookie"]);
        }
        response.on("error", this.handleError.bind(this));
        response.on("data", function(chunk) {
          result += chunk;
        });
        response.on("end", function() {
          try {
            //this.log(4, "Synccheck response: " + result);  // Verbose
            var fields = result.split("=")[1].trim().slice(1, -1).split(",");
            retcode  = parseInt(fields[0].split(":")[1].slice(1,-1), 10);
            var type = parseInt(fields[1].split(":")[1].slice(1,-1), 10);
            if (this.debug) this.log(2, "SyncCheck: { Retcode: " + retcode + ", Selector: " + type + " }");  // Verbose
            if (retcode !== 0) this.log(-1, "Synccheck error code: " + retcode);
            if (type === 0) {  // when selector is zero, just loop again.
              if (this.debug) this.log(-1, "Syncchecked with type " + type + ". No new info..");
              resolve();
            } else {
              // type 1 is profile sync.
              // type 2 is SyncKey update (?)
              // type 4 is ModContact sync.(?)  // typically associated with sendmessage
              // type 7 is AddMsg sync.

              resolve(this.webwxsync(type));
            }
          } catch(e) {
            this.handleError(e).bind(this);
          }
        }.bind(this));
      }.bind(this)).on("error", this.handleError.bind(this));
    }.bind(this));
  }.bind(this), function() {  // also is getting passed the retcode in case of code revision, ignored here.
    //  MMWEBWX_OK = 0 ,
    //  MMWEBWX_ERR_SYS = -1 ,
    //  MMWEBWX_ERR_LOGIC = -2 ,
    //  MMWEBWX_ERR_SESSION_NOEXIST = 1100,
    //  MMWEBWX_ERR_SESSION_INVALID = 1101,
    //  MMWEBWX_ERR_PARSER_REQUEST = 1200,
    //  MMWEBWX_ERR_FREQ = 1205
    var codes = {
      "0"   : "No problem, feel free to continue checking for updates",
      "-1"  : "System error",
      "-2"  : "Logic error",
      "1100": "Attempted to check for updates for a nonexistant (e.g. logged out) session",
      "1101": "Attempted to check for updates for an invalid session",
      "1200": "The webservice couldn't understand your request",
      "1205": "Attempted to check for updates too frequently; slow your roll"
    };
    var airMessage = "retcode " + retcode + ": " + codes[retcode];
    this.events.synccheckError(retcode);
    if (retcode === 1100)
      this.log(-1, airMessage);
    else
      this.handleError(airMessage).bind(this);
  }.bind(this));
};

/*
 *  @description: Invoking this method will pull down relevant new data from the server
 *    and update this client with it. This data could be new messages or contacts to 
 *    delete. This method is called by synccheck and need not be called externally.
 *
 *  @param {Number} — As of v0.0.9, type is not used, but there are plans to use it in
 *    future versions. Type (will) provide(s) which type of data specifically to update.
 */
weChatClient.prototype.webwxsync = function (type) {
  return new Promise(function (resolve, reject) {
    var postData = JSON.stringify({
      "BaseRequest": this.formBaseRequest(),
      "SyncKey": this.syncKeys,
      "rr": ~Date.now()
    });
    var params = {
      "sid": this.loginData.wxsid,
      "skey": this.loginData.skey,
      "lang": "en_US",
      "pass_ticket": this.loginData.pass_ticket
    };
    var url = this.makeURL(this.DOMAINS[this.isQQuser].web, this.WEBPATH + "webwxsync", params, postData.length);
    //this.log(2, "posting: " + postData);  // Verbose
    //this.log(2, "requesting: " + JSON.stringify(url));  // Verbose
    var request = https.request(url, function(response) {
      var result = "";
      if (response.headers["set-cookie"]) {
        this.updateCookies(response.headers["set-cookie"]);
      }
      response.on("error", this.handleError.bind(this));
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
            for (var i = 0; i < jason.AddMsgCount; i++) {
              var currMsg = jason.AddMsgList[i];
              var sender = this.contacts[currMsg.FromUserName] || this.chatrooms[currMsg.FromUserName];
              if (typeof this.messages[sender] === "undefined")
                this.messages[sender] = [];
              this.messages[sender].push(currMsg);
              if (!currMsg.StatusNotifyCode) {
                // For only handling x type messages here ( && currMsg.MsgType === x)
                //if (currMsg.MsgType !== this.HIDDENMSGTYPE) { // notify on non-hidden msgs
                //  this.webwxStatusNotify(1, sender.UserName);
                //}
                if (currMsg.FromUserName.startsWith("@") && !currMsg.FromUserName.startswith("@@")) {
                  // notify on normal contacts (not chatroom or wechat special)
                  this.webwxStatusNotify(1, sender.UserName);
                }
                var ts = this.formTimeStamp(currMsg.CreateTime * 1000);
                this.log(5, ts + sender.NickName + ": " + currMsg.Content, -1);
                this.events.onMessage(currMsg);
              } else { 
                var notifyMsg = currMsg.Content.replace(/&lt;/g, "<");
                notifyMsg = notifyMsg.replace(/&gt;/g, ">");
                if (~notifyMsg.indexOf("<unreadchatlist>")) {
                  var notifyUsers = currMsg.StatusNotifyUserName.split(",");
                  var unaccountedForChatrooms = [];
                  var wxids = this.extractXMLData(notifyMsg, "username").split(",");
                  var weixinIDs = {};
                  for (var k = 0; k < notifyUsers.length; k++) {
                    var kthUser = notifyUsers[k];
                    if (kthUser.startsWith("@@") && 
                          typeof this.chatrooms[kthUser] === "undefined") {
                      unaccountedForChatrooms.push(kthUser);
                      this.chatrooms[kthUser] = {"Uin": 0};
                    }
                    if (kthUser.startsWith("@")) {
                      if (this.contacts[kthUser] && this.contacts[kthUser].Uin === 0) {
                        this.contacts[kthUser].Uin = null;
                        weixinIDs[kthUser] = wxids[k];  // TODO: test if i work
                      } else if (this.chatrooms[kthUser] && this.chatrooms[kthUser].Uin === 0) {
                        this.chatrooms[kthUser].Uin = null;
                        weixinIDs[kthUser] = wxids[k];  // TODO: test if i work
                      }
                    } 
                  }
                  //weixinIDs is <user>.UserName => wxid_xxxxxxxxxxxxxx pairs
                  if (unaccountedForChatrooms.length > 0) {
                    this.webwxbatchgetcontact(unaccountedForChatrooms)
                      .then(this.events.onWXIDs.bind(this, weixinIDs), this.handleError.bind(this));
                  } else {
                    this.events.onWXIDs(weixinIDs);
                  }
                }
              }
            }
          }
          if (jason.ModContactCount !== 0) {
            for (var j = 0; j < jason.ModContactCount; j++) {
              var modContact = jason.ModContactList[j];
              if (modContact.UserName.startsWith("@@")) {
                this.chatrooms[modContact.UserName] = modContact;
                this.events.onModChatroom(modContact);
              } else {
                this.contacts[modContact.UserName] = modContact;
                this.events.onModContact(modContact);
              }
            }
          }
          this.syncKeys = jason.SyncKey;
          //this.log(0, "Synced with type " + type);  // Verbose
          resolve();
        } catch (air) {
          this.handleError(air).bind(this);
        }
      }.bind(this));
    }.bind(this)).on("error", this.handleError.bind(this));
    request.end(postData);
  }.bind(this));
};

/*
 *  @description: Sends a message from thisUser to a given contact, through wechat.
 *    type 1 messages are just plaintext as of August 31st, 2015.
 *
 *  @param {Object}:
 *    @param {String} — "content" field, a string of what you want to say to your recipient. 
 *    @param {Number} — "type" field, a number specifying which message type to send.
 *    @param {String} — "recipient" field, a UserName of a contact.
 *  @example: 
 *    var message = {
 *      "content": "Hey John! How are you?",
 *      "type": 1,
 *      "recipient": getContactUserNameByNickName("John Doe")
 *    };
 */
weChatClient.prototype.webwxsendmsg = function (msg) {
  return new Promise(function (resolve, reject) {
    var params = {
      "lang": "en_US",
      "pass_ticket": this.loginData.pass_ticket
    };
    var id = this.getMessageId();
    var postData = {
      "BaseRequest": this.formBaseRequest(),
      "Msg": {
        "Type": msg.type,
        "Content": msg.content,
        "FromUserName": this.thisUser.UserName,
        "ToUserName": msg.recipient,
        "LocalID": id,
        "ClientMsgId": id
      }
    };
    if (typeof this.messages[msg.recipient] === "undefined")
      this.messages[msg.recipient] = [];
    this.messages[msg.recipient].push(postData.Msg);
    postData = JSON.stringify(postData);
    var url = this.makeURL(this.DOMAINS[this.isQQuser].web, this.WEBPATH + "webwxsendmsg", params, postData.length);
    var request = https.request(url, function(response) {
      var result = "";
      if (response.headers["set-cookie"]) {
        this.updateCookies(response.headers["set-cookie"]);
      }
      response.on("error", this.handleError.bind(this));
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
          resolve();
        } catch(e) {
          this.handleError(e).bind(this);
          reject();
        }
      }.bind(this));
    }.bind(this)).on("error", this.handleError.bind(this));
    request.end(postData);
  }.bind(this), this.handleError.bind(this));
};

/*
 *  @description: Pushes a notification to user devices. For example, buzzing
 *    someone's phone when they have a new message. This is invoked by other functions
 *    internally, and shouldn't need to be called directly by the programmer.
 *  @param {Number} — The status code; status code corresponds to different situations.
 *  @param {String} — The <user>.UserName string of the user who's devices should be
 *    notified of new data.
 */
weChatClient.prototype.webwxStatusNotify = function(statCode, sender) {
  // StatusNotify is a post request.
  if (statCode === 3) {
    this.log(2, "Notifying others of login");
  }
  return new Promise(function (resolve, reject) {
    var params = {
      "lang": "en_US"
    };
    var postData = JSON.stringify({
      "BaseRequest": this.formBaseRequest(),
      "Code": statCode,  // 3 for init, 1 for typical messages
      "FromUserName": this.thisUser.UserName,
      "ToUserName": (!sender ? this.thisUser.UserName : sender),
      "ClientMsgId": Date.now()
    });
    var url = this.makeURL(this.DOMAINS[this.isQQuser].web, this.WEBPATH + "webwxstatusnotify", params, postData.length);
    var request = https.request(url, function(response) {
      var data = "";
      if (response.headers["set-cookie"]) {
        this.updateCookies(response.headers["set-cookie"]);
      }
      response.on("error", this.handleError.bind(this));
      response.on("data", function(chunk) {
        data += chunk;
      });
      response.on("end", function() {
        try {
          var jason = JSON.parse(data);
          //this.log(2, JSON.stringify(jason));  // verbose
          if (jason.BaseResponse.ErrMsg) {
            this.log(-1, jason.BaseResponse.ErrMsg);
          }
          if (statCode === 3) this.log(0, "Other devices notified of login");
          else if (statCode === 1) this.log(0, "Other devices notified of message");
          resolve();
        } catch(e) {
          this.handleError.bind(this, e);
        }
      }.bind(this));
    }.bind(this)).on("error", this.handleError.bind(this));
    request.end(postData);
  }.bind(this));
};

// Either sticky a contact on the top of your list, or change how their name appears to you.
// action can be either "modremarkname" or "topcontact"
// property is only used when the action is "modremarkname". It is the name which you'd like to
// change your contact to have displayed to you.
// user is a <user> object.
weChatClient.prototype.webwxoplog = function(action, property, user) {
  this.log(1, "oplogging");
  return new Promise(function (resolve, reject) {
    var params = {
      "lang": "en_US",
      "pass_ticket": this.loginData.pass_ticket
    };
    var postData = {
      "UserName": user.UserName,
      "BaseRequest": this.formBaseRequest()
    };
    var actionId = 2;
    if (action === "topcontact") {
      actionId = 3;
      postData["OP"] = (user.ContactFlag / 2048 ? 0 : 1);
    } else {
      postData["RemarkName"] = property;
    }
    postData.CmdId = actionId;
    postData = JSON.stringify(postData);
    var url = this.makeURL(this.DOMAINS[this.isQQuser].web, this.WEBPATH + "webwxoplog", params, postData.length);
    var request = https.request(url, function(response) {
      if (response.headers["set-cookie"]) {
        this.updateCookies(response.headers["set-cookie"]);
      }
      var result = "";
      response.on("error", this.handleError.bind(this));
      response.on("data", function(chunk) {
        result += chunk;
      });
      response.on("end", function() {
        try {
          var jason = JSON.parse(result);
          if (jason.BaseResponse.Ret !== 0) {
            this.log(-1, "Webwxoplog error: " + jason.BaseResponse.ErrMsg);
            reject(jason.BaseResponse.Ret);
          } else {
            this.log(0, "Webwxoplog success");
            resolve();
          }
        } catch (e) {
          this.handleError.bind(this, e);
        }
      }.bind(this));
    }.bind(this)).on("error", this.handleError.bind(this));
    request.end(postData);
  }.bind(this));
};

/*
 *  @description: Logs the current user out, destroying their web session with wechat.
 *    This will cause synccheck to fail with a code of 1011; this is to be expected.
 */
weChatClient.prototype.webwxlogout = function() {
  return new Promise(function (resolve, reject) {
    var params = {
      "redirect": 1,  // They typically put 1 here, redirects if 0 anyways -- 1 for consistency 
      "type": 0,
      "skey": this.loginData.skey
    };
    var postData = "sid=" + this.loginData.wxsid + "&uin=" + this.loginData.wxuin;
    var url = this.makeURL(this.DOMAINS[this.isQQuser].web, this.WEBPATH + "webwxlogout", params, postData.length);
    var request = https.request(url, function(response) {
      if (response.headers["set-cookie"]) {
        this.updateCookies(response.headers["set-cookie"]);
      }
      var result = "";
      response.on("error", this.handleError.bind(this));
      response.on("data", function(chunk) {
        result += chunk;
      });
      response.on("end", function() {
        this.log(0, "Logged out");
        this.events.onLogout();
        resolve();
      }.bind(this));
    }.bind(this)).on("error", this.handleError.bind(this));
    request.end(postData);
  }.bind(this));
};

/*
 *  @description: Gets all of the current user's contacts list's contact's icon photos.
 */
weChatClient.prototype.webwxgeticon = function() {
  this.log(1, "Getting contacts' icons");
  var count = 1;
  for (var user in this.contacts) {
    var iconURLPath = this.contacts[user].HeadImgUrl;
    var the_earl_of_iconia = this.makeURL(this.DOMAINS[this.isQQuser].web, iconURLPath, "");
    // if something in the normal https module doesn't exist, means a wrapper is in use, so...
    if (!https.createServer) the_earl_of_iconia["encoding"] = "binary";
    https.get(the_earl_of_iconia, function(response) {
      if (response.headers["set-cookie"]) {
        this.updateCookies(response.headers["set-cookie"]);
      }
      response.setEncoding("binary");
      var result = "";
      response.on("error", this.handleError.bind(this));
      response.on("data", function(chunk) {
        result += chunk;
      });
      response.on("end", function() {
        this.log(0, "Got icon " + count++ + " of " + Object.keys(this.contacts).length);
        this.events.onIcon(result); 
      }.bind(this));
    }.bind(this)).on("error", this.handleError.bind(this));
  }
};

/*
 *  @description: Gets the current user's contacts, populating the contacts object.
 *  @param {Boolean} — whether or not to have this code download the icons of the ContactList.
 */
weChatClient.prototype.webwxgetcontact = function (GetIcon) {
  this.log(1, "Getting ContactList");
  return new Promise(function (resolve, reject) {
    var clParams = {
      "lang": "en_US",
      "pass_ticket": this.loginData.pass_ticket,
      "r": Date.now(),
      "skey": this.loginData.skey
    };
    var url = this.makeURL(this.DOMAINS[this.isQQuser].web, this.WEBPATH + "webwxgetcontact", clParams);
    //this.log(4, JSON.stringify(url));  // Verbose
    https.get(url, function(response) {
      var result = "";
      if (response.headers["set-cookie"]) {
        this.updateCookies(response.headers["set-cookie"]);
      }
      response.on("error", this.handleError.bind(this));
      response.on("data", function(chunk) {
        result += chunk;
      });
      response.on("end", function() {
        try {
          //this.log(4, "Contacts received: " + result);  // Verbose
          var jason = JSON.parse(result);
          if (jason.BaseResponse.ErrMsg) {
            this.log(-1, jason.BaseResponse.ErrMsg);
          }
          for (var i = 0; i < jason.MemberList.length; i++) {
            if (jason.MemberList[i].UserName.startsWith("@") && jason.MemberList[i].VerifyFlag === 0) {
              this.contacts[jason.MemberList[i].UserName] = jason.MemberList[i];
              //TODO: consider a Uin to UserName dictionary as well.
            }
          }
          this.log(0, "Got ContactList");
          if (GetIcon) this.webwxgeticon();
          resolve();
        } catch (e) {
          this.handleError(e).bind(this);
        }
      }.bind(this));
    }.bind(this)).on("error", this.handleError.bind(this));
  }.bind(this));
};

/*
 *  @description: Retrieves authentication information (e.g. cookies) to be used henceforth
 *    with wechat. The authentication information is handled internally and shouldn't
 *    require any efforts from the programmer to include it in further transactions with
 *    the service.
 *  @param {String} — Takes a url to get the information from.
 */
weChatClient.prototype.webwxnewloginpage = function (shouldDownloadQR, redirectURL) {
  if (!~redirectURL.indexOf("&fun="))
    redirectURL += "&fun=new&version=v2";
  else 
    this.log(1, "redirect: " + redirectURL, -1);
  var url = this.makeURL(this.DOMAINS[this.isQQuser].web, redirectURL.substring(redirectURL.indexOf(this.WEBPATH)), "");
  this.log(1, "Getting login data");
  return new Promise(function (resolve, reject) {
    https.get(url, function(response) {
      var xml = "";
      if (response.headers["set-cookie"]) {
        this.updateCookies(response.headers["set-cookie"]);
      }
      response.on("error", this.handleError.bind(this));
      response.on("data", function(chunk) {
        xml += chunk;
      });
      response.on("end", function() {
        if (~xml.indexOf("<redirecturl>")) {
          var referral = this.extractXMLData(xml, "redirecturl");
          this.isQQuser = !this.isQQuser;
          this.events.onWrongDom(shouldDownloadQR).then(resolve, reject);
        } else {
          for (var key in this.loginData) {
            this.loginData[key] = this.extractXMLData(xml, key);
            this.log(4, "Got xml data: " + key + " = " + this.loginData[key]);  // Verbose
          }
          this.log(4, "Cookies: " + this.formCookies());  // Verbose
          this.log(0, "Got login data");
          resolve();
        }
      }.bind(this));
    }.bind(this)).on("error", this.handleError.bind(this));
  }.bind(this));
};

/*
 *  @description: Gets and sets the current user (i.e. thisUser)
 */
weChatClient.prototype.webwxinit = function () {
  this.log(1, "Logging in");
  return new Promise(function (resolve, reject) {
    var params = {
      "r": ~Date.now(),
      "lang": "en_US",
      "pass_ticket": this.loginData.pass_ticket
    };
    var postData = JSON.stringify({ "BaseRequest": this.formBaseRequest() });
    var url = this.makeURL(this.DOMAINS[this.isQQuser].web, this.WEBPATH + "webwxinit", params, postData.length);
    var request = https.request(url, function(response) {
      var data = "";
      if (response.headers["set-cookie"]) {
        this.updateCookies(response.headers["set-cookie"]);
      }
      response.on("error", this.handleError.bind(this));
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
          this.thisUser = jason.User;
          this.syncKeys = jason.SyncKey;
          this.log(0, "\"" + this.thisUser.NickName + "\" is now logged in");
          this.webwxStatusNotify(3);
          this.events.onInitialized();
          resolve();
        } catch (e) {
          handleError(e);
        }
      }.bind(this));
    }.bind(this)).on("error", this.handleError.bind(this));
    request.end(postData);
  }.bind(this));
};

/*
 *  @description: Gets a fresh UUID from wechat for getting a QR code. UUID's expire
 *    after about 5 minutes, and you will need to call this function again and start
 *    the login process all over if that happens.
 *  @returns {String} — resolves with the UUID as a string on success.
 */
weChatClient.prototype.getUUID = function() {
  var uuidURLParameters = {
    "appid": "wx782c26e4c19acffb",
    "redirect_uri": encodeURIComponent("https://" + this.DOMAINS[this.isQQuser].web + this.WEBPATH + "webwxnewloginpage"),
    "fun": "new",
    "lang": "en_US"
  };
  var url = this.makeURL(this.DOMAINS[this.isQQuser].log, "/jslogin", uuidURLParameters);
  this.log(1, "Getting UUID");
  return new Promise(function(resolve, reject) {
    https.get(url, function(response) {
      var data = "";
      response.on("error", this.handleError.bind(this));
      response.on("data", function(chunk) {
        data += chunk;
      });
      response.on("end", function() {
        var uuid = data.split(";")[1].split(" = ")[1].trim().slice(1,-1);
        this.log(0, "Got UUID " + uuid);
        this.events.onUUID("https://" + this.DOMAINS[this.isQQuser].log + "/qrcode/" + uuid);
        resolve(uuid);
      }.bind(this));
    }.bind(this)).on("error", this.handleError.bind(this));
  }.bind(this));
};

/*
 *  @description: Gets the QR code corresponding to the given UUID.
 *  @param {String} — The UUID corresponding to the QR code you want.
 *  @returns {String} — resolves with the binary for the QR code on success.
 */
weChatClient.prototype.getQR = function(uuid) {
  var url = this.makeURL(this.DOMAINS[this.isQQuser].log, "/qrcode/" + uuid, { "t": "webwx" });
  this.log(1, "Getting QR code");
  return new Promise(function(resolve, reject) {
    https.get(url, function(response) {
      var imgQR = "";
      response.setEncoding("binary");
      response.on("error", this.handleError.bind(this));
      response.on("data", function(chunk) {
        imgQR += chunk;
      });
      response.on("end", function() {
        this.log(0, "Got QR code");
        this.events.onQRCode(imgQR);
        resolve(imgQR);
      }.bind(this));
    }.bind(this)).on("error", this.handleError.bind(this));
  }.bind(this));
};

/*
 *  @description: Calling this will check with the wechat servers to see if the QR
 *    code associated with the UUID you provisioned has been scanned by a wechat phone app.
 *    After about 5 minutes, the UUID will expire and you will need to request a new one.
 *  @param {String} — The UUID you provisioned and recieved as the result of calling the
 *    getUUID function.
 *  @params {Boolean} — A flag to indicate if this client should get the QR code or not.
 *    This flag being set to false is useful in situations where you might just want to
 *    provide the URL with which a user can access the QR code, rather than get the QR
 *    code through this client.
 *  @returns {String} — On success, this will resolve with a String of the url you need to
 *    access in order to get login authentication data (e.g. cookies). On failure, will throw
 *    an error.
 */
weChatClient.prototype.checkForScan = function(getQR, uuid) {
  if (getQR)
    this.getQR(uuid);
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
      var the_Czech_earl = this.makeURL(this.DOMAINS[this.isQQuser].log, this.WEBPATH + "login", params);
      //this.log(3, the_Czech_earl);
      https.get(the_Czech_earl, function(response) {
        var data = "";
        response.on("error", this.handleError.bind(this));
        response.on("data", function(chunk) {
          data += chunk;
        });
        response.on("end", function() {
          //this.log(3, data);
          var values = data.split(";");
          result.code = parseInt(values[0].split("=")[1], 10);
          var respCode = "Got response code " + result.code + ": ";
          var logMessages = {
            "200": "Login confirmed, got redirect URL",
            "201": "QR code scanned, confirm login on phone",
            "400": "UUID expired",
            "408": "Nothing eventful; QR code not scanned, usually"
          };
          var logResponseCode = function(code) {
            var sign = -0.5 * parseInt(code / 100, 10) + 1;
            var logged = respCode + (logMessages[code] ? logMessages[code] : "Abnormal code");
            if (code === 400) {
              reject(Error(logged));
              this.handleError(logged).bind(this);
            } else {
              if (code === 200) {
                var temp = values[1].trim();
                result.url = temp.slice(temp.indexOf("https://"), -1);
              }
              resolve(result);
              this.log(sign, logged); 
            }
          }.bind(this);
          logResponseCode(result.code);
        }.bind(this));
      }.bind(this)).on("error", this.handleError.bind(this));
    }.bind(this));
  }.bind(this), function(onRejectparam) {  // this will be our result object here
    return new Promise(function (resolve, reject) {
      // When we reject the condition, we got the redirect url.
      if (onRejectparam.code === 200) {
        resolve(onRejectparam.url); // resolve with url.
      } else this.handleError(onRejectparam).bind(this);
    }.bind(this));
  }.bind(this));
};


/**************************** HELPER FUNCTIONS *********************************/

/*
 *  @description: Generates a random string of numbers appended to an 'e'. This
 *    should never need to be called directly by the programmer, and is simply a
 *    string used in certain transactions with the server.
 *  @returns {String} — The pseudorandom string of numbers starting with the letter 'e'.
 */
weChatClient.prototype.getDeviceID = function() {
  return "e" + ("" + Math.random().toFixed(15)).substring(2, 17);
};

/*
 *  @description: Takes some values and formats them into an object that can be used
 *    to make http(s) requests with.
 *  @param {String} — String representing the domain you'd like to access.
 *    @example: "www.github.com"
 *  @param {String} — String representing the path of the website you'd like to access.
 *    @example: Following with our domain example, "/freedomjs/freedom-social-wechat"
 *      To construct the full URL with no query parameters "https://www.github.com/freedomjs/freedom-social-wechat"
 *  @param {Object} — Object containing key value pairs of the query parameters of the
 *    request.
 *    @example: Say we want to access the URL 
 *      "https://www.google.com/search?client=ubuntu&channel=fs&q=specifying&ie=utf-8&oe=utf-8"
 *      we take each query paramter and put it in the following format:
 *        var parameters = {
 *          "client": "ubuntu",
 *          "channel": "fs",
 *          "q": "specifying",
 *          "ie": "utf-8",
 *          "oe": "utf-8"
 *        };
 *      and pass the paramters object we just made.
 *  @param {Number} — (Optional) This is the length of the data we send as part of a POST
 *    request. This value is optional, since in GET requests you don't send any POST data.
 *    If you want to form a POST request URL, you MUST include a postDataLen however.
 *  @returns {Object} — returns an URL object, to be used in making http(s) requests.
 */
weChatClient.prototype.makeURL = function(domain, path, params, postDataLen) {
  path += "?";
  for (var key in params)
    path += key + "=" + params[key] + "&";
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
    };
    if (postDataLen) {
      result.headers["Content-Length"] = postDataLen;
      result.headers["Content-Type"] = "application/json;charset=UTF-8";
    }
  }
  return result;
};

/*
 *  @description: Generic error handling function. Will produce a stack trace if available
 *    and will throw the error, potentially stopping further execution of the program.
 *  @param {Error || String} — Will accept an Error object, or a String as the message to
 *    display and the Error to throw.
 */
weChatClient.prototype.handleError = function(air) {
  if (!(air instanceof Error))
    air = Error(air);
  this.log(-1, air);
  this.log(-2, air.stack);
};

/*
 *  @description: Logging function, that displays messages in a consistent format.
 *  @param {Number} — A number to choose what type of message to display.
 *    Positive numbers are used for different types of notifications (1-5 are supported),
 *    Negative numbers for warnings or Errors (-1, -2 are supported),
 *    And the number zero is used for success messages.
 *  @param {String} — The message to be displayed in the console.
 *  @param {String || Number} — If the sign specified is positive, and the value passed
 *    is -1 (Number), then the ellipses automatically added will be overridden to be omitted.
 *    Otherwise, You can simply add a value here that you would like to be displayed. 
 *    This is mainly used as just some type of debugging method.
 */
weChatClient.prototype.log = function(sign, message, output) {
  var result;
  var pColorize = [
    function(text) { return chalk.cyan(text); }, // "thread" 1
    function(text) { return chalk.yellow(text); }, // "thread" 2
    function(text) { return chalk.magenta(text); }, // program output (e.g. QRserver messages)
    function(text) { return text; }, // Verbose output, and messages from thisUser
    function(text) { return chalk.inverse(text); } // messages to thisUser
  ];
  var nColorize = [
    function(text) { return chalk.red(text); }, // warning
    function(text) { return chalk.bgRed(text); } // error
  ];
  if (sign === 0) {
    result = chalk.green("[+] " + message + "!");
  } else if (sign > 0) {
    result = pColorize[sign - 1]("[*] " + message + (output === -1 ? "" : "..."));
  } else { // sign < 0
    result = nColorize[-sign - 1]("[-] " + message + ".");
  }
  var complete = result + (output && output !== -1 ? " " + output : "");
  if (sign < -1)
    console.error(complete);
  else if (sign < 0)
    console.warn(complete);
  else 
    console.log(complete);
};

/*
 *  @description: This is a while loop, but for promises. This will check a condition,
 *    run a main body function until that condition is false, at which point it will 
 *    run a rejection function.
 *  @param {Function} — A condition function that returns a Promise, resolving When
 *    a condition is met, rejecting when it is false.
 *  @param {Function} — A function that returns a Promise, resolving when it's task has
 *    completed successfully, rejecting on failure. This function will be run while the
 *    condition function resolves.
 *  @param {Function} — A function that returns a Promise, resolving with whatever value
 *    you want the promiseWhile call to resolve with. This function will run when the
 *    condition function rejects, i.e. the condition is no longer true.
 *  @returns {Promise} — resolve with whatever value you resolved with in the "onReject"
 *    function, rejects if something goes wrong in the body.
 */
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
};

/*
 *  @description: Formats the syncKeys for transmission in requests.
 *  @returns {String} — Formatted syncKeys
 */
weChatClient.prototype.formSyncKeys = function() {
  var result = "";
  for (var i = 0; i < this.syncKeys.List.length; i++)
    result += this.syncKeys.List[i].Key + "_" + this.syncKeys.List[i].Val + "|";
  return result.slice(0, -1);  // removes trailing "|"
};

/*
 *  @description: Formats the cookies so they can be sent in requests.
 *  @returns {String} — Formatted cookies
 */
weChatClient.prototype.formCookies = function() {
  var result = "";
  for (var key in this.cookies) 
    result += key + "=" + this.cookies[key] + "; ";
  return result.slice(0, -2)  // removes trailing "; "
};

/*
 *  @description: Updates the cookies Object (will create new cookies if the cookie
 *    previously didn't exist)
 *  @param {List} — The setCookie headers in the response from a request to a
 *    URL.
 */
weChatClient.prototype.updateCookies = function(setCookies) {
  for (var i = 0; i < setCookies.length; i++) {

    var cookie = setCookies[i].split("; ")[0];  // cookie is now of form: key=value
    //this.log(4, "Got cookie: " + cookie); // Verbose

    // don't use split here in case the value of cookie has an "=" in it.
    // instead, get the index of the first occurance of "=" and separate.
    var key = cookie.substr(0, cookie.indexOf("="));
    var value = cookie.substr(cookie.indexOf("=") + 1);

    this.cookies[key] = value;
  }
};

/*
 *  @description: Generates a message ID. This is solely used in the "webwxsendmsg" function,
 *    as part of compliance with wechat message sending formats.
 *  @returns {String} — LocalID and/or ClientMsgId for a message.
 */
weChatClient.prototype.getMessageId = function() {
  return Date.now() + Math.random().toFixed(3).replace(".", "");
};

/*
 *  @description: Generates a nicely formatted timestamp.
 *  @param {Date} — A Date object for the Date/Time for which you want a formatted timestamp.
 *  @returns {String} — The formatted timestamp.
 */
weChatClient.prototype.formTimeStamp = function(sendTime) {
  var time = new Date(sendTime);
  var hh   = time.getHours();
  var min  = time.getMinutes();
  var sec  = time.getSeconds();
  var mm   = (min < 10 ? "0" + min : min);
  var ss   = (sec < 10 ? "0" + sec : sec);
  var ts   = "<" + hh + ":" + mm + ":" + ss + "> ";
  return ts;
};

/*
 *  @description: Extracts the data from a tag in an XML blob.
 *  @param {String} — The XML where the tag you want data from resides.
 *  @param {String} — The tag you want the data extracted from
 *  @returns {String} — The data from the tag.
 */
weChatClient.prototype.extractXMLData = function(xml, tagName) {
  var open  = "<" + tagName + ">";
  var close = "</" + tagName + ">";
  var begin = xml.indexOf(open) + open.length;
  var end   = xml.indexOf(close);
  return xml.substring(begin, end);
};

/*
 *  @description: Creates a properly formatted "BaseRequest", an object that is sent
 *    in many wechat interactions.
 *  @returns {Object} — The properly formatted BaseRequest object.
 */
weChatClient.prototype.formBaseRequest = function() {
  return {
    "Uin": this.loginData.wxuin,
    "Sid": this.loginData.wxsid,
    "Skey": this.loginData.skey,
    "DeviceID": this.getDeviceID()
  };
};
