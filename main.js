/*
 *	Author: Spencer Walden
 *	Date:   June 16th, 2015
 *
 *	Description: This is proof of concept code for authentication with the WeChat
 *					webclient. It will hopefully help with WeChat authentication
 *					support in uProxy as a social provider.
 *
 */

/********** Requires **********/
"use strict";
var serve = require("http"); 
var https = require("https");
var	fs   = require("fs");
var chalk = require("chalk");

/********** Globals **********/
var debug = true;

var LOGDOM  = "login.wechat.com";  // "login.weixin.qq.com" for zh_CN/qq users.
var WEBDOM  = "web2.wechat.com";  // "wx.qq.com" for zh_CN/qq users.
var WEBPATH = "/cgi-bin/mmwebwx-bin/"; 
var USERAGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/43.0.2357.81 Safari/537.36";

var QRserver;  // QRserver... serves QR code at localhost:8000 (for now)
var cookies = [];  // cookies to be sent in requests.
var syncKeys;  // Object with List of key/value objects, and Count=List.Length
var contacts;  // List of user objects.
var thisUser;  // User object.
var slctdUser;  // User we're currently watching messages from
var chatSet;   // comma delimited string of UserName fields of user objects.
var messages = [];  // List of message objects.

/****************************** MAIN EXECUTION THREAD **************************/


getUUID()
	.then(checkForScan, handleError)
	.then(webwxnewloginpage, handleError)
	.then(webwxinit, handleError) // return thing
	.then(webwxgetcontact, handleError)
	.then(synccheck, handleError)
	.then(function (something) {
		log(-1, "No longer syncchecking", something);
	}, handleError);

/*********************************** FUNCTIONS *********************************/

// Just a loop waiting for the signals to read something, write something, or log out.
function userInterface(loginData) {
	log(3, "Welcome to WeChat: CLI edition! Now listening to user input");
	process.stdin.resume();
	process.stdin.setEncoding("utf8");
	var oLoop;
	var iLoop;
	var wStep;
	var wNope;
	var wStay;
	var rStep;
	var message;
	toOuterLoop();

	process.stdin.on("data", function(input) {
		input = input.trim();
		if (oLoop) {
			if (input === "q") {
				process.stdin.pause();
				log(3, "No longer listening to user input");
				webwxlogout(loginData);
				log(1, "Logging out");
				return;
			} else if (input === "s") {
				oLoop = false;
			} else {
				toOuterLoop();
			}
		} 
		if (!oLoop) {
			if (iLoop === 0) {
				if (input === "b") {
					toOuterLoop();
				} else if (parseInt(input)) {
					var contactNum = parseInt(input);
					if (contactNum > 0 && contactNum < contacts.length + 1) {
						message.recipient = contacts[contactNum - 1].UserName;
						slctdUser = message.recipient;
						iLoop = 1;
					} else {
						toInnerLoop();
					}
				} else {
					toInnerLoop();
				}
			}
			if (iLoop === 1) {
				promiseWhile(function() {
					return new Promise(function (resolve, reject) {
						(parseInt(input) === -1 && !wNope) ? reject() : resolve();
					});
				}, function() {
					return new Promise(function (resolve, reject) {
						craftMessage(input).then(function(message) {
							webwxsendmsg(loginData, message);
							toThreadLoop();
							wStay = true;
							resolve();
						}, function(passedWStep) {
							if (passedWStep && passedWStep !== 1) {
								toThreadLoop(passedWStep);
							}
						});
					});
				}, toInnerLoop);
			}

			//Read.
			//readMessage(); //TODO... maybe.
			//toOuterLoop();
		} 
	});
	
	// Creates a message to be sent.
	function craftMessage(input) {
		return new Promise(function (resolve, reject) {
			input = input.trim();
			var type = 1;
			if (input !== "-1") {
				if (wStep === 0) {
					if (!wStay) {
						toThreadLoop(wStep);
						listMessageThread();
					}
					wStep++;
					reject(wStep);
				} else if (wStep === 1) {
					var number = parseInt(input);
					if (number && number > 0) {
						message.type = number;
						log(3, "What did you want to say to them?");
						wNope = true;
					} else {
						toThreadLoop();
					}
					wStep++;
				} else if (wStep === 2) {
					message.content = input;
					//log(0, "Message crafted");  // Verbose
					message.id = +new Date() + Math.random().toFixed(3).replace(".", "");
					//log(4, "Message: " + JSON.stringify(message));  // Verbose
					resolve(message);
				}
			} else {
				reject(wStep);
			}
		});
	}

	function listMessageThread() {
		for (var i = 0; i < messages.length; i++) {
			var sender = messages[i].FromUserName;
			var reciever = messages[i].ToUserName;
			if ((sender === slctdUser) || (reciever === slctdUser)) {
				var sendTime;
				if (reciever === slctdUser) {
					sendTime = parseInt(messages[i].ClientMsgId.slice(0, -4));
				} else if (sender === slctdUser) {
					sendTime = messages[i].CreateTime * 1000;
				} else {
					log(-1, "Unknown message sendTime");
					sendTime = +new Date();
				}
				var ts = formTimeStamp(sendTime);
				if (sender === slctdUser) {
					log(5, ts + messages[i].Content, -1);
				} else if (reciever === slctdUser) {
					log(4, ts + messages[i].Content, -1);
				} else {
					log(-1, "display msg error: " + ts);
				}
			}
		}
	}

	// prompts user with the given question, and lists their contacts.
	function listUsers(question) {
		log(3, question);
		for (var i = 0; i < contacts.length; i++) {
			log(3, "Contact " + (i + 1) + ": " + contacts[i].NickName, -1);
		}
	}

	function toInnerLoop() {
		toXLoop(false, "Type 'b' to go Back to main menu, otherwise,");
		slctdUser = "";
		listUsers("Choose the number of the contact with which you'd like to interact");
	}

	function toThreadLoop(writePoint) {
		var m = "Type '-1' to go back to contacts menu at any time during the message send process";
		m += ". otherwise specify a message type in the form of a number. (1 for plaintext)";
		toXLoop(false, m, message.recipient);
		if (writePoint) wStep = 1;
	}
	
	// Takes the user to the "outer loop" and resets the environment.
	function toOuterLoop() {
		toXLoop(true, "Type 's' to Select a user to interact with, and 'q' to Quit/logout");
	}

	// level is boolean for being outer loop or not; message is message to display.
	function toXLoop(level, instruction, recipient) {
		oLoop   = level;
		iLoop   = (recipient ? 1 : 0);
		wStep   = 0;
		wNope   = false;
		wStay   = false;
		rStep   = 0;
		message = {
			"recipient": (recipient ? recipient : ""),
			"content": "",
			"type": 1,
			"id": 0
		};
		log(3, instruction, -1);
	}

	// Prints out a list of messages to read, and prompts the user to read one or not
	function readMessage() {
		log(-1, "TODO");
	}
}

