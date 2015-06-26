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
var uuidStatus = getUUID(the_earl_of_uuid);  // returns UUID if resolved
uuidStatus.then(function(uuid) {
	var the_earl_of_QR = "http://login.wechat.com/qrcode/" + uuid + "?t=webwx";
	console.log("[*] Getting QR code...");
	return getQR(the_earl_of_QR);  // returns imgQR if resolved
}, handleError).then(function(imgQR) {
	var path = "/tmp/" + uuid;
	console.log("[*] Writing QR image to file at", path + "...");
	return saveQR(path, imgQR);  // returns nothing if resolved...
}, handleError);  // user scans QR, and logs in from here.


/*********************************** FUNCTIONS *********************************/


//my function to handle any errors.
function handleError(air) {
	console.error("[-] ERROR OCCURRED:", air);
	throw Error(air);
}

// Gets the uuid for the session.
function getUUID(url) {
	return new Promise(function(resolve, reject) {
		var data = "";
		http.get(url, function(response) {
			response.on("error", function(error) {
				reject(Error(error));
				return;  // TODO is there a better way of doing this?
			});  
			response.on("data", function(chunk) {
				data += chunk;
			});
			response.on("end", function() {
				uuid += data.split(";")[1].split(" = ")[1].trim().slice(1,-1);
				console.log("[+] Got UUID", uuid + "!");
				resolve(uuid);
			});
		});
	});
}

// Gets the corresponding QR code to the uuid.
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

// Saves the QR code to disk, and then creates a server displaying it.
function saveQR(pathQR, imgQR) {
	return new Promise(function (resolve, reject) {
		fs.writeFile(pathQR, imgQR, "binary", function (e) {
			if (e) reject(Error(e));
			else {
				console.log("[+] QR successfully written!");
				fs.readFile(pathQR, function (err, imgQR) {
					if (err) reject(Error(err));
					else {
						http.createServer(function (req, res) {
							res.writeHead(200, { "content-type": "image/jpeg" });
							console.log("[*] 200 GET");
							res.end(imgQR);
						}).listen(8000);
						console.log("[*] QR can be viewed at http://localhost:8000");
						resolve();
					}
				});
			}
		});
	});
}







