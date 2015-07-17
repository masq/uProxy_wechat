# WeChat Node Client

## Description:

This is a [wechat](https://wx.qq.com/) client for node. It authenticates and acts
as though the user is using the official wechat [web interface](http://web.wechat.com).

Note: Development is continuing.

## Installation:

```
npm install --save wechat-webclient
```

## API Flow:

1. Get uuid from WeChat service.
2. Get QR code from WeChat service using uuid.
3. Display QR code to user, so that they can scan it using their WeChat phone app
4. User scans QR code, and confirms they'd like to login.
5. Get the login data (cookies, postdata) from the WeChat service so it knows who we are.
6. Get contact list, contact's icons
7. Recieve messages as they come in, send messages and logout at will.

## Usage:

```javascript
var wechat = require('wechat-webclient');
var client = new wechat.weChatClient();

client.getUUID()  // Gets uuid, passes to next function
	.then(client.checkForScan.bind(client), errorhandlingfunction) // resolves when QR scan confirmed with the login url
	.then(client.webwxnewloginpage.bind(client), errorhandlingfunction) // gets passed login url, resolves with login data
	.then(client.webwxinit.bind(client), errorhandlingfunction) // initializes data for the user, (e.g. who this user is, auth data)
	.then(function(whatever) { // whatever will be a JSON object containing login data.
	return new Promise(function (resolve, reject) {
		client.webwxgetcontact.bind(client, whatever);
			// client.contacts is now populated.
			// Do something with contacts
			// eventually, resolve with what I've here called "whatever", because it is 
			// required for subsequent functions, or save it as a variable in a wide enough scope 
			// so that it can be utilized.
		});
	}, errorhandlingfunction)
	.then(function(passedLoginData) {
		//start some type of user interface here:
		userInterfaceFunction();
		return client.synccheck(passedLoginData); // passes back (actually nothing) stuff when it can no longer synccheck (e.g. logged out)
	}.bind(client), errorhandlingfunction);
	.then(handleProgramShutDownFunction, errorhandlingfunction);
```
