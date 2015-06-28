"use strict";
var http = require("http"),
	url  = require("url"),
	fs   = require("fs");

var part1 = "http://login.wechat.com/jslogin?appid=wx782c26e4c19acffb&redirect_uri=",
	part2 = encodeURIComponent("http://web2.wechat.com/cgi-bin/mmwebwx-bin/webwxnewloginpage"),
	part3 = "&fun=new&lang=en_US&_=" + (new Date()).getTime();

/******************** TODO: MAIN EXECUTION THREAD RIGHT HERE *******************/

var the_earl_of_uuid = part1 + part2 + part3;
var uuid = "";

console.log("[*] Getting UUID...");
getUUID(the_earl_of_uuid).then(function (gotUUID) {
	uuid += gotUUID;
	
	// Setup and handling of QR code.
	var the_earl_of_QR = "http://login.wechat.com/qrcode/" + uuid + "?t=webwx";
	console.log("[*] Getting QR code...");
	serveQR(the_earl_of_QR);

	// Checks to see if the QR code we fetched has been scanned.
	return checkForScan();

}, handleError).then(function(thing) {
	console.log("[+] Got redirect:", thing);
	//TODO something with thing.url
}, function(error) {
	throw error
});

/*********************************** FUNCTIONS *********************************/


// Error handling function, accepts a message to display.
function handleError(air) {
	console.error("[-] ERROR OCCURRED:", air);
	throw Error(air);
}

// Gets the uuid for the session.
function getUUID(url) {
	return new Promise(function(resolve, reject) {
		var data = "";
		var result = "";
		http.get(url, function(response) {
			response.on("error", function(error) {
				reject(Error(error));
				return;  // TODO is there a better way of doing this?
			});  
			response.on("data", function(chunk) {
				data += chunk;
			});
			response.on("end", function() {
				result += data.split(";")[1].split(" = ")[1].trim().slice(1,-1);
				console.log("[+] Got UUID", result + "!");
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
		http.get(url, function(response) {
			response.setEncoding("binary");
			response.on("error", function(error) {
				reject(Error(error));
				return;  // TODO is there a better way of doing this?
			});  
			response.on("data", function(chunk) {
				imgQR += chunk;
			});
			response.on("end", function() {
				console.log("[+] Got QR code!");
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
		console.log("[*] Writing QR to file at", pathQR);
		fs.writeFile(pathQR, imgQR, "binary", function (e) {
			if (e) handleError;
			else {
				console.log("[+] QR successfully written!");
				fs.readFile(pathQR, function (err, imgQR) {
					if (err) handleError;
					else {
						http.createServer(function (req, res) {
							res.writeHead(200, { "content-type": "image/jpeg" });
							console.log("[*] 200 GET: QR code requested from local server.");
							res.end(imgQR);
						}).listen(8000);
						console.log("[*] QR can be scanned at http://localhost:8000");
					}
				});
			}
		});
	}, handleError);
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

function checkForScan() {
	var result = { "code": 999 };  //initialize to nonexistant http code.
	var tip;  
	console.log("[*] Checking for QR code scans...");
	return promiseWhile(function() {
		return new Promise(function (resolve, reject) {
			var condition = ;
			//test if url exists in the result, and the QR hasn't expired.
			if ((result.code !== 400) && (typeof result.url === "undefined"))
				resolve(result);
			else  // Want this case, means we got redirect url.
				reject(result); 
		});
	}, function() {  // Check server for code saying there's been a scan.
		return new Promise(function (resolve, reject) { 
			tip = typeof tip === "number" ? 0 : 1;
			var params = "&uuid=" + uuid + "&tip=" + tip + "&r=" + ~new Date() + "&lang=en_US";
			var baseURL = "http://login.wechat.com/cgi-bin/mmwebwx-bin/login?loginicon=true";
			var the_Czech_earl = baseURL + params;
			console.log("[*] Checking for response code...");
			http.get(the_Czech_earl, function(response) {
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
					var sign = "";
					var log  = " Got response code " + result.code + ": ";
					var meaning = "";
					if (parseInt(result.code / 100) === 2) {  
						sign += "[+]";
						if (result.code === 200) {
							meaning += "Login confirmed, got redirect URL.";
							var temp = values[1].trim();
							result.url = temp.slice(temp.indexOf("http://"), -1);  
						} else if (result.code === 201) {
							meaning += "QR code scanned, confirm login on phone.";
						}
					} else {
						sign += "[-]";
						if (result.code === 400) {
							reject(Error(result));
							handleError("Response code 400: UUID Expired.");
							// Should we have this whole thing in a loop so it
							// automatically gets a new UUID, avoiding this issue?
						} else if (result.code === 408) {
							meaning += "Nothing eventful. (QR code not scanned, usually.)";
						}
					}
					console.log(sign + log + (!meaning ? "Abnormal code" : meaning)); 
					resolve(result);
				});
			});
		});
	})
}