// Checks to see if there is new data relevant to the current user
function synccheck(loginData) {
	log(2, "Looping to check for updates");
	var retcode = 0;
	if (debug) userInterface(loginData);
	return promiseWhile(function() {
		return new Promise(function (resolve, reject) {
			if (retcode === 0) resolve(retcode);
			else reject(retcode);
		});	
	}, function() {
		return new Promise(function (resolve, reject) {
			var syncParams = {  // #encodeeverythingthatwalks
				"r": +new Date(),
				"skey": encodeURIComponent(loginData.skey),
				"sid": encodeURIComponent(loginData.wxsid),
				"uin": encodeURIComponent(loginData.wxuin),
				"deviceid": getDeviceID(),
				"synckey": encodeURIComponent(formSyncKeys()),
				"lang": "en_US",
				"pass_ticket": encodeURIComponent(loginData.pass_ticket)
			};
			var syncDom = "webpush2.wechat.com";
			var url = makeURL(syncDom, WEBPATH + "synccheck", syncParams, 1);
			https.get(url, function(response) {
				var result = "";
				if (response.headers["set-cookie"]) {
					updateCookies(response.headers["set-cookie"]);
				}
				response.on("error", handleError);
				response.on("data", function(chunk) {
					result += chunk;
				});
				response.on("end", function() {
					//log(4, "Synccheck response: " + result);  // Verbose
					var fields = result.split("=")[1].trim().slice(1, -1).split(",");
					retcode  = parseInt(fields[0].split(":")[1].slice(1,-1));
					var type = parseInt(fields[1].split(":")[1].slice(1,-1));
					//log(2, "SyncCheck: { Retcode: " + retcode + ", Selector: " + type + " }");  // Verbose
					if (retcode !== 0) log(-1, "Synccheck error code: " + retcode);
					if (type === 0) {  // when selector is zero, just loop again.
						log(-1, "Syncchecked with type " + type + ". No new info..");
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
						//	MMWEBWX_OK = 0 ,
						//	MMWEBWX_ERR_SYS = -1 ,
						//	MMWEBWX_ERR_LOGIC = -2 ,
						//	MMWEBWX_ERR_SESSION_NOEXIST = 1100,
						//	MMWEBWX_ERR_SESSION_INVALID = 1101,
						//	MMWEBWX_ERR_PARSER_REQUEST = 1200,
						//	MMWEBWX_ERR_FREQ = 1205 // 频率拦截
						
						resolve(webwxsync(loginData, type));
					}
				});
			}).on("error", handleError);
		});
	}, function() {  // also is getting passed the retcode in case of code revision, ignored here.
		if (retcode === 1100) {
			log(-1, "Attempted to synccheck a nonexistant session");
		} else {
			if (retcode === 1101) {
				log(-1, "Attempted to synccheck an invalid session");
			} else if (retcode === 1200) {
				log(-1, "Webservice couldn't understand your request.");
			} 
			handleError(retcode);
		}
	});
}

