"use strict";
var http = require("http"),
	url  = require("url"),
	fs   = require("fs");

var part1 = "http://login.wechat.com/jslogin?appid=wx782c26e4c19acffb&redirect_uri=",
	part2 = encodeURIComponent("http://web2.wechat.com/cgi-bin/mmwebwx-bin/webwxnewloginpage"),
	part3 = "&fun=new&lang=en_US";
var get_me = part1 + part2 + part3;
var uuid = "";
var urlQR = "http://login.wechat.com/qrcode/";
var imgQR = "";
var qrpath = "";
console.log("[*] Getting uuid...");
http.get(get_me, function(res) {
	var result = "";
	res.on("data", function(d) {
		result += d;
	});
	res.on("error", console.error);
	res.on("end", function() {
		uuid += result.split(";")[1].split(" = ")[1].trim().slice(1,-1);
		urlQR += uuid + "?t=webwx";
		console.log("[+] Got UUID:", uuid);
		console.log("[*] Getting QR code...");
		http.get(urlQR, function(resp) {
			resp.on("error", console.error);
			resp.on("data", function(d){
				imgQR += d;
			});
			resp.on("end", function() {
				console.log("[+] Got QR");
				qrpath += "/tmp/" + uuid;
				fs.writeFile(qrpath, imgQR, function(e) {
					if (e) console.error(e);
					console.log("[*] QR written to", qrpath);
					console.log("[*] QR can be viewed at http://localhost:8000");
				});
			});
		});
	});
});

var server = http.createServer(function serve(req, resp) {
	resp.writeHead(200, { "content-type": "image/jpeg" });
	console.log("[*] 200 GET");
	fs.createReadStream(qrpath).pipe(resp);
	resp.end();
});
server.listen(8000);

