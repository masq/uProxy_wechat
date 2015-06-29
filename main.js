/*
 *	Author: Spencer Walden
 *	Date:   June 16th, 2015
 *
 *	Description: This is proof of concept code for authentication with the WeChat
 *					webclient. It will hopefully help with WeChat authentication
 *					support in uProxy as a social provider.
 *
 */

"use strict";
var http = require("http"); 
var https = require("https");
var	url  = require("url");
var	fs   = require("fs");
var chalk = require("chalk");

/****************************** MAIN EXECUTION THREAD **************************/
var uuidURLParameters = {
	"appid": "wx782c26e4c19acffb",
	"redirect_uri": encodeURIComponent("https://web2.wechat.com/cgi-bin/mmwebwx-bin/webwxnewloginpage"),
	"fun": "new",
	"lang": "en_US"
};
var the_earl_of_uuid = makeURL("login.wechat.com", "jslogin", uuidURLParameters);
var uuid = "";
log(1, "Getting UUID");
getUUID(the_earl_of_uuid).then(function (gotUUID) {
	uuid += gotUUID;
	
	// Setup and handling of QR code.
	var the_earl_of_QR = makeURL("login.wechat.com", "qrcode/" + uuid, { "t": "webwx" });
	log(1, "Getting QR code");
	serveQR(the_earl_of_QR);

	// Checks to see if the QR code we fetched has been scanned.
	return checkForScan();  // returns promise.

}, handleError).then(function(redirect_object) {
	var the_earl_of_login = redirect_object.url + "&fun=new&version=v2";
	log(1, "Getting login data");
	return webwxnewloginpage(the_earl_of_login); 
}, handleError).then(function (loginData) {
	log(1, "The end so far. Construction in progress");
	handleError("THE END IS NIGH");
	
	//TODO: consider making loginData a global object...?
	//loginData is of the following form:
	//"skey": "",
	//"wxsid": "",
	//"wxuin": "",
	//"pass_ticket": "",
	//"cookies": ""
	
	// Here, we want to send some requests with our cookies.
	webwxinit(loginData);  //TODO want a return value?
	

	// NOTE: synccheck domain is webpush.wechat.com, everything else is web(1|2).wech...
}, handleError);

/*********************************** FUNCTIONS *********************************/

function webwxinit(loginData) {
	// init is a post request.
	return new Promise(function (resolve, reject) {
		var initParams = {
			"r": ~new Date(),
			"lang": "en_US",
			"pass_ticket": loginData.pass_ticket
		};
		var path = "/cgi-bin/mmwebwx-bin/webwxinit?r=" + ~new Date() + "&lang=en_US";
		path += "&pass_ticket=" + loginData.pass_ticket;
		var postData = {
			"BaseRequest": {
				"DeviceID": getDeviceID(),
				"Sid": loginData.wxsid,
				"Skey": loginData.skey,
				"Uin": loginData.wxuin
			}
		};
		var options = {
			"hostname": "web2.wechat.com",
			"port": 443,  //443 for https, 80 for http
			"path": path,
			"method": "POST",
			"headers": {
				"Content-Type": "application/json;charset=UTF-8",
				"Content-Length": postData.length,
				"Cookie": loginData.cookies
				//TODO: consider spoofing user agent?
			}
		};
		var request = https.request(options, function(response) {
			var jason = "";
			response.on("error", function(error) {
				//TODO
			});
			response.on("data", function(chunk) {
				jason += chunk;
			});
			response.on("end", function() {
				//TODO: something with the JSON response?
			});
		});
		request.on("error", handleError);
		request.write(postData);
		request.end();
	});
}

// Not really sure what this is for... or how to work with it. Gets called once
// after logging in, and seemingly never again...
function webwxStatusNotify(url) {

}

// takes url with to web2.wechat.com/cgi-bin/mmwebwx-bin/webwxsync with query 
// parameters of sid, skey, lang, and pass_ticket.
// is POST request, with BaseRequest, and a SyncKey object.
//		SyncKey has a count field which is the amount of keys, and then the list
//		of keys, each an object as Key: N, and Value.
// responds with JSON, most notably the SyncKeys.
function webwxsync(url) {
	//TODO
}

// Probably unnecessary...
function webwxsendmsg(url, msg) {

}

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
// returns a fully forms URL to you.
function makeURL(domain, path, params) {
	var result = "https://";
	result += domain + "/";
	result += path + "?";
	for (var key in params) {
		result += key + "=" + params[key] + "&";
	}
	return result.slice(0,-1);
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

// Gets the uuid for the session.
function getUUID(url) {
	return new Promise(function(resolve, reject) {
		var data = "";
		var result = "";
		https.get(url, function(response) {
			response.on("error", function(error) {
				reject(Error(error));
				return;  // TODO is there a better way of doing this?
			});  
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
			response.on("error", function(error) {
				reject(Error(error));
				return;  // TODO is there a better way of doing this?
			});  
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
			var the_Czech_earl = makeURL("login.wechat.com", "cgi-bin/mmwebwx-bin/login", params);
			https.get(the_Czech_earl, function(response) {
				var data = "";
				response.on("error", function(error) {
					reject(Error(error));
					return;  //TODO: better way to do this?
				});
				response.on("data", function(chunk) {
					data += chunk;
				});
				response.on("end", function() {
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

// Gets session data from the passed URL.
//
// returns a promise, resolved with an object containing skey, sid, uin, pass_ticket,
// and cookies in the form of one long string separated by "; ", in key=value format.
function webwxnewloginpage(url) {
	return new Promise(function (resolve, reject) {
		https.get(url, function(resp) {
			var xml = "";
			var setCookies = resp.headers["set-cookie"];
			var cookies = "";
			for (var i = 0; i < setCookies.length; i++) {
				var cookie = setCookies[i].split("; ")[0] + "; ";
				//log(1, "Got cookie: " + cookie); // Verbose
				cookies += cookie;
			}
			resp.on("error", function(error) {
				reject(Error(error));
				return;  // TODO better way to do this???
			});
			resp.on("data", function(chunk) {
				xml += chunk;
			});
			resp.on("end", function() {
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
					log(1, "Got xml data: " + key + " = " + value);  // Verbose
				}
				log(1, "Cookies: " + cookies);  // Verbose
				result.cookies = cookies;
				log(0, "Got login data");
				resolve(result);
			});
		});
	});
}