// takes type selector to select a corresponding type of data from the response to
// possibly store.
// is POST request to web2.wechat.com/cgi-bin/mmwebwx-bin/webwxsync with query 
// parameters of sid, skey, lang, and pass_ticket, and postData of BaseRequest, syncKey
// object, and the bitflip of the currrent time.
//		syncKey has a count field which is the amount of keys, and then the list
//		of keys, each an object as Key: N, and Value.
// responds with JSON, most notably the syncKeys.
function webwxsync(loginData, type) {
	return new Promise(function (resolve, reject) {
		var postData = JSON.stringify({
			"BaseRequest": {
				"Uin": loginData.wxuin,
				"Sid": loginData.wxsid,
				"Skey": loginData.skey,
				"DeviceID": getDeviceID()
			},
			"SyncKey": syncKeys,
			"rr": ~new Date()
		});
		var params = {
			"sid": loginData.wxsid,
			"skey": loginData.skey,
			"lang": "en_US",
			"pass_ticket": loginData.pass_ticket
		};
		var url = makeURL(WEBDOM, WEBPATH + "webwxsync", params, 1, postData.length);
		//log(2, "posting: " + postData);  // Verbose
		//log(2, "requesting: " + JSON.stringify(url));  // Verbose
		var request = https.request(url, function(response) {
			var result = "";
			if (response.headers["set-cookie"]) {
				updateCookies(response.headers["set-cookie"]);
			}
			response.on("error", handleError);
			response.on("data", function(chunk) {
				result += chunk;
			});
			response.on("end", function() {
				var jason = JSON.parse(result);
				//log(1, "webwxsync response: " + JSON.stringify(jason));  // Verbose
				if (jason.BaseResponse.Ret !== 0) {
					log(-1, "webwxsync error: " + jason.BaseResponse.Ret);
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
						messages.push(currMsg);
						if (!currMsg.StatusNotifyCode) {
						// For only handling plaintext messages here ( && currMsg.MsgType === 1)
							var from = currMsg.FromUserName;
							var sender = "<unknown>";
							for (var j = 0; j < contacts.length; j++) {
								if (from === contacts[j].UserName) {
									sender = contacts[j].NickName;
									j = contacts.length;
								}
							}
							var ts = formTimeStamp(currMsg.CreateTime * 1000);
							if (typeof slctdUser === "undefined" || from !== slctdUser) {
								log(3, ts + "Recieved message from \"" + sender + "\"", -1);
							} else {
								log(5, ts + currMsg.Content, -1); 
							}

							webwxStatusNotify(loginData, 1, from);  // TODO
						}
					}
				}
				//if (jason.SyncKey.Count !== syncKeys.Count) {
				//	syncKeys = jason.SyncKey;
				//}
				syncKeys = jason.SyncKey;
				//log(0, "Synced with type " + type);  // Verbose
				resolve();
			});
		}).on("error", handleError);
		request.end(postData);
	});
}

