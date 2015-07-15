# WeChat Node CLient

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
4. ?????
5. PROFIT!!!

## Usage:

```javascript
var wechat = require('wechat-webclient');
```
