const express = require('express');
const path = require('path');
const { createProxyMiddleware } = require('http-proxy-middleware');
 
const app = express();
 
app.use('^/$', createProxyMiddleware({ target: 'http://localhost:8080' }));
app.use('/api', createProxyMiddleware({ target: 'http://localhost:8080' }));
app.use('/static', express.static(path.join(__dirname, 'build')))

app.listen(3000);