// Sends a message
function webwxsendmsg(loginData, msg) {
	var params = {
		"lang": "en_US",
		"pass_ticket": loginData.pass_ticket
	};
	var postData = JSON.stringify({
		"BaseRequest": {
			"Uin": loginData.wxuin,
			"Sid": loginData.wxsid,
			"Skey": loginData.skey,
			"DeviceID": getDeviceID()
		},
		"Msg": {
			"Type": msg.type,  // TODO: need more type support...
			"Content": msg.content,
			"FromUserName": thisUser.UserName,
			"ToUserName": msg.recipient,
			"LocalID": msg.id,
			"ClientMsgId": msg.id
		}
	});
	var url = makeURL(WEBDOM, WEBPATH + "webwxsendmsg", params, 1, postData.length);
	var request = https.request(url, function(response) {
		var result = "";
		if (response.headers["set-cookie"]) {
			updateCookies(response.headers["set-cookie"]);
		}
		response.on("error", handleError);
		response.on("data", function(chunk) {
			result += chunk;
		});
		response.on("end", function() {
			var jason = JSON.parse(result);
			//log(4, "sendmessage response: " + result);  // Verbose
			var ts = formTimeStamp(parseInt(msg.id.slice(0, -4)));
			log(0, ts + "Message sent");
			if (jason.BaseResponse.Ret !== 0) {
				log(-1, "sendmessage error: " + jason.BaseResponse.Ret);
			}

			messages.push(JSON.parse(postData).Msg);
			//TODO: want jason.MsgID (the messages' ID within their database)
			//or to keep msg.id?
		});
	}).on("error", handleError);
	request.end(postData);
}

// Called when receiving a message. Also once at login.
function webwxStatusNotify(loginData, statCode, sender) {
	// StatusNotify is a post request.
	if (statCode === 3) {
		log(2, "Notifying others of login");
	}
	return new Promise(function (resolve, reject) {
		var params = {
			"lang": "en_US"
		};
		var from = (typeof sender === "undefined" ? thisUser.UserName : sender);
		var postData = JSON.stringify({
			"BaseRequest": {
				"Uin": loginData.wxuin,
				"Sid": loginData.wxsid,
				"Skey": loginData.skey,
				"DeviceID": getDeviceID()
			},
			"Code": statCode,  // 3 for init, 1 for typical messages
			"FromUserName": thisUser.UserName,
			"ToUserName": from,
			"ClientMsgId": +new Date()
		});
		var url = makeURL(WEBDOM, WEBPATH + "webwxstatusnotify", params, 1, postData.length);
		var request = https.request(url, function(response) {
			var data = "";
			if (response.headers["set-cookie"]) {
				updateCookies(response.headers["set-cookie"]);
			}
			response.on("error", handleError);
			response.on("data", function(chunk) {
				data += chunk;
			});
			response.on("end", function() {
				var jason = JSON.parse(data);
				//log(2, JSON.stringify(jason));  // verbose
				if (jason.BaseResponse.ErrMsg) {
					log(-1, jason.BaseResponse.ErrMsg);
				}
				if (statCode === 3) log(0, "Other devices notified of login");
				else if (statCode === 1) log(0, "Other devices notified of message");
				resolve();
			});
		}).on("error", handleError);
		request.end(postData);
	});
}

function webwxlogout(loginData) {
	var params = {
		"redirect": 0,  // They normally do 1 here, but I don't think I want redirect.
		"type": 0,
		"skey": loginData.skey
	};
	var postData = "sid=" + loginData.wxsid + "&uin=" + loginData.wxuin;
	var url = makeURL(WEBDOM, WEBPATH + "webwxlogout", params, 1, postData.length);
	var request = https.request(url, function(response) {
		var result = "";
		response.on("error", handleError);
		response.on("data", function(chunk) {
			result += chunk;
		});
		response.on("end", function() {
			//log(4, "logout result: " + result);  // Verbose
			// ^ this literally sends back nothing.
			log(0, "Logged out");
			QRserver.close();
		});
	}).on("error", handleError);
	request.end(postData);
}

