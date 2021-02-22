const express = require('express');
const path = require('path');
const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = () => {
    const app = express();

    app.use('/ws', createProxyMiddleware({ target: 'ws://localhost:8080', ws: true }));
    app.use('/static', express.static(path.join(__dirname, 'dist/static')))
    app.use('^/**', createProxyMiddleware({ target: 'http://localhost:8080' }));

    app.listen(3000);
}
