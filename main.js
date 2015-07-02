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
var http = require("http"); 
var https = require("https");
var	url  = require("url");
var	fs   = require("fs");
var chalk = require("chalk");

/********** Globals **********/
var LOGDOM  = "login.wechat.com";  // "login.weixin.qq.com" for zh_CN/qq users.
var WEBDOM  = "web2.wechat.com";  // "wx.qq.com" for zh_CN/qq users.
var WEBPATH = "/cgi-bin/mmwebwx-bin/"; 
var USERAGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/43.0.2357.81 Safari/537.36";

var uuid = "";
var cookies = "";
var syncKeys;  // Object with List of key/value objects, and Count=List.Length
var contacts;  // List of user objects.
var thisUser;  // User object.
var chatSet;   // comma delimited string of UserName fields of user objects.

/****************************** MAIN EXECUTION THREAD **************************/
var uuidURLParameters = {
	"appid": "wx782c26e4c19acffb",
	"redirect_uri": encodeURIComponent("https://" + WEBDOM + WEBPATH + "webwxnewloginpage"),
	"fun": "new",
	"lang": "en_US"
};
var the_earl_of_uuid = makeURL(LOGDOM, "/jslogin", uuidURLParameters);
log(1, "Getting UUID");
getUUID(the_earl_of_uuid).then(function (gotUUID) {
	uuid += gotUUID;
	
	// Setup and handling of QR code.
	var the_earl_of_QR = makeURL(LOGDOM, "/qrcode/" + uuid, { "t": "webwx" });
	log(1, "Getting QR code");
	serveQR(the_earl_of_QR);

	// Checks to see if the QR code we fetched has been scanned.
	return checkForScan();  // returns promise.

}, handleError).then(function(redirect_object) {
	var the_earl_of_login = redirect_object.url + "&fun=new&version=v2";
	log(1, "Getting login data");
	return webwxnewloginpage(the_earl_of_login); 
}, handleError).then(function (loginData) {
	log(1, "Logging in");
	//TODO: consider making loginData a global object...?
	//loginData is of the following form:
	//"skey": "",
	//"wxsid": "",
	//"wxuin": "",
	//"pass_ticket": ""
	//
	// logs in the user and initializes some things.
	return webwxinit(loginData).then(function() {  //TODO consider if want a return value?
		log(1, "Notifying others of login");
		return webwxStatusNotify(loginData)
	}, handleError).then(function() {
		log(1, "Getting ContactList");
		return webwxgetcontact(loginData).then(function() {
			log(1, "Getting contacts' icons");
			for (var i = 0; i < contacts.length; i++) {
				webwxgeticon(contacts[i].HeadImgUrl, i, contacts.length);
			}	
			return new Promise(function (resolve, reject) {
				resolve(loginData);
			});
		}, handleError);
	}, handleError);
}, handleError).then(function(loginData) {
	// NOTE: synccheck domain is webpush2.wechat.com, everything else is web(1|2).wech...
	//TODO synccheck loop.
	log(0, "The end; now we need to synccheck loop");
}, handleError);

/*********************************** FUNCTIONS *********************************/

function webwxgeticon(iconURLPath, current, total) {
	var the_earl_of_iconia = makeURL(WEBDOM, iconURLPath, "", 1);
	http.get(the_earl_of_iconia, function(response) {
		response.setEncoding("binary");
		var result = "";
		response.on("error", handleError);
		response.on("data", function(chunk) {
			result += chunk;
		});
		response.on("end", function() {
			var begin = iconURLPath.indexOf("username=") + "username=".length;
			var end = iconURLPath("&skey=");
			var iconPath = iconURLPath.substring(begin, end);
			fs.writeFile("/tmp/" + iconPath, result, "binary", function (e) {
				if (e) handleError;
				else log(0, "Icon " + current + " of " + total + " successfully written");
			});
		});
	});
}