// Gets the icon/photo for a contact, given the friends iconURLPath.
// also accepts a current and total number of contact icons to get.
function webwxgeticon() {
	log(1, "Getting contacts' icons");
	var completed = [];
	var max = contacts.length;
	for (var i = 0; i < max; i++) {
		var iconURLPath = contacts[i].HeadImgUrl;
		var the_earl_of_iconia = makeURL(WEBDOM, iconURLPath, "", 1);
		completed.push(false);
		https.get(the_earl_of_iconia, function(response) {
			if (response.headers["set-cookie"]) {
				updateCookies(response.headers["set-cookie"]);
			}
			response.setEncoding("binary");
			var result = "";
			response.on("error", handleError);
			response.on("data", function(chunk) {
				result += chunk;
			});
			response.on("end", function() {
				var begin = iconURLPath.indexOf("username=") + "username=".length;
				var end = iconURLPath.indexOf("&skey=");
				var iconPath = iconURLPath.substring(begin, end);
				fs.writeFile("/tmp/wxicon_" + iconPath, result, "binary", function (e) {
					if (e) handleError;
					else {
						for (var j = 0; j < max; j++) {
							if (!completed[j]) {
								completed[j] = true;
								log(0, "Icon " + (j + 1) + " of " + max + " successfully written");
								j = max;
							}
						}
					}
				});
			});
		}).on("error", handleError);
	}
}

// Gets contact list.
function webwxgetcontact(loginData) {
	log(1, "Getting ContactList");
	return new Promise(function (resolve, reject) {
		var clParams = {
			"lang": "en_US",
			"pass_ticket": loginData.pass_ticket,
			"r": +new Date(),
			"skey": loginData.skey
		};
		var url = makeURL(WEBDOM, WEBPATH + "webwxgetcontact", clParams, 1);
		//log(4, JSON.stringify(the_earl_of_contax));  // Verbose
		https.get(url, function(response) {
			var result = "";
			if (response.headers["set-cookie"]) {
				updateCookies(response.headers["set-cookie"]);
			}
			response.on("error", handleError);
			response.on("data", function(chunk) {
				result += chunk;
			});
			response.on("end", function() {
				var jason = JSON.parse(result);
				//log(4, "Contacts received: " + JSON.stringify(jason));  // Verbose
				if (jason.BaseResponse.ErrMsg) {
					log(-1, jason.BaseResponse.ErrMsg);
				}
				contacts = jason.MemberList;
				log(0, "Got ContactList");
				webwxgeticon();
				resolve(loginData);
			});
		}).on("error", handleError);
	});
}

//TODO: umm... I really don't think we need/want to do this..
//function webwxstatreport() {
//
//}

// Gets session data from the passed URL.
//
// returns a promise, resolved with an object containing skey, sid, uin, pass_ticket.
// sets cookies in the form of one long string separated by "; ", in key=value format.
function webwxnewloginpage(redirectURL) {
	var url = redirectURL + "&fun=new&version=v2";
	log(1, "Getting login data");
	return new Promise(function (resolve, reject) {
		https.get(url, function(response) {
			var xml = "";
			if (response.headers["set-cookie"]) {
				updateCookies(response.headers["set-cookie"]);
			}
			response.on("error", handleError);
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
					log(4, "Got xml data: " + key + " = " + value);  // Verbose
				}
				log(4, "Cookies: " + formCookies());  // Verbose
				log(0, "Got login data");
				resolve(loginData);
			});
		}).on("error", handleError);
	});
}

// Gets the initial data for the current user.
//
// returns a Promise
function webwxinit(loginData) {
	// init is a post request.
	log(1, "Logging in");
	return new Promise(function (resolve, reject) {
		var params = {
			"r": ~new Date(),
			"lang": "en_US",
			"pass_ticket": loginData.pass_ticket
		};
		var postData = JSON.stringify({
			"BaseRequest": {
				"Uin": loginData.wxuin,
				"Sid": loginData.wxsid,
				"Skey": loginData.skey,
				"DeviceID": getDeviceID()
			}
		});
		var url = makeURL(WEBDOM, WEBPATH + "webwxinit", params, 1, postData.length);
		var request = https.request(url, function(response) {
			var data = "";
			if (response.headers["set-cookie"]) {
				updateCookies(response.headers["set-cookie"]);
			}
			response.on("error", handleError);
			response.on("data", function(chunk) {
				data += chunk;
			});
			response.on("end", function() {
				var jason = JSON.parse(data);
				//log(2, JSON.stringify(jason));  // verbose
				if (jason.BaseResponse.ErrMsg) {
					log(-1, jason.BaseResponse.ErrMsg);
				}
				//contacts = jason.ContactList;
				// this gets less contacts than webwxgetcontact, but it DOES get
				// the file transfer agent's user, whereas webwxgetcontact does not.
				thisUser = jason.User;
				syncKeys = jason.SyncKey;
				chatSet  = jason.ChatSet;
				log(0, "\"" + thisUser.NickName + "\" is now logged in");
				webwxStatusNotify(loginData, 3);
				resolve(loginData);
			});
		}).on("error", handleError);
		request.end(postData);
	});
}

