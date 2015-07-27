


var wechat = require("./wechat.js");
var weChatClient = new wechat.weChatClient();

weChatClient.getUUID()
	.then(weChatClient.checkForScan.bind(weChatClient), weChatClient.handleError)
	.then(weChatClient.webwxnewloginpage.bind(weChatClient), weChatClient.handleError)
	.then(weChatClient.webwxinit.bind(weChatClient), weChatClient.handleError) 
	.then(weChatClient.webwxgetcontact.bind(weChatClient), weChatClient.handleError)
	.then(function(stuff) { 
		userInterface(stuff);
		return weChatClient.synccheck(stuff);
	}.bind(weChatClient), weChatClient.handleError)
	.then(function (something) {
		weChatClient.log(-1, "No longer syncchecking", something);
	}, weChatClient.handleError);

function saveIcon(iconURLPath) {
  var begin = iconURLPath.indexOf("username=") + "username=".length;
  var end = iconURLPath.indexOf("&skey=");
  var iconPath = iconURLPath.substring(begin, end);
  fs.writeFile("/tmp/wxicon_" + iconPath, result, "binary", function (e) {
    if (e) this.handleError;
    else {
      for (var j = 0; j < max; j++) {
        if (!completed[j]) {
          completed[j] = true;
          this.log(0, "Icon " + (j + 1) + " of " + max + " successfully written");
          j = max;
        }
      }
    }
  }.bind(this));
}

// FIXME FIXME FIXME


function saveQR(imgQR) {
  var pathQR = "/tmp/wxQR_" + uuid;
  this.log(1, "Writing QR to file at " + pathQR);
  fs.writeFile(pathQR, imgQR, "binary", function (e) {
    if (e) this.handleError;
    else {
      this.log(0, "QR successfully written");
      fs.readFile(pathQR, function (err, imgQR) {
        if (err) this.handleError;
        else {
          this.QRserver = serve.createServer(function (req, res) {
            res.writeHead(200, { "content-type": "image/jpeg" });
            this.log(3, "200 GET: QR code requested from local server");
            res.end(imgQR);
          }.bind(this)).listen(8000);
          this.log(1, "QR code can be scanned at http://localhost:8000");
        }
      }.bind(this));
    }
  }.bind(this));
}.bind(this);


function userInterface(loginData) {
	weChatClient.log(3, "Welcome to WeChat: CLI edition! Now listening to user input");
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
				weChatClient.log(3, "No longer listening to user input");
				weChatClient.webwxlogout(loginData);
				weChatClient.log(1, "Logging out");
				return;
			} else if (input === "s") {
				oLoop = false;
			} else {
				toOuterLoop();
			}
		} 
		if (!oLoop) {
			if (!iLoop) {
				if (input === "b") {
					toOuterLoop();
				} else if (parseInt(input)) {
					var contactNum = parseInt(input);
					if (contactNum > 0 && contactNum < weChatClient.contacts.length + 1) {
						message.recipient = weChatClient.contacts[contactNum - 1].UserName;
						weChatClient.slctdUser = message.recipient;
						iLoop = true;
					} else {
						toInnerLoop();
					}
				} else {
					toInnerLoop();
				}
			}
			if (iLoop) {
				weChatClient.promiseWhile(function() {
					return new Promise(function (resolve, reject) {
						(parseInt(input) === -1 && !wNope) ? reject() : resolve();
					});
				}, function() {
					return new Promise(function (resolve, reject) {
						craftMessage(input).then(function(message) {
							weChatClient.webwxsendmsg(loginData, message);
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
						weChatClient.log(3, "What did you want to say to them?");
						wNope = true;
					} else {
						toThreadLoop();
					}
					wStep++;
				} else if (wStep === 2) {
					message.content = input;
					//log(0, "Message crafted");  // Verbose
					//log(4, "Message: " + JSON.stringify(message));  // Verbose
					resolve(message);
				}
			} else {
				reject(wStep);
			}
		});
	}

	function listMessageThread() {
		for (var i = 0; i < weChatClient.messages.length; i++) {
			var sender = weChatClient.messages[i].FromUserName;
			var reciever = weChatClient.messages[i].ToUserName;
			if ((sender === weChatClient.slctdUser) || (reciever === weChatClient.slctdUser)) {
				var sendTime;
				if (reciever === weChatClient.slctdUser) {
					sendTime = parseInt(weChatClient.messages[i].ClientMsgId.slice(0, -4));
				} else if (sender === weChatClient.slctdUser) {
					sendTime = weChatClient.messages[i].CreateTime * 1000;
				} else {
					weChatClient.log(-1, "Unknown message sendTime");
					sendTime = Date.now();
				}
				var ts = weChatClient.formTimeStamp(sendTime);
				if (sender === weChatClient.slctdUser) {
					weChatClient.log(5, ts + weChatClient.messages[i].Content, -1);
				} else if (reciever === weChatClient.slctdUser) {
					weChatClient.log(4, ts + weChatClient.messages[i].Content, -1);
				} else {
					weChatClient.log(-1, "display msg error: " + ts);
				}
			}
		}
	}

	// prompts user with the given question, and lists their contacts.
	function listUsers(question) {
		weChatClient.log(3, question);
		for (var i = 0; i < weChatClient.contacts.length; i++) {
			weChatClient.log(3, "Contact " + (i + 1) + ": " + weChatClient.contacts[i].NickName, -1);
		}
	}

	function toInnerLoop() {
		toXLoop(false, "Type 'b' to go Back to main menu, otherwise,");
		weChatClient.slctdUser = "";
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
		iLoop   = (recipient ? true : false); 
		wStep   = 0;
		wNope   = false;
		wStay   = false;
		rStep   = 0;
		message = {
			"recipient": recipient || "",
			"content": "",
			"type": 1
		};
		weChatClient.log(3, instruction, -1);
	}
}