//FIXME FIXME FIXME FIXME FIXME 
function webwxgetcontact(loginData) {
	return new Promise(function (resolve, reject) {
		var clParams = {
			"lang": "en_US",
			"pass_ticket": loginData.pass_ticket,
			"r": +new Date(),
			"skey": loginData.skey
		};
		//var the_earl_of_contax = makeURL(WEBDOM, WEBPATH + "webwxgetcontact", clParams, 1);
		//log(2, JSON.stringify(the_earl_of_contax));  // Verbose
		var path = WEBPATH + "webwxgetcontact?lang=en_US&pass_ticket=" + loginData.pass_ticket;
		path += "&r=" + +new Date() + "&skey=" + loginData.skey;
		log(2, path);
		var options = {
			"hostname": WEBDOM,
			"port": 443,  //443 for https, 80 for http
			"path": path,
			"method": "GET",
			"headers": {
				"Connection": "keep-alive",
				"Cookie": cookies,
				"Accept": "application/json",
				"Accept-Encoding": "gzip,deflate,sdch",
				"Accept-Language": "en-US,en;q=0.8",
				"User-Agent": USERAGENT
			}
		};
		var request = http.request(options, function(response) {
			var result = "";
			log(2, response);
			response.on("error", handleError);
			response.on("data", function(chunk) {
				result += chunk;
			});
			response.on("end", function() {
				log(2, result);
				var jason = JSON.parse(result);
				log(2, "Contacts received: " + JSON.stringify(jason));  // Verbose
				if (jason.BaseResponse.ErrMsg) {
					log(-1, jason.BaseResponse.ErrMsg);
				}
				contacts = jason.MemberList;
				resolve();
			});
		}).on("error", handleError);
		request.end();
	});
}

// Called when receiving a message. Also once at login.
function webwxStatusNotify(loginData, stat) {
	// StatusNotify is a post request.
	return new Promise(function (resolve, reject) {
		var initParams = {
			"lang": "en_US"
		};
		var postData = JSON.stringify({
			"BaseRequest": {
				"Uin": loginData.wxuin,
				"Sid": loginData.wxsid,
				"Skey": loginData.skey,
				"DeviceID": getDeviceID()
			},
			// FIXME: take into account stat here, this is just init stuff right now
			"Code": 3,
			"FromUserName": thisUser.UserName,
			"ToUserName": thisUser.UserName,
			"ClientMsgId": +new Date()
		});
		var options = {
			"hostname": WEBDOM,
			"port": 443,  //443 for https, 80 for http
			"path": WEBPATH + "webwxstatusnotify?lang=en_US",
			"method": "POST",
			"headers": {
				"Content-Type": "application/json;charset=UTF-8",
				"Content-Length": postData.length,
				"Connection": "keep-alive",
				"Cookie": cookies,
				"User-Agent": USERAGENT
				//TODO: consider spoofing user agent?
			}
		};
		var request = https.request(options, function(response) {
			var data = "";
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
				log(0, "Other devices notified of login");
				resolve();
			});
		});
		request.on("error", handleError);
		request.write(postData);
		request.end();
	});
}

// takes url with to web2.wechat.com/cgi-bin/mmwebwx-bin/webwxsync with query 
// parameters of sid, skey, lang, and pass_ticket.
// is POST request, with BaseRequest, and a syncKey object.
//		syncKey has a count field which is the amount of keys, and then the list
//		of keys, each an object as Key: N, and Value.
// responds with JSON, most notably the syncKeys.
function webwxsync(url) {
	//TODO
}

// Sends a message
function webwxsendmsg(url, msg) {

}

// Gets session data from the passed URL.
//
// returns a promise, resolved with an object containing skey, sid, uin, pass_ticket.
// sets cookies in the form of one long string separated by "; ", in key=value format.
function webwxnewloginpage(url) {
	return new Promise(function (resolve, reject) {
		https.get(url, function(response) {
			var xml = "";
			var setCookies = response.headers["set-cookie"];
			for (var i = 0; i < setCookies.length; i++) {
				var cookie = setCookies[i].split("; ")[0] + "; ";
				//log(1, "Got cookie: " + cookie); // Verbose
				cookies += cookie;
			}
			cookies = cookies.slice(0, -2);  //removes trailing "; "
			response.on("error", handleError);
			response.on("data", function(chunk) {
				xml += chunk;
			});
			response.on("end", function() {
				var result = {
					"skey": "",
					"wxsid": "",
					"wxuin": "",
					"pass_ticket": ""
				}
				for (var key in result) {
					var openTag  = "<" + key + ">";
					var closeTag = "</" + key + ">";
					var begin = xml.indexOf(openTag) + openTag.length;
					var end   = xml.indexOf(closeTag);
					var value = xml.substring(begin, end);
					result[key] = value; 
					log(2, "Got xml data: " + key + " = " + value);  // Verbose
				}
				log(2, "Cookies: " + cookies);  // Verbose
				log(0, "Got login data");
				resolve(result);
			});
		});
	});
}