// Gets the uuid for the session.
function getUUID() {
	var uuidURLParameters = {
		"appid": "wx782c26e4c19acffb",
		"redirect_uri": encodeURIComponent("https://" + WEBDOM + WEBPATH + "webwxnewloginpage"),
		"fun": "new",
		"lang": "en_US"
	};
	var url = makeURL(LOGDOM, "/jslogin", uuidURLParameters);
	log(1, "Getting UUID");
	return new Promise(function(resolve, reject) {
		var data = "";
		var result = "";
		https.get(url, function(response) {
			response.on("error", handleError);
			response.on("data", function(chunk) {
				data += chunk;
			});
			response.on("end", function() {
				result += data.split(";")[1].split(" = ")[1].trim().slice(1,-1);
				log(0, "Got UUID " + result);
				resolve(result);
			});
		}).on("error", handleError);
	});
}

// Gets the QR code corresponding to the given uuid.
// takes the url of where to get the QR code from as a parameter.
function getQR(url) {
	return new Promise(function(resolve, reject) {
		var imgQR  = ""; 
		https.get(url, function(response) {
			response.setEncoding("binary");
			response.on("error", handleError);
			response.on("data", function(chunk) {
				imgQR += chunk;
			});
			response.on("end", function() {
				log(0, "Got QR code");
				resolve(imgQR);
			});
		}).on("error", handleError);
	});
}

// Gets the QR code corresponding to the given UUID, Saves the QR code to disk,
// and then creates a server displaying it.
function serveQR(uuid) {
	var url = makeURL(LOGDOM, "/qrcode/" + uuid, { "t": "webwx" });
	log(1, "Getting QR code");
	getQR(url).then(function saveQR(imgQR) {
		var pathQR = "/tmp/wxQR_" + uuid;
		log(1, "Writing QR to file at " + pathQR);
		fs.writeFile(pathQR, imgQR, "binary", function (e) {
			if (e) handleError;
			else {
				log(0, "QR successfully written");
				fs.readFile(pathQR, function (err, imgQR) {
					if (err) handleError;
					else {
						QRserver = serve.createServer(function (req, res) {
							res.writeHead(200, { "content-type": "image/jpeg" });
							log(3, "200 GET: QR code requested from local server");
							res.end(imgQR);
						}).listen(8000);
						log(1, "QR code can be scanned at http://localhost:8000");
					}
				});
			}
		});
	}, handleError);
}


// Pings server for indication of the QR code being scanned. Upon being scanned,
// gets a response code of 201, and  200 when confirmed. A response code of 408 
// shows up when the ping "expires", and another ping needs to be sent. 400 shows
// up when this QR expires, which means we need to start this whole process over.
//
// returns promise.
function checkForScan(uuid) {
	log(1, uuid);
	serveQR(uuid);
	var result = { "code": 999 };  //initialize to nonexistant http code.
	var tip;  
	log(2, "Checking for response codes indicating QR code scans");
	return promiseWhile(function() {
		return new Promise(function (resolve, reject) {
			//test if url exists in the result, and the QR hasn't expired.
			if ((result.code !== 400) && (typeof result.url === "undefined"))
				resolve(result);
			else  // Want this case, means we got redirect url.
				reject(result); 
		});
	}, function() {  // Check server for code saying there's been a scan.
		return new Promise(function (resolve, reject) { 
			if (typeof tip !== "number") tip = 1;
			else {
				log(2, "Checking for response code");
				tip = 0;
			}
			var params = {
				"loginicon": true,
				"uuid": uuid,
				"tip": tip,
				"r": ~new Date(),
				"lang": "en_US"
			};
			var the_Czech_earl = makeURL(LOGDOM, WEBPATH + "login", params);
			//log(3, the_Czech_earl);
			https.get(the_Czech_earl, function(response) {
				var data = "";
				response.on("error", handleError);
				response.on("data", function(chunk) {
					data += chunk;
				});
				response.on("end", function() {
					//log(3, data);
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
							handleError("Response code 400: UUID Expired.");
							// Should we have this whole thing in a loop so it
							// automatically gets a new UUID, avoiding this issue?
						} else if (result.code === 408) {
							meaning += "Nothing eventful, QR code not scanned usually";
						}
					}
					log(sign, respCode + (!meaning ? "Abnormal code" : meaning)); 
					resolve(result);
				});
			}).on("error", handleError);
		});
	}, function(onRejectparam) {  // this will be our result object here
		return new Promise(function (resolve, reject) {
			// When we reject the condition, we got the redirect url.
			if (onRejectparam.code === 200) {
				resolve(onRejectparam.url); // resolve with url.
				//events["onScanComplete"](onRejectparam.url); TODO
			} else handleError(onRejectparam);
		});
	});
}