// Gets the initial data for the current user.
//
// returns a Promise
function webwxinit(loginData) {
	// init is a post request.
	return new Promise(function (resolve, reject) {
		var initParams = {
			"r": ~new Date(),
			"lang": "en_US",
			"pass_ticket": loginData.pass_ticket
		};
		var path = WEBPATH + "webwxinit?r=" + ~new Date() + "&lang=en_US";
		path += "&pass_ticket=" + loginData.pass_ticket;
		var postData = JSON.stringify({
			"BaseRequest": {
				"Uin": loginData.wxuin,
				"Sid": loginData.wxsid,
				"Skey": loginData.skey,
				"DeviceID": getDeviceID()
			}
		});
		var options = {
			"hostname": WEBDOM,
			"port": 443,  //443 for https, 80 for http
			"path": path,
			"method": "POST",
			"headers": {
				"Content-Type": "application/json;charset=UTF-8",
				"Content-Length": postData.length,
				"Connection": "keep-alive",
				"User-Agent": USERAGENT,
				"Cookie": cookies
				//TODO: consider spoofing user agent?
			}
		};
		var request = https.request(options, function(response) {
			var data = "";
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
				resolve();
			});
		});
		request.on("error", handleError);
		request.write(postData);
		request.end();
	});
}


// Gets the uuid for the session.
function getUUID(url) {
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
		});
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
		});
	});
}

// Gets the QR code corresponding to the given UUID, Saves the QR code to disk,
// and then creates a server displaying it.
function serveQR(from_QR_url) {
	getQR(from_QR_url).then(function saveQR(imgQR) {
		var pathQR = "/tmp/" + uuid;
		log(1, "Writing QR to file at " + pathQR);
		fs.writeFile(pathQR, imgQR, "binary", function (e) {
			if (e) handleError;
			else {
				log(0, "QR successfully written");
				fs.readFile(pathQR, function (err, imgQR) {
					if (err) handleError;
					else {
						http.createServer(function (req, res) {
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
function checkForScan() {
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
			if (typeof tip === "number") {
				log(2, "Checking for response code");
				tip = 0;
			} else tip = 1;
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
							//TODO CHECK IF I BROKE THIS
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
			});
		});
	})
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
function makeURL(domain, path, params, cook) {
	path += "?";
	for (var key in params) {
		path += key + "=" + params[key] + "&";
	}
	path = path.slice(0, -1); // removes trailing & or ? 
	if (typeof cook === "undefined") {
		return "https://" + domain + path;
	} else {
		return {
			"hostname": domain,
			"port": 443,  //443 for https, 80 for http
			"path": path,
			"headers": {
				"User-Agent": USERAGENT,
				"Connection": "keep-alive",
				"Cookie": cookies
				//TODO: consider spoofing user agent?
			}
		};
	}
}

// Helper function to clean up outputting info to screen
function log(sign, message, output) {
	var result;
	if (sign === 0) {
		result = chalk.green("[+] " + message + "!");
	} else if (sign > 0) {
		var temp = "[*] " + message + "...";
		if (sign % 3 === 1) {  // 1
			result = chalk.cyan(temp);
		} else if (sign % 3 === 2) {  // 2
			result = chalk.yellow(temp);
		} else {  // 3
			result = chalk.magenta(temp);
		}
	} else {
		result = chalk.red("[-] " + message + ".");
	}
	console.log(result + (output ? " " + output : ""));
}

// Helper method... provide a condition function and a main function. This will
// perform like a while loop that returns a promise when the condition fails.
function promiseWhile(condition, body) {
    return new Promise(function (resolve,reject) {
		function loop() {
			condition().then(function (result) {
				// When it completes, loop again. Reject on failure... 
				body().then(loop, reject);
			}, function (result) {
				// When we reject the condition, we got the redirect url.
				if (result.code === 200) {
					resolve(result); // resolve with object containing url.
				} else handleError(result);
			});
		}
		loop();
	});
}