/**************************** HELPER FUNCTIONS *********************************/

// Comes up with some random string of numbers appended to an "e".
// Full Disclosure: I copied and pasted this from WeChat code.
// Not sure why it's called a DeviceID if it's literally random... *shrugs*
function getDeviceID() {
	return "e" + ("" + Math.random().toFixed(15)).substring(2, 17);
}

// Error handling function, accepts a message to display.
function handleError(air) {
	console.error(chalk.bgRed("[-] ERROR OCCURRED:", air));
	throw Error(air);
}

// Takes domain, path, and then an object with all query parameters in it, and
// returns a fully formed URL. for GET requests only though.
function makeURL(domain, path, params, cook, postDataLen) {
	path += "?";
	for (var key in params) {
		path += key + "=" + params[key] + "&";
	}
	path = path.slice(0, -1); // removes trailing & or ? 
	if (typeof cook === "undefined") {
		return "https://" + domain + path;
	} else {
		var result =  {
			"hostname": domain,
			"port": 443,  //443 for https, 80 for http
			"path": path,
			"headers": {
				"User-Agent": USERAGENT,
				"Connection": "keep-alive",
				"Cookie": formCookies()
			}
		};
		if (typeof postDataLen !== "undefined") {
			result["method"] = "POST";
			result.headers["Content-Length"] = postDataLen;
			result.headers["Content-Type"] = "application/json;charset=UTF-8";
		}
		return result;
	}
}

// Helper function to clean up outputting info to screen
function log(sign, message, output) {
	var result;
	if (sign === 0) {
		result = chalk.green("[+] " + message + "!");
	} else if (sign > 0) {
		var suffix = "...";
		if (typeof output !== "undefined" && output === -1) {  
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
	} else {
		result = chalk.red("[-] " + message + ".");
	}
	console.log(result + (output !== -1 && typeof output !== "undefined" ? " " + output : ""));
}

// Helper method... provide a condition function and a main function. This will
// perform like a while loop that returns a promise when the condition fails.
function promiseWhile(condition, body, onReject) {
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
	});
}

// Returns a formatted version of the SyncKeys so they can be sent in requests
function formSyncKeys() {
	var result = "";
	var list = syncKeys.List;
	for (var i = 0; i < list.length; i++) {
		result += list[i].Key + "_" + list[i].Value + "|";
	}
	return result.slice(0, -1);  // removes trailing "|"
}

// Returns a formatted version of the cookies so they can be sent in requests.
function formCookies() {
	var result = "";
	for (var i = 0; i < cookies.length; i++) {
		result += cookies[i].Key + "=" + cookies[i].Val + "; ";
	}
	return result.slice(0, -2)  // removes trailing "; "
}

// Updates the cookies list with cookie objects (inserts and updates)
function updateCookies(setCookies) {
	for (var i = 0; i < setCookies.length; i++) {
		var cookie = setCookies[i].split("; ")[0];  // cookie is now of form: key=value
		//log(4, "Got cookie: " + cookie); // Verbose
		var key = cookie.substr(0, cookie.indexOf("="));
		var value = cookie.substr(cookie.indexOf("=") + 1);

		// If there's an existing cookie with the same key, updates.
		// otherwise, it will put that cookie into the cookies list.
		var updated = false;
		for (var j = 0; j < cookies.length && !updated; j++) {
			if (key === cookies[j].Key && value !== cookies[j].Val) {
				cookies[j].Val = value;
				updated = true;
			}
		}
		if (!updated) { 
			cookies.push({ "Key": key, "Val": value });
		}
	}
}

function formTimeStamp(sendTime) {
	var time = new Date(sendTime);
	var hh   = time.getHours();
	var min  = time.getMinutes();
	var sec  = time.getSeconds();
	var mm   = (min < 10 ? "0" + min : min);
	var ss   = (sec < 10 ? "0" + sec : sec);
	var ts   = "<" + hh + ":" + mm + ":" + ss + "> ";
	return ts;
}

